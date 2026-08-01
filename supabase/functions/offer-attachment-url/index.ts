/**
 * offer-attachment-url — Supabase Edge Function (Leverans E, Del E2b-3, v3)
 *
 * Genererar en tidsbegränsad signerad URL för nedladdning av offertbilaga.
 * Två separata autentiseringsvägar:
 *
 *  A. Publik tokenväg (kund utan inloggning):
 *     Body: { token: string, attachmentId: string }
 *     Kontroller: giltig token → ej återkallad → ej utgången →
 *                 bilaga tillhör offerten →
 *                 snapshot.publicAttachmentIds (om finns) ELLER includeInPublicView=true →
 *                 bilaga aktiv → URL
 *
 *  B. Intern JWT-väg (CRM-användare):
 *     Headers: Authorization: Bearer <JWT>
 *     Body: { attachmentId: string, offerId: string, offerVersion?: number }
 *     Kontroller: giltig JWT → app_users.active → offer_manage-behörighet →
 *                 bilaga aktiv → bilaga tillhör angiven offert →
 *                 offert existerar → valfri versionsmatchning → URL
 *
 * Signerad URL: TTL = 600 s (10 min), reusable under TTL
 *
 * ── Testfall ──────────────────────────────────────────────────────────
 * Ersätt <URL>, <JWT-utan-offer_manage>, <JWT-med-offer_manage>, <TOKEN>,
 * <ATTACHMENT_ID>, <OFFER_ID> med verkliga värden vid testning.
 *
 * 1. JWT-väg utan offer_manage → 403
 *    curl -X POST <URL>/functions/v1/offer-attachment-url \
 *      -H "Authorization: Bearer <JWT-utan-offer_manage>" \
 *      -H "Content-Type: application/json" \
 *      -d '{"attachmentId":"<ATTACHMENT_ID>","offerId":"<OFFER_ID>"}'
 *    Förväntat: {"error":"forbidden"}  HTTP 403
 *
 * 2. Inaktiv användare → 403
 *    curl -X POST <URL>/functions/v1/offer-attachment-url \
 *      -H "Authorization: Bearer <JWT-inaktiv-användare>" \
 *      -H "Content-Type: application/json" \
 *      -d '{"attachmentId":"<ATTACHMENT_ID>","offerId":"<OFFER_ID>"}'
 *    Förväntat: {"error":"Forbidden"}  HTTP 403
 *
 * 3. Manipulerat attachmentId (tillhör annan offert) → 403
 *    curl -X POST <URL>/functions/v1/offer-attachment-url \
 *      -H "Authorization: Bearer <JWT-med-offer_manage>" \
 *      -H "Content-Type: application/json" \
 *      -d '{"attachmentId":"<ID-FÖR-BILAGA-TILLHÖRANDE-OFF-999>","offerId":"<OFFER_ID>"}'
 *    Förväntat: {"error":"forbidden"}  HTTP 403
 *
 * 4. Bilaga från annan offert (offerId stämmer ej) → 403
 *    curl -X POST <URL>/functions/v1/offer-attachment-url \
 *      -H "Authorization: Bearer <JWT-med-offer_manage>" \
 *      -H "Content-Type: application/json" \
 *      -d '{"attachmentId":"<ATTACHMENT_ID>","offerId":"ANNAN-OFFER-ID"}'
 *    Förväntat: {"error":"forbidden"}  HTTP 403
 *
 * 5. Borttagen bilaga (active=false) → 404
 *    curl -X POST <URL>/functions/v1/offer-attachment-url \
 *      -H "Authorization: Bearer <JWT-med-offer_manage>" \
 *      -H "Content-Type: application/json" \
 *      -d '{"attachmentId":"<RADERAD-ATTACHMENT-ID>","offerId":"<OFFER_ID>"}'
 *    Förväntat: {"error":"not_found"}  HTTP 404
 *
 * 6. Korrekt intern åtkomst → 200
 *    curl -X POST <URL>/functions/v1/offer-attachment-url \
 *      -H "Authorization: Bearer <JWT-med-offer_manage>" \
 *      -H "Content-Type: application/json" \
 *      -d '{"attachmentId":"<ATTACHMENT_ID>","offerId":"<OFFER_ID>"}'
 *    Förväntat: {"url":"https://...","expiresAt":"...","fileName":"...","mimeType":"..."}  HTTP 200
 *
 * 7. Korrekt publik tokenåtkomst → 200
 *    curl -X POST <URL>/functions/v1/offer-attachment-url \
 *      -H "Content-Type: application/json" \
 *      -d '{"token":"<PUBLIK-TOKEN>","attachmentId":"<ATTACHMENT_ID>"}'
 *    Förväntat: {"url":"https://...","expiresAt":"...","fileName":"...","mimeType":"..."}  HTTP 200
 * ──────────────────────────────────────────────────────────────────────
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkViftAuth, hasPerm } from '../_shared/vift-auth.ts'

const SUPABASE_URL           = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const STORAGE_BUCKET         = 'offer-attachments'
const SIGNED_URL_TTL_SECONDS = 600   /* 10 min — reusable under TTL, INTE engångs */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control':                'no-store, no-cache',
  'Referrer-Policy':              'no-referrer',
  'X-Content-Type-Options':       'nosniff',
  'X-Frame-Options':              'DENY',
}

/* ── Rate-limit ───────────────────────────────────────────── */
const _rateMap = new Map<string, { count: number; windowStart: number }>()
const RATE_WINDOW_MS  = 60_000
const RATE_MAX_PER_IP = 60

function checkRateLimit(ip: string): boolean {
  const now  = Date.now()
  const slot = _rateMap.get(ip)
  if (!slot || now - slot.windowStart > RATE_WINDOW_MS) {
    _rateMap.set(ip, { count: 1, windowStart: now })
    return true
  }
  slot.count++
  return slot.count <= RATE_MAX_PER_IP
}

/* ── Säker path-validering ───────────────────────────────── */
function isValidStoragePath(path: string): boolean {
  if (!path || typeof path !== 'string') return false
  if (path.includes('..') || path.includes('//') || path.startsWith('/')) return false
  if (!/^offer-attachments\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[^/]+$/.test(path)) return false
  return true
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}


function parseValidSnapshot(raw: unknown, offerId: string): Record<string, unknown> | null {
  try {
    if (!raw) return null
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const snap = parsed as Record<string, unknown>
    if (String(snap.id ?? '') !== offerId) return null
    if (!Array.isArray(snap.lines) || !Array.isArray(snap.extras) || !Array.isArray(snap.publicAttachmentIds)) return null
    return snap
  } catch { return null }
}

/* ── Handler ─────────────────────────────────────────────── */
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRateLimit(ip)) return json({ error: 'rate_limited' }, 429)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const attachmentId  = String(body.attachmentId  ?? '').trim()
  const customerToken = String(body.token          ?? '').trim()
  const mode          = body.mode === 'view' ? 'view' : 'download'

  if (!attachmentId) return json({ error: 'not_found' }, 404)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  /* ── Hämta bilagor (delat av båda vägarna) ──────────────── */
  const { data: attRow } = await supabase
    .from('store')
    .select('value')
    .eq('key', 'vift_offerAttachments')
    .maybeSingle()

  const attachments: Record<string, unknown>[] =
    Array.isArray(attRow?.value) ? attRow.value as Record<string, unknown>[] : []

  const att = attachments.find(a => a.id === attachmentId)

  /* Borttagen eller saknad bilaga avslöjar ingenting om anledning */
  if (!att || att.active === false) return json({ error: 'not_found' }, 404)

  /* ── Välj autentiseringsväg ──────────────────────────────── */
  const authHeader = req.headers.get('authorization') || ''
  const jwt        = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  if (customerToken && customerToken.length >= 32 && !jwt) {
    /* ════════════════════════════════════════════════════════
     * A. PUBLIK TOKENVÄG — kund utan Supabase-konto
     * ════════════════════════════════════════════════════════ */

    const { data: offRow } = await supabase
      .from('store').select('value').eq('key', 'vift_offers').maybeSingle()
    const offers: Record<string, unknown>[] =
      Array.isArray(offRow?.value) ? offRow.value as Record<string, unknown>[] : []

    const offer = offers.find(o => o.publicToken === customerToken)

    /* Token okänd eller återkallad */
    if (!offer || offer.tokenRevokedAt) {
      return json({ error: 'forbidden' }, 403)
    }

    /* Token utgången */
    if (offer.tokenExpiresAt) {
      if (Date.now() > new Date(offer.tokenExpiresAt as string).getTime()) {
        return json({ error: 'expired' }, 410)
      }
    }

    /* Verifiera att bilagan tillhör denna offert */
    if (att.offerId !== offer.id) {
      return json({ error: 'forbidden' }, 403)
    }

    /* Giltigt snapshot låser exakt vilka kundbilagor som hör till denna token. */
    const snapshot = parseValidSnapshot(offer.lockedSnapshotJSON, String(offer.id ?? ''))
    const allowed = snapshot
      ? (snapshot.publicAttachmentIds as unknown[]).map(id => String(id)).includes(attachmentId)
      : att.includeInPublicView === true
    if (!allowed) {
      return json({ error: 'forbidden' }, 403)
    }

    /* Alla publika kontroller godkända — fall through till URL-generering */

  } else if (jwt) {
    /* ════════════════════════════════════════════════════════
     * B. INTERN JWT-VÄG — inloggad CRM-användare
     * ════════════════════════════════════════════════════════ */

    /* 1. Aktiv VIFT-användare + personal + roll */
    const auth = await checkViftAuth(supabase, jwt, CORS)
    if (!auth.ok) return auth.response

    const { perms } = auth

    /* 2. Kräver offer_manage eller all */
    if (!hasPerm(perms, 'offer_manage')) {
      return json({ error: 'forbidden' }, 403)
    }

    /* 3. offerId krävs i body för att förhindra IDOR */
    const offerId = String(body.offerId ?? '').trim()
    if (!offerId) {
      return json({ error: 'offerId required for internal access' }, 400)
    }

    /* 4. Bilagan måste tillhöra angiven offert */
    if (att.offerId !== offerId) {
      return json({ error: 'forbidden' }, 403)
    }

    /* 5. Offerten måste existera i store */
    const { data: offRow } = await supabase
      .from('store').select('value').eq('key', 'vift_offers').maybeSingle()
    const offers: Record<string, unknown>[] =
      Array.isArray(offRow?.value) ? offRow.value as Record<string, unknown>[] : []

    const offer = offers.find(o => o.id === offerId)
    if (!offer) {
      return json({ error: 'not_found' }, 404)
    }

    /* 6. Valfri versionsmatchning — om offerVersion anges kontrolleras bilagan */
    const offerVersionRaw = body.offerVersion
    if (offerVersionRaw !== undefined && offerVersionRaw !== null) {
      const requestedVersion = String(offerVersionRaw)
      const attachmentVersion = String(att.offerVersionId ?? '')
      if (attachmentVersion && attachmentVersion !== requestedVersion) {
        return json({ error: 'version_mismatch' }, 409)
      }
    }

    /* Alla interna kontroller godkända — fall through till URL-generering */

  } else {
    /* Varken token eller JWT — neka utan ledtråd */
    return json({ error: 'forbidden' }, 403)
  }

  /* ── Validera storage path (delat, sker efter auth) ─────── */
  const storagePath = String(att.storagePath ?? '')
  if (!isValidStoragePath(storagePath)) return json({ error: 'invalid_path' }, 400)

  /* ── Generera signerad URL ───────────────────────────────── */
  const pathInBucket = storagePath.replace(`${STORAGE_BUCKET}/`, '')
  const fileName = String(att.displayName || att.originalFileName || 'bilaga')

  const { data: signedData, error: signedErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(
      pathInBucket,
      SIGNED_URL_TTL_SECONDS,
      mode === 'download' ? { download: fileName } : {}
    )

  if (signedErr || !signedData?.signedUrl) {
    console.error('[offer-attachment-url] signedUrl fel')
    return json({ error: 'storage_error' }, 500)
  }

  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString()

  /* Logga aldrig URL, token eller signerat värde */
  return json({
    url:         signedData.signedUrl,
    expiresAt,
    fileName:    String(att.displayName || att.originalFileName || 'bilaga'),
    mimeType:    String(att.mimeType    || 'application/octet-stream'),
    sizeBytes:   Number(att.sizeBytes   || 0),
    description: String(att.description || '')
  })
})
