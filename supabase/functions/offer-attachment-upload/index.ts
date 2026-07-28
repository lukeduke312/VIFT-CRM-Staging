/**
 * offer-attachment-upload — Supabase Edge Function (Leverans E, Del E2b-2)
 *
 * Tar emot multipart/form-data med fil + metadata, validerar och sparar
 * till Supabase Storage samt uppdaterar vift_offerAttachments i store.
 *
 * SÄKERHET:
 * - Kräver giltig JWT (Authorization: Bearer) — intern CRM-användare
 * - Filtyp valideras mot ALLOWED_MIME_TYPES (magic bytes + MIME-typ)
 * - Filnamn saniteras — inga path traversal, inga specialtecken
 * - Max filstorlek: MAX_BYTES (50 MB)
 * - Rate-limit: 30 req/min per IP
 * - Soft delete stöds (active=false) — filen tas inte bort ur Storage direkt
 *
 * POST /functions/v1/offer-attachment-upload
 * Content-Type: multipart/form-data
 * Headers: Authorization: Bearer <SUPABASE_JWT>
 *
 * Form fields:
 *   file:                 File
 *   offerId:              string
 *   offerVersionId:       string
 *   displayName?:         string
 *   description?:         string
 *   includeInPublicView?: 'true'|'false'
 *   includeInCombinedPdf?:'true'|'false'
 *   sortOrder?:           number string
 *   uploadedBy?:          string (staff ID)
 *
 * Svar 200: { attachment: OfferAttachment }
 * Svar 400: { error: 'invalid_file_type'|'file_too_large'|'missing_fields' }
 * Svar 403: { error: 'forbidden' }
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkViftAuth, hasPerm } from '../_shared/vift-auth.ts'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const STORAGE_BUCKET   = 'offer-attachments'
const MAX_BYTES        = 50 * 1024 * 1024  /* 50 MB */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS'
}

/* ── Tillåtna filtyper ────────────────────────────────────── */
const ALLOWED_MIME: Record<string, string> = {
  'application/pdf':                                                      'pdf',
  'image/jpeg':                                                           'jpg',
  'image/png':                                                            'png',
  'image/gif':                                                            'gif',
  'image/webp':                                                           'webp',
  'image/svg+xml':                                                        'svg',
  'image/tiff':                                                           'tiff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':       'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx',
  'application/msword':                                                   'doc',
  'application/vnd.ms-excel':                                            'xls',
  'text/plain':                                                           'txt',
  'text/csv':                                                             'csv',
  'application/zip':                                                      'zip',
  'application/x-dwg':                                                   'dwg',    // ritningar
  'image/vnd.dwg':                                                        'dwg',
  'application/octet-stream':                                             'bin'     // okänt — godtas men flaggas
}

/* Magic bytes för vanligaste typer (förhindra typ-spoofing via extension) */
function sniffMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
    return 'application/pdf'
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF)
    return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47)
    return 'image/png'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)
    return 'image/gif'
  if (bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04)
    /* ZIP-baserade format: DOCX, XLSX, PPTX */
    return null  /* låt MIME från Content-Type avgöra bland ZIP-baserade */
  return null
}

/* ── Rate-limit ───────────────────────────────────────────── */
const _rateMap = new Map<string, { count: number; windowStart: number }>()

function checkRateLimit(ip: string): boolean {
  const now  = Date.now()
  const slot = _rateMap.get(ip)
  if (!slot || now - slot.windowStart > 60_000) {
    _rateMap.set(ip, { count: 1, windowStart: now }); return true
  }
  slot.count++; return slot.count <= 30
}

/* ── SHA-256 av filinnehåll ───────────────────────────────── */
async function sha256hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('')
}

/* ── Sanitera filnamn ─────────────────────────────────────── */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._\- åäöÅÄÖ]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\./, '_')
    .slice(0, 200)
    || 'bilaga'
}

/* ── Handler ─────────────────────────────────────────────── */
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRateLimit(ip)) return json({ error: 'rate_limited' }, 429)

  /* Auth: kräver giltig JWT + aktiv VIFT-användare + offer_manage */
  const authHeader = req.headers.get('authorization') || ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!jwt) return json({ error: 'forbidden' }, 403)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const auth = await checkViftAuth(supabase, jwt, CORS)
  if (!auth.ok) return auth.response
  const { user, perms } = auth

  if (!hasPerm(perms, 'offer_manage')) {
    return json({ error: 'forbidden' }, 403)
  }

  /* ── DELETE-hantering (soft delete) ──────────────────────── */
  if (req.method === 'DELETE') {
    let body: Record<string, unknown>
    try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

    const attachmentId = String(body.attachmentId ?? '').trim()
    if (!attachmentId) return json({ error: 'not_found' }, 404)

    return await softDeleteAttachment(supabase, attachmentId)
  }

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  /* ── Multipart form data ─────────────────────────────────── */
  let formData: FormData
  try { formData = await req.formData() }
  catch (e) { return json({ error: 'invalid_form', detail: String(e) }, 400) }

  const fileField      = formData.get('file')
  const offerId        = String(formData.get('offerId')        ?? '').trim()
  const offerVersionId = String(formData.get('offerVersionId') ?? '').trim()

  if (!fileField || !(fileField instanceof File)) return json({ error: 'missing_file' }, 400)
  if (!offerId)        return json({ error: 'missing_fields', field: 'offerId' }, 400)
  if (!offerVersionId) return json({ error: 'missing_fields', field: 'offerVersionId' }, 400)

  /* Validera att offerten existerar */
  const { data: offRow } = await supabase
    .from('store').select('value').eq('key', 'vift_offers').maybeSingle()
  const knownOffers: Record<string, unknown>[] =
    Array.isArray(offRow?.value) ? offRow.value as Record<string, unknown>[] : []
  if (!knownOffers.find(o => o.id === offerId)) {
    return json({ error: 'offer_not_found' }, 404)
  }

  const file = fileField as File

  /* Storlek */
  if (file.size > MAX_BYTES) return json({ error: 'file_too_large', maxBytes: MAX_BYTES }, 400)
  if (file.size === 0)        return json({ error: 'empty_file' }, 400)

  /* Läs filen */
  const arrayBuffer = await file.arrayBuffer()
  const uint8       = new Uint8Array(arrayBuffer)

  /* MIME-validering */
  const claimedMime  = (file.type || 'application/octet-stream').toLowerCase().split(';')[0].trim()
  const sniffedMime  = sniffMime(uint8)

  /* Om sniffed och claimed skiljer sig för välkända typer — blockera */
  if (sniffedMime && sniffedMime !== claimedMime) {
    /* Tillåt ändå om declared är en ZIP-baserad Office-typ */
    const isZipOffice = ['application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                         'application/vnd.openxmlformats-officedocument.presentationml.presentation']
      .includes(claimedMime)
    if (!isZipOffice) {
      return json({ error: 'mime_mismatch', claimed: claimedMime, detected: sniffedMime }, 400)
    }
  }

  const effectiveMime = sniffedMime ?? claimedMime
  if (!Object.keys(ALLOWED_MIME).includes(effectiveMime)) {
    return json({ error: 'invalid_file_type', type: effectiveMime, allowed: Object.keys(ALLOWED_MIME) }, 400)
  }

  /* Checksum */
  const checksum = await sha256hex(uint8)

  /* Metadata */
  const displayName      = String(formData.get('displayName')        ?? '').trim() || sanitizeFilename(file.name)
  const description      = String(formData.get('description')        ?? '').trim().slice(0, 500)
  const inclPublic       = formData.get('includeInPublicView')       !== 'false'
  const inclPdf          = formData.get('includeInCombinedPdf')      === 'true'
  const sortOrderStr     = String(formData.get('sortOrder')          ?? '0')
  const sortOrder        = parseInt(sortOrderStr, 10) || 0
  const uploadedBy       = String(formData.get('uploadedBy')         ?? '').trim()
  const now              = new Date().toISOString()

  /* Generera ID */
  const idBytes = new Uint8Array(8)
  crypto.getRandomValues(idBytes)
  const attachmentId = 'att-' + Array.from(idBytes).map(b=>b.toString(16).padStart(2,'0')).join('')

  const safeFilename     = sanitizeFilename(file.name)
  const storagePath      = `offer-attachments/${offerId}/${attachmentId}/${safeFilename}`
  const pathInBucket     = `${offerId}/${attachmentId}/${safeFilename}`

  /* Ladda upp till Supabase Storage */
  const { error: upErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(pathInBucket, uint8, {
      contentType:  effectiveMime,
      cacheControl: '3600',
      upsert:       false
    })

  if (upErr) {
    console.error('[offer-attachment-upload] storage upload fel')
    return json({ error: 'storage_error' }, 500)
  }

  /* Spara metadata i vift_offerAttachments */
  const newAtt: Record<string, unknown> = {
    id:                   attachmentId,
    offerId,
    offerVersionId,
    storagePath,
    originalFileName:     file.name,
    displayName,
    description,
    mimeType:             effectiveMime,
    sizeBytes:            file.size,
    sortOrder,
    includeInPublicView:  inclPublic,
    includeInCombinedPdf: inclPdf,
    uploadedBy,
    uploadedAt:           now,
    active:               true,
    lockedInVersion:      '',
    checksum
  }

  const { data: attRow } = await supabase
    .from('store').select('value').eq('key', 'vift_offerAttachments').maybeSingle()
  const attachments: Record<string, unknown>[] =
    Array.isArray(attRow?.value) ? attRow.value as Record<string, unknown>[] : []
  attachments.push(newAtt)
  if (attachments.length > 5_000) attachments.splice(0, attachments.length - 5_000)

  await supabase.from('store')
    .upsert({ key: 'vift_offerAttachments', value: attachments }, { onConflict: 'key' })

  /* Logg-händelse i vift_offerEvents */
  await appendOfferEvent(supabase, {
    offerId, offerVersion: 1, type: 'attachment_added',
    ts: now, byUser: uploadedBy,
    comment: `Bilaga uppladdad: ${displayName} (${formatBytes(file.size)})`
  })

  return json({ attachment: newAtt })
})

/* ── Soft delete ──────────────────────────────────────────── */
async function softDeleteAttachment(
  supabase: ReturnType<typeof createClient>,
  attachmentId: string
): Promise<Response> {
  const { data: attRow } = await supabase
    .from('store').select('value').eq('key', 'vift_offerAttachments').maybeSingle()
  const attachments: Record<string, unknown>[] =
    Array.isArray(attRow?.value) ? attRow.value as Record<string, unknown>[] : []

  const att = attachments.find(a => a.id === attachmentId)
  if (!att) return json({ error: 'not_found' }, 404)

  att.active    = false
  att.deletedAt = new Date().toISOString()

  await supabase.from('store')
    .upsert({ key: 'vift_offerAttachments', value: attachments }, { onConflict: 'key' })

  /* Logga borttagning */
  await appendOfferEvent(supabase, {
    offerId:        String(att.offerId ?? ''),
    offerVersion:   1,
    type:           'attachment_removed',
    ts:             new Date().toISOString(),
    comment:        `Bilaga borttagen: ${String(att.displayName || att.originalFileName || attachmentId)}`
  })

  return json({ ok: true })
}

/* ── Event-logg ───────────────────────────────────────────── */
async function appendOfferEvent(
  supabase: ReturnType<typeof createClient>,
  ev: Partial<{ offerId: string; offerVersion: number; type: string; ts: string; byUser: string; comment: string }>
): Promise<void> {
  try {
    const { data: row } = await supabase.from('store')
      .select('value').eq('key', 'vift_offerEvents').maybeSingle()
    const events: unknown[] = Array.isArray(row?.value) ? row.value as unknown[] : []
    events.push({
      id:           'oe-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      offerId:      ev.offerId      ?? '',
      offerVersion: ev.offerVersion ?? 1,
      type:         ev.type         ?? '',
      ts:           ev.ts           ?? new Date().toISOString(),
      byUser:       ev.byUser       ?? '',
      byCustomer:   '',
      byEmail:      '',
      ip:           '',
      comment:      ev.comment      ?? '',
      changeRequestCategory: '',
      declineReason: ''
    })
    if (events.length > 10_000) events.splice(0, events.length - 10_000)
    await supabase.from('store')
      .upsert({ key: 'vift_offerEvents', value: events }, { onConflict: 'key' })
  } catch (e) {
    console.error('[offer-attachment-upload] appendOfferEvent:', e)
  }
}

function formatBytes(b: number): string {
  if (b < 1024) return b + ' B'
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'
  return (b / 1048576).toFixed(1) + ' MB'
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}
