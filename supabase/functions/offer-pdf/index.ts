/**
 * offer-pdf — Supabase Edge Function (Leverans E, Del E2b-4)
 *
 * Genererar en samlad PDF för en offert:
 *   1. Offertens textinnehåll (fakta, rader, totaler, villkor)
 *   2. Valda PDF-bilagor (infogas sida för sida med pdf-lib)
 *   3. Bilder konverteras till PDF-sidor (JPEG/PNG via pdf-lib embed)
 *
 * FORMAT SOM KAN INFOGAS:
 *   - application/pdf          → kopieras in sida för sida
 *   - image/jpeg, image/png    → inbäddas som helsidesbilder
 *
 * FORMAT SOM INTE KAN INFOGAS (anges i svaret):
 *   - .docx, .xlsx, .pptx, .doc, .xls, .txt, .csv, .zip, .dwg etc.
 *   Dessa listas separat i svaret. Kräver konvertering som EJ görs här.
 *
 * SÄKERHET:
 *   - Kräver giltig JWT (Authorization: Bearer) — intern CRM-användare
 *   - Läser bara bilagor med includeInCombinedPdf=true och active=true
 *   - offerId valideras mot store — okänt offerId → 404
 *   - Signerade nedladdnings-URL:er (1 timme) används för att hämta bilagorna
 *
 * POST /functions/v1/offer-pdf
 * Body: { offerId: string, includeAttachments?: boolean }
 * Svar 200: application/pdf (binär)
 * Svar 404: { error: 'not_found' }
 * Svar 403: { error: 'forbidden' }
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1'
import { checkViftAuth, hasPerm } from '../_shared/vift-auth.ts'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const STORAGE_BUCKET   = 'offer-attachments'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

/* ── Rate-limit ───────────────────────────────────────────── */
const _rateMap = new Map<string, { count: number; windowStart: number }>()

function checkRateLimit(ip: string): boolean {
  const now  = Date.now()
  const slot = _rateMap.get(ip)
  if (!slot || now - slot.windowStart > 60_000) {
    _rateMap.set(ip, { count: 1, windowStart: now }); return true
  }
  slot.count++; return slot.count <= 10
}

/* ── Handler ─────────────────────────────────────────────── */
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRateLimit(ip)) return json({ error: 'rate_limited' }, 429)

  const authHeader = req.headers.get('authorization') || ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!jwt) return json({ error: 'forbidden' }, 403)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const auth = await checkViftAuth(supabase, jwt, CORS)
  if (!auth.ok) return auth.response
  const { perms } = auth

  if (!hasPerm(perms, 'offer_manage')) {
    return json({ error: 'forbidden' }, 403)
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const offerId           = String(body.offerId ?? '').trim()
  const includeAtts       = body.includeAttachments !== false

  if (!offerId) return json({ error: 'missing_offerId' }, 400)

  /* Hämta offert */
  const { data: offRow } = await supabase
    .from('store').select('value').eq('key', 'vift_offers').maybeSingle()
  const offers: Record<string, unknown>[] =
    Array.isArray(offRow?.value) ? offRow.value as Record<string, unknown>[] : []
  const off = offers.find(o => o.id === offerId)
  if (!off) return json({ error: 'not_found' }, 404)

  /* Hämta bilagor */
  const embeddableAtts: Record<string, unknown>[] = []
  const skippedAtts: Record<string, unknown>[]    = []

  if (includeAtts) {
    const { data: attRow } = await supabase
      .from('store').select('value').eq('key', 'vift_offerAttachments').maybeSingle()
    const allAtts: Record<string, unknown>[] =
      Array.isArray(attRow?.value) ? attRow.value as Record<string, unknown>[] : []

    allAtts
      .filter(a => a.offerId === offerId && a.active !== false && a.includeInCombinedPdf === true)
      .sort((a, b) => (Number(a.sortOrder)||0) - (Number(b.sortOrder)||0))
      .forEach(a => {
        const mime = String(a.mimeType || '')
        if (mime === 'application/pdf' || mime.startsWith('image/jpeg') ||
            mime.startsWith('image/png') || mime === 'image/jpg') {
          embeddableAtts.push(a)
        } else {
          skippedAtts.push(a)
        }
      })
  }

  /* Skapa PDF */
  const pdfDoc  = await PDFDocument.create()
  const font    = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontB   = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const PAGE_W  = 595  /* A4 punkter */
  const PAGE_H  = 842
  const MARGIN  = 56
  const COL_W   = PAGE_W - MARGIN * 2

  /* ── Hjälpfunktioner för textsättning ─────────────────── */
  type PageCtx = { page: ReturnType<typeof pdfDoc.addPage>, y: number }

  function newPage(): PageCtx {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H])
    return { page, y: PAGE_H - MARGIN }
  }

  function drawText(ctx: PageCtx, text: string, opts: {
    size?: number; bold?: boolean; color?: [number,number,number]; indent?: number; lineH?: number
  } = {}): PageCtx {
    const size  = opts.size   ?? 10
    const f     = opts.bold   ? fontB : font
    const col   = opts.color  ? rgb(opts.color[0]/255, opts.color[1]/255, opts.color[2]/255) : rgb(0.1, 0.1, 0.1)
    const x     = MARGIN + (opts.indent ?? 0)
    const lh    = opts.lineH ?? (size * 1.5)

    /* Automatisk radbrytning */
    const words = String(text || '').split(' ')
    const lineW = COL_W - (opts.indent ?? 0)
    let   line  = ''

    const flush = (l: string) => {
      if (ctx.y < MARGIN + 40) {
        ctx = newPage()
      }
      ctx.page.drawText(l, { x, y: ctx.y, size, font: f, color: col })
      ctx.y -= lh
    }

    for (const word of words) {
      const test  = line ? line + ' ' + word : word
      const tw    = f.widthOfTextAtSize(test, size)
      if (tw > lineW && line) {
        flush(line)
        line = word
      } else {
        line = test
      }
    }
    if (line) flush(line)
    return ctx
  }

  function drawHRule(ctx: PageCtx, color = [200, 200, 200]): PageCtx {
    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y },
      end:   { x: PAGE_W - MARGIN, y: ctx.y },
      thickness: 0.5,
      color: rgb(color[0]/255, color[1]/255, color[2]/255)
    })
    ctx.y -= 8
    return ctx
  }

  /* ── Offertinnehåll ───────────────────────────────────── */
  let ctx = newPage()

  /* Rubrik */
  ctx.y -= 8
  ctx = drawText(ctx, String(off.title || ('Offert ' + off.id)), { size: 20, bold: true, color: [30,64,175] })
  ctx.y -= 4
  ctx = drawText(ctx, 'Version ' + (Number(off.versionNumber)||1) + ' · ' + String(off.id), { size: 9, color: [120,120,120] })
  ctx.y -= 6
  ctx = drawHRule(ctx, [180, 200, 240])

  /* Kundinfo */
  const cuName = String(off.customerName || '')
  const coName = String(off.contactName  || '')
  const coMail = String(off.contactEmail || '')
  const addr   = String(off.address      || '')
  const date   = String((off.date || off.createdAt || '').slice(0,10))
  const until  = String((off.validUntil  || '').slice(0,10))

  const facts: [string,string][] = [
    ['Kund',        cuName || '–'],
    ['Kontakt',     coName ? (coName + (coMail ? ', ' + coMail : '')) : coMail || '–'],
    ['Fastighet',   addr || '–'],
    ['Offertdatum', date || '–'],
  ]
  if (until) facts.push(['Giltig till', until])

  ctx.y -= 8
  for (const [k, v] of facts) {
    const rowY = ctx.y
    ctx.page.drawText(k + ':', { x: MARGIN, y: rowY, size: 9, font: fontB, color: rgb(0.3,0.3,0.3) })
    ctx.page.drawText(v,        { x: MARGIN + 90, y: rowY, size: 9, font: font, color: rgb(0.1,0.1,0.1) })
    ctx.y -= 14
  }
  ctx.y -= 8

  /* Offertposter — rubrikrad */
  ctx = drawHRule(ctx)
  ctx.page.drawText('Beskrivning',   { x: MARGIN,     y: ctx.y, size: 9, font: fontB, color: rgb(0.3,0.3,0.3) })
  ctx.page.drawText('Antal',         { x: MARGIN + 270, y: ctx.y, size: 9, font: fontB, color: rgb(0.3,0.3,0.3) })
  ctx.page.drawText('À-pris',        { x: MARGIN + 320, y: ctx.y, size: 9, font: fontB, color: rgb(0.3,0.3,0.3) })
  ctx.page.drawText('Summa',         { x: PAGE_W - MARGIN - 60, y: ctx.y, size: 9, font: fontB, color: rgb(0.3,0.3,0.3) })
  ctx.y -= 6
  ctx = drawHRule(ctx)

  const fmt = (n: number) => n.toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  const allLines = [...(Array.isArray(off.lines)?off.lines as Record<string,unknown>[]:[])]
  for (const l of allLines) {
    if (l.type === 'text') {
      ctx = drawText(ctx, String(l.text || l.description || ''), { size: 9, color: [80,80,80], indent: 0 })
      ctx.y -= 2
      continue
    }
    if (ctx.y < MARGIN + 40) ctx = newPage()
    const desc  = String(l.description || l.templateName || '')
    const qty   = Number(l.qty || 0)
    const up    = Number(l.unitPrice || 0)
    const tot   = Number(l.total || qty * up)
    ctx.page.drawText(desc.slice(0,55), { x: MARGIN,    y: ctx.y, size: 9, font, color: rgb(0.1,0.1,0.1) })
    ctx.page.drawText(qty + ' ' + String(l.unit||'st'), { x: MARGIN+270, y: ctx.y, size: 9, font, color: rgb(0.2,0.2,0.2) })
    ctx.page.drawText(fmt(up) + ' kr', { x: MARGIN+320, y: ctx.y, size: 9, font, color: rgb(0.2,0.2,0.2) })
    ctx.page.drawText(fmt(tot) + ' kr',{ x: PAGE_W-MARGIN-60, y: ctx.y, size: 9, font, color: rgb(0.1,0.1,0.1) })
    ctx.y -= 14
  }

  ctx.y -= 4
  ctx = drawHRule(ctx)

  /* Totaler */
  const taxType   = String(off.taxType || 'moms')
  const rotRut    = Number(off.rotRutAmount || 0)
  const discount  = Number(off.discount || 0)
  const sumExVat  = allLines.filter(l=>l.type!=='text').reduce((s,l)=>s+Number(l.exVat||l.total||0),0)
  const vatAmt    = allLines.filter(l=>l.type!=='text').reduce((s,l)=>s+Number(l.total||0)*0.25,0)
  const sumInkVat = allLines.reduce((s,l)=>s+Number(l.total||0)*(1+(l.type!=='text'?0.25:0)),0)
  const afterRot  = sumInkVat - rotRut

  const totRows: [string, string, boolean][] = [
    ['Summa exkl. moms', fmt(sumExVat) + ' kr', false],
    ['Moms (25%)',       fmt(vatAmt)   + ' kr', false],
    ['Summa inkl. moms', fmt(sumInkVat) + ' kr', true],
  ]
  if (discount > 0) totRows.splice(0,0,['Rabatt','-'+fmt(discount)+' kr', false])
  if (rotRut > 0)   totRows.push(['ROT/RUT-avdrag','-'+fmt(rotRut)+' kr', false],['Att betala efter avdrag', fmt(afterRot)+' kr', true])

  for (const [k,v,bold] of totRows) {
    if (ctx.y < MARGIN+40) ctx = newPage()
    ctx.page.drawText(k+':',       { x: MARGIN+270,       y: ctx.y, size: bold?10:9, font: bold?fontB:font, color: rgb(0.1,0.1,0.1) })
    ctx.page.drawText(v,           { x: PAGE_W-MARGIN-80, y: ctx.y, size: bold?10:9, font: bold?fontB:font, color: rgb(0.1,0.1,0.1) })
    ctx.y -= bold?16:13
  }
  ctx.y -= 8

  /* Villkor (kortform) */
  const terms = [
    ['Betalningsvillkor', off.paymentTerms],
    ['Giltighetsbetingelse', off.validityText],
    ['Villkor', off.terms],
    ['Omfattning', off.scope],
    ['Allmänna villkor', off.generalTerms]
  ].filter(([,v]) => v) as [string,string][]

  if (terms.length) {
    ctx = drawHRule(ctx)
    ctx.y -= 4
    for (const [k,v] of terms) {
      ctx = drawText(ctx, k + ': ' + String(v), { size: 8, color: [80,80,80] })
      ctx.y -= 2
    }
  }

  /* ── Bilagor — infoga PDF/bilder ─────────────────────── */
  for (const a of embeddableAtts) {
    const mime = String(a.mimeType || '')
    const path = String(a.storagePath || '')
    const pathInBucket = path.replace(`${STORAGE_BUCKET}/`, '')

    /* Hämta fil från Supabase Storage via signerad URL */
    let fileBytes: Uint8Array | null = null
    try {
      const { data: urlData } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(pathInBucket, 300)
      if (urlData?.signedUrl) {
        const r = await fetch(urlData.signedUrl)
        if (r.ok) fileBytes = new Uint8Array(await r.arrayBuffer())
      }
    } catch(e) {
      console.error('[offer-pdf] fetch attachment:', e)
    }

    if (!fileBytes) continue

    /* Sidavskiljare */
    const sepPage = pdfDoc.addPage([PAGE_W, PAGE_H])
    const attName = String(a.displayName || a.originalFileName || 'Bilaga')
    sepPage.drawText(`Bilaga: ${attName}`, {
      x: MARGIN, y: PAGE_H / 2,
      size: 14, font: fontB, color: rgb(0.2,0.3,0.6)
    })
    if (a.description) {
      sepPage.drawText(String(a.description), {
        x: MARGIN, y: PAGE_H/2 - 22,
        size: 10, font, color: rgb(0.4,0.4,0.4)
      })
    }

    if (mime === 'application/pdf') {
      /* Kopiera PDF-sidor */
      try {
        const donorPdf = await PDFDocument.load(fileBytes)
        const pageIdxs = donorPdf.getPageIndices()
        const copied   = await pdfDoc.copyPages(donorPdf, pageIdxs)
        for (const pg of copied) pdfDoc.addPage(pg)
      } catch(e) {
        console.error('[offer-pdf] PDF embed:', e)
      }
    } else if (mime === 'image/jpeg' || mime === 'image/jpg') {
      try {
        const img  = await pdfDoc.embedJpg(fileBytes)
        const pg   = pdfDoc.addPage([PAGE_W, PAGE_H])
        const dims = img.scaleToFit(COL_W, PAGE_H - MARGIN*2)
        pg.drawImage(img, {
          x: MARGIN, y: MARGIN + (PAGE_H - MARGIN*2 - dims.height)/2,
          width: dims.width, height: dims.height
        })
      } catch(e) {
        console.error('[offer-pdf] JPEG embed:', e)
      }
    } else if (mime === 'image/png') {
      try {
        const img  = await pdfDoc.embedPng(fileBytes)
        const pg   = pdfDoc.addPage([PAGE_W, PAGE_H])
        const dims = img.scaleToFit(COL_W, PAGE_H - MARGIN*2)
        pg.drawImage(img, {
          x: MARGIN, y: MARGIN + (PAGE_H - MARGIN*2 - dims.height)/2,
          width: dims.width, height: dims.height
        })
      } catch(e) {
        console.error('[offer-pdf] PNG embed:', e)
      }
    }
  }

  /* Sista sida — skippade format */
  if (skippedAtts.length) {
    const lastPage = pdfDoc.addPage([PAGE_W, PAGE_H])
    let ly = PAGE_H - MARGIN
    lastPage.drawText('Separata bilagor (kan ej infogas i PDF):', {
      x: MARGIN, y: ly, size: 11, font: fontB, color: rgb(0.3,0.3,0.3)
    })
    ly -= 20
    for (const a of skippedAtts) {
      lastPage.drawText('• ' + String(a.displayName || a.originalFileName || 'Bilaga') + '  (' + String(a.mimeType||'') + ')', {
        x: MARGIN, y: ly, size: 9, font, color: rgb(0.3,0.3,0.3)
      })
      ly -= 14
    }
  }

  /* Sidnumrering */
  const pageCount = pdfDoc.getPageCount()
  for (let i = 0; i < pageCount; i++) {
    const pg = pdfDoc.getPage(i)
    pg.drawText(`${i+1} / ${pageCount}`, {
      x: PAGE_W - MARGIN - 30, y: MARGIN/2,
      size: 8, font, color: rgb(0.6,0.6,0.6)
    })
  }

  const pdfBytes = await pdfDoc.save()

  return new Response(pdfBytes, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="offert-${offerId}.pdf"`,
      'Content-Length':      String(pdfBytes.byteLength)
    }
  })
})

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}
