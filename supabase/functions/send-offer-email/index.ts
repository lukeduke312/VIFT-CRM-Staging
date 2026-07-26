/**
 * send-offer-email — Supabase Edge Function (Punkt 80, v1)
 *
 * Skickar offert-e-post via Resend API.
 * Sparar händelselogg (offerEvents) i Supabase.
 *
 * SÄKERHETSREGLER:
 * - Resend API-nyckel ALDRIG i frontend — lives only here
 * - Kräver giltigt Supabase service_role eller autentiserad anrop
 * - Aldrig intern kalkyl/TB/underlag i kundbilagor
 * - Offert-länk genereras med token från store, aldrig manuellt
 * - Rate-limit: max 10 sändningar / minut per user
 *
 * Anrop: POST /functions/v1/send-offer-email
 * Headers: Authorization: Bearer <supabase-jwt> (intern anrop)
 * Body: {
 *   offerId:        string         — offert-ID
 *   offerVersion:   number         — vilken version som skickas
 *   recipients:     string[]       — [{ email, name? }] eller ['email@…']
 *   cc?:            string[]
 *   bcc?:           string[]
 *   subject:        string
 *   bodyHtml:       string         — HTML-body (redigerad i dialogen)
 *   templateId?:    string
 *   offerToken:     string         — publik token för länk
 *   attachmentIds?: string[]       — IDs ur offerAttachments för bifogning
 *   sentBy:         string         — staffId / userId
 * }
 *
 * Svar 200: { ok: true, messageId, sentAt }
 * Svar 400: { error: 'missing_fields' | 'invalid_recipient' | 'token_missing' }
 * Svar 401: { error: 'unauthorized' }
 * Svar 429: { error: 'rate_limited' }
 * Svar 500: { error: 'send_failed', detail }
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkViftAuth, hasPerm } from '../_shared/vift-auth.ts'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY    = Deno.env.get('RESEND_API_KEY')            ?? ''
const FROM_EMAIL        = Deno.env.get('FROM_EMAIL')                ?? 'offert@viftfast.se'
const FROM_NAME         = Deno.env.get('FROM_NAME')                 ?? 'VIFT Fastighetsservice'
const PUBLIC_BASE_URL   = Deno.env.get('PUBLIC_BASE_URL')           ?? 'https://app.viftfast.se'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
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

/* ── Hämta signerad bilage-URL ──────────────────────────── */
async function fetchSignedAttachments(
  supabase: ReturnType<typeof createClient>,
  attachmentIds: string[]
): Promise<Array<{ filename: string; content: string }>> {
  if (!attachmentIds?.length) return []

  const { data: storeRow } = await supabase
    .from('store')
    .select('value')
    .eq('key', 'vift_offerAttachments')
    .maybeSingle()

  if (!storeRow?.value) return []

  const offerAttachments: Array<{
    id: string; storagePath: string; originalFileName: string;
    active?: boolean;
  }> = Array.isArray(storeRow.value) ? storeRow.value : []

  const results: Array<{ filename: string; content: string }> = []

  for (const id of attachmentIds) {
    const att = offerAttachments.find(a => a.id === id)
    if (!att || att.active === false) continue

    const pathInBucket = att.storagePath.replace('offer-attachments/', '')
    const { data: signedData } = await supabase.storage
      .from('offer-attachments')
      .createSignedUrl(pathInBucket, 60)

    if (!signedData?.signedUrl) continue

    try {
      const res  = await fetch(signedData.signedUrl)
      if (!res.ok) continue
      const buf  = await res.arrayBuffer()
      const b64  = btoa(String.fromCharCode(...new Uint8Array(buf)))
      results.push({ filename: att.originalFileName, content: b64 })
    } catch {
      // Hoppa över om nedladdning misslyckas
    }
  }

  return results
}

/* ── Huvudhanterare ─────────────────────────────────────── */
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')    return err({ error: 'method_not_allowed' }, 405)

  /* Autentisering — kräver giltig JWT + aktiv VIFT-användare + offer_manage */
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!jwt) return err({ error: 'unauthorized' }, 401)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const viftAuth = await checkViftAuth(supabase, jwt, CORS)
  if (!viftAuth.ok) return viftAuth.response
  const { user, perms } = viftAuth

  if (!hasPerm(perms, 'offer_manage')) {
    return err({ error: 'forbidden' }, 403)
  }

  /* Rate-limit per user */
  if (!checkRate(user.id)) return err({ error: 'rate_limited' }, 429)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return err({ error: 'invalid_json' }, 400) }

  const {
    offerId, offerVersion, recipients, cc, bcc,
    subject, bodyHtml, offerToken,
    attachmentIds, sentBy, templateId
  } = body as {
    offerId:        string
    offerVersion:   number
    recipients:     (string | { email: string; name?: string })[]
    cc?:            string[]
    bcc?:           string[]
    subject:        string
    bodyHtml:       string
    offerToken:     string
    attachmentIds?: string[]
    sentBy:         string
    templateId?:    string
  }

  /* Validering */
  if (!offerId || !offerToken || !subject || !bodyHtml || !sentBy) {
    return err({ error: 'missing_fields', detail: 'offerId, offerToken, subject, bodyHtml, sentBy krävs' }, 400)
  }
  if (!recipients?.length) {
    return err({ error: 'missing_fields', detail: 'Minst en mottagare krävs' }, 400)
  }
  if (String(subject).length > 200)       return err({ error: 'subject_too_long' }, 400)
  if (String(bodyHtml).length > 200_000)  return err({ error: 'body_too_large' }, 400)

  const normalizedTo = recipients.map(normalizeRecipient)
  for (const r of normalizedTo) {
    if (!isValidEmail(r.email)) {
      return err({ error: 'invalid_recipient', detail: `Ogiltig e-postadress: ${r.email}` }, 400)
    }
  }

  if (!RESEND_API_KEY) return err({ error: 'provider_not_configured' }, 500)

  /* Verifiera att offerToken matchar offerten i store */
  const { data: offStoreRow } = await supabase
    .from('store').select('value').eq('key', 'vift_offers').maybeSingle()
  const allOffers: Record<string, unknown>[] =
    Array.isArray(offStoreRow?.value) ? offStoreRow.value as Record<string, unknown>[] : []
  const targetOffer = allOffers.find(o => o.id === offerId)
  if (!targetOffer) return err({ error: 'offer_not_found' }, 404)
  if (targetOffer.publicToken !== offerToken) return err({ error: 'token_mismatch' }, 400)

  /* Idempotens: blockera dubbelutskick inom 5 minuter */
  try {
    const { data: evRow } = await supabase
      .from('store').select('value').eq('key', 'vift_offerEvents').maybeSingle()
    const recentEvents: Record<string, unknown>[] =
      Array.isArray(evRow?.value) ? evRow.value as Record<string, unknown>[] : []
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const duplicate = recentEvents.find(e =>
      e.offerId === offerId &&
      Number(e.offerVersion) === Number(offerVersion) &&
      e.type === 'email_sent' &&
      e.status === 'sent' &&
      String(e.sentAt ?? '') > fiveMinAgo
    )
    if (duplicate) {
      return err({ error: 'already_sent', detail: 'Offerten skickades redan inom de senaste 5 minuterna' }, 409)
    }
  } catch {
    // Gå vidare om kontroll misslyckas
  }

  /* Generera offertlänk */
  const offerLink = `${PUBLIC_BASE_URL}/#/offer/${offerToken}`

  /* Injicera offertlänk om platshållare finns, annars bifoga i slutet */
  const finalHtml = bodyHtml.includes('{{OFFER_LINK}}')
    ? bodyHtml.replace(/\{\{OFFER_LINK\}\}/g, offerLink)
    : bodyHtml + `\n<p><a href="${offerLink}">Visa offert online</a></p>`

  /* Bilagor */
  const emailAtts  = await fetchSignedAttachments(supabase, attachmentIds ?? [])

  /* Bygg Resend payload */
  const resendTo = normalizedTo.map(r =>
    r.name ? `${r.name} <${r.email}>` : r.email
  )

  const resendPayload: Record<string, unknown> = {
    from:    `${FROM_NAME} <${FROM_EMAIL}>`,
    to:      resendTo,
    subject,
    html:    finalHtml,
  }
  if (cc?.length)           resendPayload.cc  = cc.filter(isValidEmail)
  if (bcc?.length)          resendPayload.bcc = bcc.filter(isValidEmail)
  if (emailAtts.length > 0) resendPayload.attachments = emailAtts

  /* Skicka via Resend */
  let messageId   = ''
  let sendStatus  = 'sent'
  let sendError   = ''

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
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

  const sentAt = new Date().toISOString()

  /* Spara händelse i vift_offerEvents */
  try {
    const { data: evRow } = await supabase
      .from('store')
      .select('value')
      .eq('key', 'vift_offerEvents')
      .maybeSingle()

    const offerEvents: unknown[] = Array.isArray(evRow?.value) ? evRow.value as unknown[] : []
    const eventId = `OEV-${Date.now().toString(36).toUpperCase()}`

    offerEvents.push({
      id:           eventId,
      type:         'email_sent',
      offerId,
      offerVersion: offerVersion ?? null,
      sentAt,
      sentBy,
      recipients:   normalizedTo.map(r => r.email),
      cc:           (cc ?? []).filter(isValidEmail),
      bcc:          (bcc ?? []).filter(isValidEmail),
      subject,
      templateId:   templateId ?? null,
      messageId,
      status:       sendStatus,
      error:        sendError || null,
      attachmentCount: (attachmentIds ?? []).length,
    })

    if (offerEvents.length > 10_000) offerEvents.splice(0, offerEvents.length - 10_000)

    await supabase
      .from('store')
      .upsert({ key: 'vift_offerEvents', value: offerEvents }, { onConflict: 'key' })
  } catch (logErr) {
    console.error('[send-offer-email] Failed to log event:', logErr)
  }

  if (sendStatus === 'failed') {
    return err({ error: 'send_failed', detail: sendError }, 500)
  }

  return ok({ ok: true, messageId, sentAt })
})
