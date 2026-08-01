/**
 * send-offer-email — Supabase Edge Function (v5)
 *
 * Skickar offert-e-post via Resend API.
 * Sparar händelselogg (offerEvents) i Supabase.
 *
 * SÄKERHETSREGLER:
 * - Resend API-nyckel ALDRIG i frontend — lives only here
 * - Kräver giltigt Supabase-JWT + aktiv VIFT-användare + offer_manage
 * - sentBy härleds från verifierad staffMember.id — klientvärde ignoreras
 * - offerToken hanteras helt server-side — klientvärde ignoreras
 * - offerVersion härleds från targetOffer.versionNumber — klientvärde ignoreras
 * - Offert-länk byggs alltid till public-offer.html?t=<token>
 * - Idempotens kontrolleras INNAN token/snapshot/bilagor sparas
 * - Rate-limit: max 10 sändningar / minut per user
 * - Bilagor valideras INNAN någon DB-skrivning sker
 *
 * Token-logik (tre fall):
 *   A. Aktiv token + giltigt snapshot → återanvänd
 *   B. Aktiv token men snapshot saknas/ogiltigt/ofullständigt → skapa snapshot + lås bilagor
 *   C. Ingen aktiv token               → ny token + snapshot + bilagelås
 *
 * Anrop: POST /functions/v1/send-offer-email
 * Headers: Authorization: Bearer <supabase-jwt>
 * Body: {
 *   offerId:        string
 *   recipients:     (string | { email, name? })[]
 *   cc?:            string[]
 *   bcc?:           string[]
 *   subject:        string
 *   bodyHtml:       string
 *   templateId?:    string
 *   attachmentIds?: string[]
 * }
 *
 * Svar 200: {
 *   ok, messageId, sentAt, offerToken, tokenExpiresAt, offerLink,
 *   offerPatch: { publicToken, tokenCreatedAt, tokenExpiresAt, tokenRevokedAt,
 *                 openCount, openedAt, lockedSnapshotJSON, updatedAt },
 *   attachmentPatches: [{ id, lockedInVersion }],
 *   emailEvent: { ...hela den sparade händelseposten... }
 * }
 * Svar 400: { error: 'missing_fields' | 'invalid_recipient' | 'attachment_validation_failed', detail }
 * Svar 401: { error: 'unauthorized' }
 * Svar 403: { error: 'forbidden' }
 * Svar 404: { error: 'offer_not_found' }
 * Svar 409: { error: 'already_sent', detail }
 * Svar 429: { error: 'rate_limited' }
 * Svar 500: { error: 'send_failed' | 'token_save_failed' | 'attachment_lock_failed', detail,
 *             offerPatch, attachmentPatches, emailEvent, offerToken, tokenExpiresAt, offerLink }
 *
 * checkViftAuth() → ViftAuthOk: { ok: true, user, userEmail, staffMember, perms }
 *   staffMember garanterat definierat när ok === true (saknat staffMember → { ok: false })
 *   staffMember.id = business-ID (t.ex. 'ST-001'), används som sentBy
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkViftAuth, hasPerm } from '../_shared/vift-auth.ts'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY   = Deno.env.get('RESEND_API_KEY')            ?? ''
const FROM_EMAIL       = Deno.env.get('FROM_EMAIL')                ?? 'offert@viftfast.se'
const FROM_NAME        = Deno.env.get('FROM_NAME')                 ?? 'VIFT Fastighetsservice'
const PUBLIC_BASE_URL  = Deno.env.get('PUBLIC_BASE_URL')           ?? 'https://app.viftfast.se'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/* ── Rate-limit ─────────────────────────────────────────── */
const _rateMap = new Map<string, { count: number; windowStart: number }>()
const RATE_WINDOW_MS = 60_000
const RATE_MAX       = 10

function checkRate(key: string): boolean {
  const now  = Date.now()
  const slot = _rateMap.get(key)
  if (!slot || now - slot.windowStart > RATE_WINDOW_MS) {
    _rateMap.set(key, { count: 1, windowStart: now })
    return true
  }
  if (slot.count >= RATE_MAX) return false
  slot.count++
  return true
}

/* ── JSON responses ─────────────────────────────────────── */
function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
function err(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/* ── Validera e-post ────────────────────────────────────── */
function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

function normalizeRecipient(r: string | { email: string; name?: string }) {
  if (typeof r === 'string') return { email: r.trim(), name: undefined }
  return { email: (r.email || '').trim(), name: r.name }
}

/* ── Token-aktivt? ──────────────────────────────────────── */
function isTokenActive(o: Record<string, unknown>): boolean {
  if (!o.publicToken) return false
  if (o.tokenRevokedAt) return false
  if (o.tokenExpiresAt) {
    const expiresAt = new Date(String(o.tokenExpiresAt)).getTime()
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false
  }
  return true
}

/* ── Snapshot-validering ────────────────────────────────── */
function parseSnapshot(raw: unknown): Record<string, unknown> | null {
  try {
    if (!raw) return null
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch { return null }
}

function isValidSnapshot(snap: Record<string, unknown> | null, offerId: string): boolean {
  if (!snap) return false
  return String(snap.id ?? '') === offerId &&
    Array.isArray(snap.lines) &&
    Array.isArray(snap.extras) &&
    Array.isArray(snap.publicAttachmentIds)
}

/* ── Generera kryptografiskt säker hex-token (32 bytes) ── */
function generateToken(): string {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

/* ── Speglar CustomerService.displayName() i frontend ───── */
function displayCustomerName(cu: Record<string, unknown>): string {
  const firstName = String(cu.firstName ?? '')
  const lastName  = String(cu.lastName  ?? '')
  const fullName  = `${firstName} ${lastName}`.trim()
  if (String(cu.type ?? '') === 'privat') {
    return fullName || String(cu.name ?? '')
  }
  return String(cu.name ?? '') || fullName
}

/* ── Bygg snapshot exakt som generateDigitalLink() gör ──── */
function buildLockedSnapshot(
  off:       Record<string, unknown>,
  customers: Record<string, unknown>[],
  allAtts:   Record<string, unknown>[],
  nowIso:    string
): string {
  const cu = customers.find(c => c.id === off.customerId) ?? {}
  const customerName = displayCustomerName(cu as Record<string, unknown>)

  const LINE_KEYS  = ['id','type','description','templateName','qty','unit',
    'unitPrice','discount','total','vatRate','exVat','rutAmount','subLines','text'] as const
  const EXTRA_KEYS = ['id','description','qty','unit','unitPrice'] as const

  const lines = (Array.isArray(off.lines) ? off.lines : []).map((l: Record<string, unknown>) => {
    const p: Record<string, unknown> = {}
    LINE_KEYS.forEach(k => { if (k in l) p[k] = l[k] })
    return p
  })

  const extras = (Array.isArray(off.extras) ? off.extras : []).map((e: Record<string, unknown>) => {
    const p: Record<string, unknown> = {}
    EXTRA_KEYS.forEach(k => { if (k in e) p[k] = e[k] })
    return p
  })

  const publicAttachmentIds = allAtts
    .filter(a => a.offerId === off.id && a.active !== false && a.includeInPublicView === true)
    .map(a => String(a.id))

  return JSON.stringify({
    id:            off.id,
    title:         off.title,
    versionNumber: off.versionNumber,
    lines,
    extras,
    discount:      off.discount,
    taxType:       off.taxType,
    rotRutAmount:  off.rotRutAmount,
    date:          off.date ?? String(off.createdAt ?? nowIso).slice(0, 10),
    validUntil:    off.validUntil,
    paymentTerms:  off.paymentTerms,
    validityText:  off.validityText,
    terms:         off.terms,
    includes:      off.includes,
    excludes:      off.excludes,
    scope:         off.scope,
    summary:       off.summary,
    generalTerms:  off.generalTerms,
    address:       off.address,
    customerName,
    publicAttachmentIds,
  })
}

/* ── Förbered valda mejlbilagor — körs INNAN DB-skrivningar ── */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function prepareAttachmentsForEmail(
  allAtts:       Record<string, unknown>[],
  attachmentIds: string[],
  offerId:       string,
  supabase:      ReturnType<typeof createClient>
): Promise<
  { valid: true; attachments: Array<{ filename: string; content: string }> } |
  { valid: false; detail: string }
> {
  const attachments: Array<{ filename: string; content: string }> = []

  for (const id of attachmentIds) {
    const att = allAtts.find(a => String(a.id ?? '') === id) as Record<string, unknown> | undefined
    if (!att) return { valid: false, detail: `Bilaga ${id} hittades inte` }
    if (String(att.offerId ?? '') !== offerId) return { valid: false, detail: `Bilaga ${id} tillhör inte offert ${offerId}` }
    if (att.active === false) return { valid: false, detail: `Bilaga ${id} är inaktiv` }

    const storagePath = String(att.storagePath ?? '')
    if (!storagePath.startsWith('offer-attachments/') || storagePath.includes('..') || storagePath.includes('//')) {
      return { valid: false, detail: `Bilaga ${id} har ogiltig storagePath` }
    }
    const pathInBucket = storagePath.slice('offer-attachments/'.length)
    if (!pathInBucket) return { valid: false, detail: `Bilaga ${id} saknar storagePath` }

    const { data: signedData, error: signedError } = await supabase.storage
      .from('offer-attachments')
      .createSignedUrl(pathInBucket, 60)
    if (signedError || !signedData?.signedUrl) {
      return { valid: false, detail: `Bilaga ${id} går inte att signera i storage` }
    }

    try {
      const fileRes = await fetch(signedData.signedUrl)
      if (!fileRes.ok) {
        return { valid: false, detail: `Bilaga ${id} går inte att hämta från storage (HTTP ${fileRes.status})` }
      }
      const buf = await fileRes.arrayBuffer()
      attachments.push({
        filename: String(att.originalFileName ?? att.displayName ?? id),
        content: arrayBufferToBase64(buf),
      })
    } catch (e) {
      return { valid: false, detail: `Bilaga ${id} går inte att hämta från storage: ${String(e)}` }
    }
  }

  return { valid: true, attachments }
}

/* ── Lås olåsta aktiva bilagor för en offert, returnerar patches ── */
async function lockOfferAttachments(
  supabase:        ReturnType<typeof createClient>,
  allAtts:         Record<string, unknown>[],
  offerId:         string,
  lockedInVersion: string
): Promise<{ patches: Array<{ id: string; lockedInVersion: string }>; err?: string }> {
  const patches: Array<{ id: string; lockedInVersion: string }> = []
  let needsSave = false
  const updatedAtts = allAtts.map(a => {
    if (a.offerId === offerId && a.active !== false && !a.lockedInVersion) {
      needsSave = true
      patches.push({ id: String(a.id), lockedInVersion })
      return { ...a, lockedInVersion }
    }
    return a
  })
  if (needsSave) {
    const { error } = await supabase.from('store').upsert({ key: 'vift_offerAttachments', value: updatedAtts }, { onConflict: 'key' })
    if (error) return { patches: [], err: error.message }
  }
  return { patches }
}

/* ── Huvudhanterare ─────────────────────────────────────── */
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')    return err({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!jwt) return err({ error: 'unauthorized' }, 401)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  /* checkViftAuth() garanterar staffMember när ok === true */
  const viftAuth = await checkViftAuth(supabase, jwt, CORS)
  if (!viftAuth.ok) return viftAuth.response
  const { user, staffMember, perms } = viftAuth

  if (!hasPerm(perms, 'offer_manage')) return err({ error: 'forbidden' }, 403)
  if (!checkRate(user.id))             return err({ error: 'rate_limited' }, 429)

  /* sentBy = staffMember.id (business-ID, t.ex. 'ST-001') — aldrig klientvärde */
  const sentBy = String(staffMember.id ?? user.id)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return err({ error: 'invalid_json' }, 400) }

  const {
    offerId, recipients, cc, bcc,
    subject, bodyHtml, attachmentIds, templateId
  } = body as {
    offerId:        string
    recipients:     (string | { email: string; name?: string })[]
    cc?:            string[]
    bcc?:           string[]
    subject:        string
    bodyHtml:       string
    attachmentIds?: string[]
    templateId?:    string
  }

  /* offerVersion ignoreras från klienten — härleds server-side ur targetOffer.versionNumber */

  if (!offerId || !subject || !bodyHtml) {
    return err({ error: 'missing_fields', detail: 'offerId, subject, bodyHtml krävs' }, 400)
  }
  if (!Array.isArray(recipients) || !recipients.length) {
    return err({ error: 'missing_fields', detail: 'Minst en mottagare krävs' }, 400)
  }
  if (cc !== undefined && !Array.isArray(cc)) return err({ error: 'invalid_cc' }, 400)
  if (bcc !== undefined && !Array.isArray(bcc)) return err({ error: 'invalid_bcc' }, 400)
  if (attachmentIds !== undefined && !Array.isArray(attachmentIds)) {
    return err({ error: 'invalid_attachment_ids' }, 400)
  }
  if (String(subject).length > 200)      return err({ error: 'subject_too_long' }, 400)
  if (String(bodyHtml).length > 200_000) return err({ error: 'body_too_large' }, 400)

  const attachmentIdList = Array.from(new Set(
    (attachmentIds ?? []).map(id => String(id).trim()).filter(Boolean)
  ))
  const normalizedTo = recipients.map(normalizeRecipient)
  for (const r of normalizedTo) {
    if (!isValidEmail(r.email)) {
      return err({ error: 'invalid_recipient', detail: `Ogiltig e-postadress: ${r.email}` }, 400)
    }
  }

  if (!RESEND_API_KEY) return err({ error: 'provider_not_configured' }, 500)

  /* Hämta vift_offers */
  const { data: offStoreRow } = await supabase
    .from('store').select('value').eq('key', 'vift_offers').maybeSingle()
  const allOffers: Record<string, unknown>[] =
    Array.isArray(offStoreRow?.value) ? offStoreRow.value as Record<string, unknown>[] : []
  const targetOffer = allOffers.find(o => o.id === offerId)
  if (!targetOffer) return err({ error: 'offer_not_found' }, 404)

  /* offerVersion härleds alltid server-side — klientvärde ignoreras */
  const resolvedVersion = Number(targetOffer.versionNumber ?? 1) || 1

  const nowDate = new Date()
  const nowIso  = nowDate.toISOString()

  /* Hämta vift_offerAttachments en gång — används för validering, snapshot och låsning */
  const { data: attStoreRow } = await supabase
    .from('store').select('value').eq('key', 'vift_offerAttachments').maybeSingle()
  const allAtts: Record<string, unknown>[] =
    Array.isArray(attStoreRow?.value) ? attStoreRow.value as Record<string, unknown>[] : []

  /* Validera, signera och hämta valda bilagor INNAN någon DB-skrivning */
  const preparedAttachments = await prepareAttachmentsForEmail(allAtts, attachmentIdList, offerId, supabase)
  if (!preparedAttachments.valid) {
    return err({ error: 'attachment_validation_failed', detail: preparedAttachments.detail }, 400)
  }
  const emailAtts = preparedAttachments.attachments

  /* ── Idempotens: INNAN token/snapshot sparas ───────────── */
  try {
    const { data: evRow } = await supabase
      .from('store').select('value').eq('key', 'vift_offerEvents').maybeSingle()
    const recentEvents: Record<string, unknown>[] =
      Array.isArray(evRow?.value) ? evRow.value as Record<string, unknown>[] : []
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const duplicate = recentEvents.find(e =>
      e.offerId === offerId &&
      Number(e.offerVersion) === resolvedVersion &&
      e.type === 'email_sent' &&
      e.status === 'sent' &&
      String(e.sentAt ?? '') > fiveMinAgo
    )
    if (duplicate) {
      return err({ error: 'already_sent', detail: 'Offerten skickades redan inom de senaste 5 minuterna' }, 409)
    }
  } catch { /* gå vidare om kontrollen misslyckas */ }

  /* ── Token-logik: tre fall ──────────────────────────────── */
  let offerToken:        string
  let tokenExpiresAt:    string
  let offerPatch:        Record<string, unknown>
  let attachmentPatches: Array<{ id: string; lockedInVersion: string }> = []

  const hasActiveToken   = isTokenActive(targetOffer)
  const existingSnap     = hasActiveToken ? parseSnapshot(targetOffer.lockedSnapshotJSON) : null
  const hasValidSnapshot = isValidSnapshot(existingSnap, offerId)

  if (hasActiveToken && hasValidSnapshot) {
    /* Fall A: aktiv token + giltigt snapshot — ingen DB-skrivning */
    offerToken     = String(targetOffer.publicToken)
    tokenExpiresAt = String(targetOffer.tokenExpiresAt ?? '')
    offerPatch = {
      publicToken:        offerToken,
      tokenCreatedAt:     String(targetOffer.tokenCreatedAt ?? nowIso),
      tokenExpiresAt,
      tokenRevokedAt:     '',
      openCount:          targetOffer.openCount  ?? 0,
      openedAt:           targetOffer.openedAt   ?? '',
      lockedSnapshotJSON: String(JSON.stringify(existingSnap)),
      updatedAt:          String(targetOffer.updatedAt ?? nowIso),
    }

  } else if (hasActiveToken && !hasValidSnapshot) {
    /* Fall B: aktiv token utan snapshot eller ogiltigt/ofullständigt snapshot — skapa snapshot + lås bilagor */
    offerToken     = String(targetOffer.publicToken)
    tokenExpiresAt = String(targetOffer.tokenExpiresAt ?? '')
    const lockedInVersion = `${offerId}-${offerToken.slice(0, 8)}`

    const { data: custRow } = await supabase
      .from('store').select('value').eq('key', 'vift_customers').maybeSingle()
    const customers: Record<string, unknown>[] =
      Array.isArray(custRow?.value) ? custRow.value as Record<string, unknown>[] : []
    const lockedSnapshotJSON = buildLockedSnapshot(targetOffer, customers, allAtts, nowIso)

    offerPatch = {
      publicToken:        offerToken,
      tokenCreatedAt:     String(targetOffer.tokenCreatedAt ?? nowIso),
      tokenExpiresAt,
      tokenRevokedAt:     '',
      openCount:          targetOffer.openCount ?? 0,
      openedAt:           targetOffer.openedAt  ?? '',
      lockedSnapshotJSON,
      updatedAt:          nowIso,
    }

    const updatedOffers = allOffers.map(o =>
      o.id !== offerId ? o : { ...o, lockedSnapshotJSON, updatedAt: nowIso }
    )
    const { error: offSaveErr } = await supabase
      .from('store')
      .upsert({ key: 'vift_offers', value: updatedOffers }, { onConflict: 'key' })
    if (offSaveErr) {
      console.error('[send-offer-email] Snapshot-sparning misslyckades:', offSaveErr)
      return err({ error: 'token_save_failed', detail: offSaveErr.message }, 500)
    }

    const lockResult = await lockOfferAttachments(supabase, allAtts, offerId, lockedInVersion)
    if (lockResult.err) {
      console.error('[send-offer-email] Bilagelås misslyckades:', lockResult.err)
      return err({
        error: 'attachment_lock_failed', detail: lockResult.err,
        offerPatch, attachmentPatches: [], offerToken, tokenExpiresAt,
        offerLink: `${PUBLIC_BASE_URL}/public-offer.html?t=${encodeURIComponent(offerToken)}`,
      }, 500)
    }
    attachmentPatches = lockResult.patches

  } else {
    /* Fall C: ingen aktiv token — ny token + snapshot + bilagelås */
    offerToken            = generateToken()
    const expDate         = new Date(nowDate.getTime() + 30 * 24 * 60 * 60 * 1000)
    tokenExpiresAt        = expDate.toISOString().slice(0, 10) + 'T23:59:59.000Z'
    const lockedInVersion = `${offerId}-${offerToken.slice(0, 8)}`

    const { data: custRow } = await supabase
      .from('store').select('value').eq('key', 'vift_customers').maybeSingle()
    const customers: Record<string, unknown>[] =
      Array.isArray(custRow?.value) ? custRow.value as Record<string, unknown>[] : []
    const lockedSnapshotJSON = buildLockedSnapshot(targetOffer, customers, allAtts, nowIso)

    offerPatch = {
      publicToken:        offerToken,
      tokenCreatedAt:     nowIso,
      tokenExpiresAt,
      tokenRevokedAt:     '',
      openCount:          0,
      openedAt:           '',
      lockedSnapshotJSON,
      updatedAt:          nowIso,
    }

    const updatedOffers = allOffers.map(o =>
      o.id !== offerId ? o : {
        ...o,
        publicToken:        offerToken,
        tokenCreatedAt:     nowIso,
        tokenExpiresAt,
        tokenRevokedAt:     '',
        openCount:          0,
        openedAt:           '',
        lockedSnapshotJSON,
        updatedAt:          nowIso,
      }
    )
    const { error: offSaveErr } = await supabase
      .from('store')
      .upsert({ key: 'vift_offers', value: updatedOffers }, { onConflict: 'key' })
    if (offSaveErr) {
      console.error('[send-offer-email] Token-sparning misslyckades:', offSaveErr)
      return err({ error: 'token_save_failed', detail: offSaveErr.message }, 500)
    }

    const lockResult = await lockOfferAttachments(supabase, allAtts, offerId, lockedInVersion)
    if (lockResult.err) {
      console.error('[send-offer-email] Bilagelås misslyckades:', lockResult.err)
      return err({
        error: 'attachment_lock_failed', detail: lockResult.err,
        offerPatch, attachmentPatches: [], offerToken, tokenExpiresAt,
        offerLink: `${PUBLIC_BASE_URL}/public-offer.html?t=${encodeURIComponent(offerToken)}`,
      }, 500)
    }
    attachmentPatches = lockResult.patches
  }

  /* Bygg rätt offertlänk */
  const offerLink = `${PUBLIC_BASE_URL}/public-offer.html?t=${encodeURIComponent(offerToken)}`

  /* Injicera offertlänk om platshållare finns, annars lägg till sist */
  const finalHtml = bodyHtml.includes('{{OFFER_LINK}}')
    ? bodyHtml.replace(/\{\{OFFER_LINK\}\}/g, offerLink)
    : bodyHtml + `\n<p><a href="${offerLink}">Visa offert online</a></p>`

  /* Bygg Resend payload */
  const resendTo = normalizedTo.map(r => r.name ? `${r.name} <${r.email}>` : r.email)
  const resendPayload: Record<string, unknown> = {
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to:   resendTo,
    subject,
    html: finalHtml,
  }
  if (cc?.length)           resendPayload.cc          = cc.filter(isValidEmail)
  if (bcc?.length)          resendPayload.bcc         = bcc.filter(isValidEmail)
  if (emailAtts.length > 0) resendPayload.attachments = emailAtts

  /* Skicka via Resend */
  let messageId  = ''
  let sendStatus = 'sent'
  let sendError  = ''

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(resendPayload),
    })
    const resendJson = await resendRes.json().catch(() => ({})) as { id?: string; message?: string }
    if (!resendRes.ok) {
      sendStatus = 'failed'
      sendError  = resendJson.message ?? `HTTP ${resendRes.status}`
      console.error('[send-offer-email] Resend error:', sendError)
    } else {
      messageId = resendJson.id ?? ''
    }
  } catch (e) {
    sendStatus = 'failed'
    sendError  = String(e)
    console.error('[send-offer-email] Network error:', e)
  }

  const sentAt  = new Date().toISOString()
  const eventId = `OEV-${Date.now().toString(36).toUpperCase()}`

  /* Bygg emailEvent — returneras till frontend och sparas i store */
  const emailEvent: Record<string, unknown> = {
    id:              eventId,
    type:            'email_sent',
    offerId,
    offerVersion:    resolvedVersion,
    ts:              sentAt,
    sentAt,
    sentBy,
    recipients:      normalizedTo.map(r => r.email),
    cc:              (cc  ?? []).filter(isValidEmail),
    bcc:             (bcc ?? []).filter(isValidEmail),
    subject,
    templateId:      templateId ?? null,
    messageId,
    status:          sendStatus,
    error:           sendError  || null,
    attachmentCount: attachmentIdList.length,
  }

  /* Spara emailEvent i vift_offerEvents — misslyckad loggning stoppar inte svaret */
  let logWarning: string | undefined
  try {
    const { data: evRow } = await supabase
      .from('store').select('value').eq('key', 'vift_offerEvents').maybeSingle()
    const offerEvents: unknown[] = Array.isArray(evRow?.value) ? evRow.value as unknown[] : []
    offerEvents.push(emailEvent)
    if (offerEvents.length > 10_000) offerEvents.splice(0, offerEvents.length - 10_000)
    const { error: eventSaveError } = await supabase
      .from('store')
      .upsert({ key: 'vift_offerEvents', value: offerEvents }, { onConflict: 'key' })
    if (eventSaveError) {
      console.error('[send-offer-email] Händelseloggning misslyckades:', eventSaveError)
      logWarning = sendStatus === 'sent'
        ? 'Mejlet skickades men händelseloggning misslyckades'
        : 'Det misslyckade utskicket kunde inte sparas i händelseloggen'
    }
  } catch (logErr) {
    console.error('[send-offer-email] Händelseloggning misslyckades:', logErr)
    logWarning = sendStatus === 'sent'
      ? 'Mejlet skickades men händelseloggning misslyckades'
      : 'Det misslyckade utskicket kunde inte sparas i händelseloggen'
  }

  if (sendStatus === 'failed') {
    return err({
      error: 'send_failed',
      detail: sendError,
      offerPatch,
      attachmentPatches,
      emailEvent,
      offerToken,
      tokenExpiresAt,
      offerLink,
      ...(logWarning ? { logWarning } : {}),
    }, 500)
  }

  return ok({
    ok: true,
    messageId,
    sentAt,
    offerToken,
    tokenExpiresAt,
    offerLink,
    offerPatch,
    attachmentPatches,
    emailEvent,
    ...(logWarning ? { logWarning } : {}),
  })
})
