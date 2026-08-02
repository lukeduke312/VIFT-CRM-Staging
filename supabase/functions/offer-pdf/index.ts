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


const LOGO_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAZAAAACuCAYAAAAYuFulAAAx4klEQVR4nO2dB7gkRbWAa3p9KCKrhEUeQeApKCpREBAEJCuoi0tURER4AmIiqBiIguQoSngiigFRBMGAmFZReSAgJlBECUtWUCRLeO/8t07vrdu3Z6Zqumd65t7zf199u3emp7s61ak60TnDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMIxpRdZ0BwzDMIzR5BRpSzXdCcMwDGPEyLLs9lardY3893XS/qPp/hiGYRgjggiQedKeESEyT/48QNp/Nt0nwzAMYwRAgMyYMeP/aPL/x0SQXCQfb+DMNmIYhmF0IhQgKkSeFiFys3z1DmcqLcMwDKMdRQGSNxEi/5avT5Y2S1qr4W4ahmEYw0Y7AaKrEWwjP5fN3iDtuU331TAMwxgiOgmQXKUl7RbZ9BBpL2i6v4ZhGMaQ0E2A5CsRaY/KauQn8pMXN91nwzAMYwiIESAF28g98rOdnKm0DMMwpjepAkRXI/fLT0+Q9pKm+28YhmE0RKoAUSFCe0J+PlfabGkzmj0LwzAMY+D0IkAKq5H7ZDeHSZvZ9LkYhmEYA6SKAAkEyZOyqwucV2lZBLthGMZ0oA4BEsSM/F52+VZpizR9XoZhGEafqUuABIIEA/vpzgzshmEYU5s+CBDsIk/IauRXsvt1mz4/wzAMo0/ULUAKwuQROcQHpD2/6fM0DMMwaqafAkSFyONymK9IW8NNLQP7c6S9XNqqke2l0p7VSE/ToI8vc/HnxTVYqM2+SMK5SsK+lq2h/zMTjjdMbQk3nrSUe7DCEPSp7rZku5tmjCj9FiAzxr20yOw7laLXeeG/12q1ro1sc91ovEAbSV9/GXtezk8O2uVIe1HC9WFf76+h/zukHHNIGhVBt3fjAgRBes4Q9KvWJue0XQ331xgmBiFAVIicK4dbuOnzrZEZ8lJcrUGVMef/tPxms6Y73YUF5Zyux44Va+9yflBol+5/Tsy1yZtsv2vVE5DjnZlyzGFo0t9/SNe3DU5jXfnsxlE7j4jnf4Oq99cYMgYsQJ7X9PnWzPEp10C2P7zpDncAtcmnUgYEaed12edxCfsjs8HLajiP65oeLHt4N/7oJjqczEaoNN2vOptMTO6W81q6hvtrDBMDsIHglfVPOdTBztsNilCDnZnJKAqXrRNfop813eEObEFWgdh7KufyO/nNih32x6rkJwnPyU3OPwtVWASbW9ODZer70fJZrpfXcyAt0PsR0E33rc4m5/hjOa/FKt5fY9josxcWLwezq32kLVU4NOVy3yjff0faN0q+HwUWI819wvX4lxvOmirLyD24WPr3VOR5oHLZy3V2ClhC9nlLwgDzLVf92rxu1NQ+OsHCjpTbB3FI+EysGnFUmpzP6W5q2UAN6JcAkf1SEvcs5w2CxdrqCAtekr/pi/J9N5oCxMnA94uUwUJ+smnTfS6AENhH+vZwzKClk4KLnS913InXpKxoZPvjXPkKNYWDmh4oe3hPUN0dEZzDoszWm+5XzeeI/eM9bmp5YRpQpwDJs/TKC/Br542CxRkqRvQ3oP4oDFYjK0CET6bMFmX7I5vucIEV5X7clHCP0WXHOAPszoorcp946e3u2hvjY7mo6cGyh3fmQen324NzYDV4R9P9qvkc/y7n9caK99YYRmrOhfUX52eSxaqFzCzXd9418bGS34+yANk8VvVDk+2xgwxL+nvuy3kJXlfMJI9ycTPJY1iFRu6XImWvr3guz5Nn609ND5Y9vDf3St/XDs5j3ZTnaRSanA/2srUq3l9jGKkqQFSH+5DqcTdxk9VVxEscKi/3jfmLwYwT9Qb/6n5GWYAQ63BnwvWa5+oJmKuDPVOMzuoEEGMIXVj2e0GsYMJ12PlA0yqsyuqo6cGyh/fnr26i7WffUbPjdBsf5P5e7swDa2pSVYCoe947XbkBdCv5/rdyjMfywUQj00+Vtj/Ld93PKAsQdNbfT3ihHpDfbN10p4VXsGJMuM8YzmNzm71Ytr8iMj6Gfddx/3fE2y/yfJj03CLtuqab9PuMwnmcgZNCje2fwUQt5n78u+bjP5B5A/ooZGEwUulFgGQ+BoAB5atu8ouPegYV1ukIjuA3j8lAcZW0G+S7N0vbKXjhR1mAPEfO47gENdBj8puPNtxnPH3Oih1YMu8Q8SkXb+ReP9auos/SOa76AHNw7GpqyHXy2IGyGtsyKd5wsv25NR8/c9VtW8awkipAeEnlgfyR/HRnaQsUdvdCabuTmiFTP3bUVqi45LPL+F7+/ambWgKEl+OdobCMGDC/4Kp7HPUKL/R20ocotZuqIK6U37wi4RjbBavLQQjUZ3NNs8jYiZavW7N2171ODVbPIm1RKkD2brrDxgiRIkDwDpGffNhNrjyIINlSvr9I9vevfDaOwVw+P03+PtP5mc3CU1CAAPEHtyUMyHPdeODYoEGIz01YMRG78i4Xb/hnJbF/7GCuK9m3VDwnZtk/SHiOmQANix2q37wr4V7jTr1m0x02RogYAaIqjAudz7xaXHWQ/fRYbCHBquNpDMsYzp133X2fm9oCZMXEeJCbXXN5gQ5L0YlrgF/Kamkh2f/ZsYOW2tBSVjdlrIVreOwgKe2LbvJzPFU5M+G5fMg1tzI2RpFOAiTz/vl4iRBJXowiRY++OTaNTI2lqp55VD4/SdpsaT/3h8jel2kyxSkqQJ4r5/KVhJkedVJ2aqCf68ixn0gQHvfJb5ZLPMZi3OOEY5Cp4NkVz2vrLD5o8XFph1Q83sgQK1j1XlzRdH+NEaOdAJHP72EmKZu8svATVBnrSPusPHAPB9vjbXGBGslf5/wMe7oIEDgkwYiLqoDEilUHzhSWYoBImI0+LL/Zs4fjLCvHuSfhOF+reF6oUvdKcAggL9uOFY85Kiwaa5ujyfbHN91hY/hgYG6bRr2DAGGZv2hhc2IAPqquuU8Gqw5mdXhkLSnfITSmowBJyqCq6UAGlRcLQYWXUlTeLlXznN9j/16bpQVWfrDiuS0o7cSE1R9Bi6tVPOaosEmi/WP7pjtsDA/oePfGddb5anildBAgqKEW1M3wNNpM9vUrBqFsPKaDyOQTpX1a/10wFCD6/+kiQFZICSiUbVENVs0+G8sGcq1vShhMsNG8rsdjHRB7HBUg61U8t0VIyJlFBt/Jtpzbgl33OjX4cOx1UW+4lZrusNE8CA7SBnw78xHfGClf3m7jSAGyXJ7gTWenjzAASkMdgNGNVO3TXYCg2rsqduBkli7bv3oA/aIe/bkJwuMJacR8FDMKxPK1hGvAoNWuHG4s/5kYEHlhxeONEpckXJc/OO+Gb0xTWCWsLO0T6lKarxLqEiA/0c/x1EBgzJbPbnUmQEJSC0ztP4A+7YLATxhIWLGmGs5zqNJ4a8Kx/reG81stxTHAeTf06QC5wf6ccC8oqfD8pjttNAO66v/GlbRoTOyDACEWhLw265oAmcRWieqbS/vcn5ewUkxYEeAdtmWF45EXLCVo7dQaznH3BDUNx9yohmOOAgQQRjkzqP2DJJmDdOowhgTsG5dkQQCfqq5yI3etAkSDCdHdmwCZzMKxnlh6jVEB9qoq6gb7vTjRiHqsq5YpeE7i8XauepKynzMSZtnEM7V1KJliROcGy3ycVx3p9I0RAddFCvp8CJVS/kJmPs3Ib+TzfYg2NgEyeHooMLVOH7rB87Gb9CU2nQjR8de46jrwYxLOnUJKK1c9UZ73BAFyddXjjRApbuWMEVs13WFjMBD5vQNG7WCV8aTGXxzmfPp0fPF/2A8BoiosEyDtOSxWpUKT7T/Shz6srOrM2NXA3+Q3u7hqq49WPmmJPCYBhEtWPM9FYl2T9VqfXvF4owLv5Bez+HQyFICbLq7N0xrSaVMA6O5AXfWItM85H3eRZzQ1AdIcm8a+uDorJslknaoD7tlRWXxyR9SdxPzE1PnoxKxEA3odcTCvS1SZ7VLxeKPCWG6wmGujq8/vuerC3BhiFpF2sNzoedl4USZu/E3O15Z4XmF7EyDNwbW/K2EgvcV1ry+eAulK7o8dWOmrqyeBHvf7bwkrkKNd9bxLKXEO6Pkrq8xGhLHcYDHXJvOBwExAh6VKplEjDODrycPwsyxIVCiNHEUnOy9YyjAB0hwEtl2WMJBSm6LXoL0iC6HnTzg2sSgfqunYeEOl1EDfw1VfeX0rQVDXoTIbFVJygxGL0w81qtEgeNAwKzwxNITKzX5Y/r5EPt/GdXa5MwHSHFyPYxNUK7jOvr+G4/LMHJ6i0lHVRR3ZVxEEnHNsDfQ6jLYIy6iiVSpAyCo8qNQxTYIDxd5ZZDqZzKfTn910p436YFVxgDzw1wdGctKjY+j6bxeX/sIESHMwmL4jwQZBwS3qpVR1591C9pOqOlur+umOkVQDXbarowb6aolJG89z3uNttQE33r1+uWqXwTt7UsK9QIU5XVR7U54NiQRWw3huJGeJSd3kFV28ntIESLNs3IosI6orgarnTxLLixK8bnChJSK7roGNGug/S1z5VFUnbZ/F10Afy6Ag7d7MZ5keWGv5ao6DDNAbU6HG2obUe9NqgIw4DB4nZOqSmPmYDmqIU3oTdVWqrriSANHjjwkE3cwESBpEgF+RYMjmJe41LxaTCtKZPxxzLF3NUpHvxfWdbiM10KPjHJpscl2+XccFTiA1N9g3Btw/o2aYnRyejXtXPSU39U/Ox3T0OkvrWYCo8CDl9W5u/CU3AZIGVfm+nLAiqFLWlZiP6KJBcqwHXP31MObErgaYGEmrarRNqoHeZJO+fqKOC5zAGrG2KO3fAQPun1EzC8oNPyGYEfzM+ZiOKsvKKgLkQecfqpnBZiZA0vlE7Aw582nxD3LpKiVWH19KMZzL9thbitUlq9BLDfRtKx4zOs6h6SZ93aL6JU5i94Tngf41VVrZqAnURCfkOktXT1WwngSIDmTULy8KLxMg6SQVmJJtv+ImCu0Y3pmllajFcL54zedJOvazEgYtnseXVTzmq1q+qFnjAqLLueKuPGjPr7NirwsTHFfvZMJogKIAOaaGfSYJEFVbsfJ4X5vNlsi8l81TJkCiWYFrlTC4/86l5aJaKdZQr88Bterf1IfzpAb6FQnnWYfRdmvZT1ScQ5NN7+lAwVszoX/XDLp/Rv0MgwDB5kFtivDFZmaZBX+vqmqDec4ESAyZnOsvEwZ4vO1Wjdw3dRs+E6vrzny6kv9xkzMW1AEp3O9OOM+B1kBvskk/P1fD9U0BD6xoxwLnK4kaI06jAkS2u9F54RGqT1aR31Gr4bWFzUkdj0uxCZA4jk4YWLFP7BmxTwbQbWX7O2PURpl3m/2t60/WX9gwxZjtqhfRSqqB3lRLuJ91skmiPWzXAffP6AMTjOhuwALEeY+ccOWxnLqg/lv+vdNNTrNBPQWMtyZAurNlykCndpBuoDKamzBQoLrC66mq22w79kuxRbh6aqB/dwTsH6SJWb2G65vCxxLsH8QCvWLA/TP6QNMCJIeZLXr134cPGrpm5wf8oofQq02AdIUI7ehysqoe7BQsSjzQR1JmmajRXB8NudjGEs4PNV1Vo21qnMOD0m5uoP3C+dIKg+TihHtxs4vLamEMOcMgQBAOm7ZKMnjqIMTDRirsBYLfLC2ff9OZAOnGFQkvNV5wne7VBrHxFjp4Uuejn26a2HmiS+a26qmBvnpinMMJzj+3g26DTF8CqTXQCXBsl4zVGCGaFiDMeLdRt8g84y9JGylY9a9AiNwq273bTYyKJ5qZl8UESHsOjX2p9f7v02Y/zLx/miCMUKH0O8vqi1KM2a6eGujvTIxzqBpzMiqs3orMDabXJcw0YYwwTQuQLVq+zkguPNCN8qKzvN0tn+2pEMHVl/TfoXcWM62POj/TMwEymY0TjcxfL9kH1/vgLD5BIwbSy131ErXdeEui0fatNRzzzAQ9P8dcuoZjjgI7yrsVmw2AyQWJWa0G+hSgKQHCymFb2S6sqY6O+rNuolF9R/n8vnygkO0fdl5gLBRss5LzQuE5JkAmsUyWliWXImFFd9vXED8RO2iqWzbXuN8DxHEJKyKerTpqoF+bcC1vrX6KIwMTjNjMB9g1t266w0Y9NCFA8KTCl/7vweoCffkRbqKdA1hhvA2jmw5OtPvls0PcRNffMeOvCZBJ4DX0vYSB9l43MbHiTPns87GrmMxX3vuM87Ei/aTVSqiB3qqnoNMLYgdJvRZVY05GhaTcYLIdAY6varrTRj30W4Dg2RNmXmV1Qb2RsK46M5ID3fiqApUJA/qzgt/Mkd/cHjyE/3S+KmLRq+YUaRs7EyA5XLujE1Q9D7mJ8QO7ZJGV/nSgJhHnINwzXyj9ui2hX3UUdNo4xS3a1VOoaxRIrYH+Q/nNsk132qiHvgmQzOfi2d1NdA2ltvq/AuHBgLWfGzeoofbYTNqv9Lc57GO90FCn9pJiDicGCbw7TIB4uJ67JqgX0E+fqr/DcB6dDkV1/m9zg9Ft4xGWUgP9WFc9hclBCcfjOr6mhvMcBdaS8/197DPCasVN1jQYI0q/BMhF8u9ewWeorY4vzERYRXzAjQ84/Lte7mevLyH5sUJvjTWJXs/G088jpHggiz7lrzEBMp+N5FxT3F1xsVxG2vkJAyZ1PgZZ22EPJh+RfcsnMlUF20UJ1wM70DLVT3Mk2CZWmDORkXZw0x026qMfAmRR52df+YwPT5TTsqBgVctnZg1XGNg63iyf3xZ6uWBkd95NdzHdDvXWRvj0B0LkcRUQywX7Y4l8mjMBAtEV+/R6oqM+MYuvscH9JCVN1Sy3saTWQGcwf33FY6bGOfCcLdZ1r6NPag10Jo07Nd1poz76IUBCiIY9J58t6mDzZ/lsZzce7MRydtcynbZuf7/2a2HdnoeWFcZVgSrsCfn7Evl8heDYCAUTIM49V871Kwl2EEoa/zPBKIp79Xvd4ILXMOxH10CXe/5rVz2tx6oIogQhTN2ThbrudfRBO3ByFu/ajDCvWo/eGCJ6ESAtF6cOmIkHEIN74IaLwZy03vlgg23jrfL9HQVhcJ20R3IhkvmcSme7ccM6x3+RtKvyh1fVKFc5n3QxB2Gzr7Rz3fQVIPDxLCGOI0HYPKMqr0GmpYgu2av9u6yG/u2YsiJzXjXbKS3MVGERfcdjV2Z/cdNDsE4bUgUIet1znY8ybpeem8F9+dDNUl9kXHo3C7ZDGBAL8vdgO0qO4gaKGuwD2EkCwcLA9lU3sSgRA/8PsiDgUP6mquJqblzIIVB2k7bQNBYgb5TzfSB2Bp0w08btt6p6KJX15bhR6qTM10AnlXylwVz2kVLhETXNdIlAX0rO95bY50Xev0ub7rBRLykChHiOS3UgJ6CPuI1FC9swaJPW4PuBjeJpVSNsEmzHLGRPFRD5i8cqAw+gUHe8O/mOwtWJtC+7ia7BLyMvVqbV8VRYzZXP1w22QU3WmsYCBIE+r2bhgbAmA8CgZ9rbZZGuxTohOaji8VLjHIg5qZr1d1RYI1aw6vgy6BrtRp+JFSAMxnNlEHomeFEe19ldOPiiMpot292pgiZXKxHclw80rFyoY50HEuYR5gQHFgPQUHXtRIR0IEQek78vdBON5i+Rdn7ePxUi18lnmxf2R+wIKrTpJkBmtBIq90XOJklOOGvA58Gq9cCEwbyuGuiXJ9hcmKSs0HWvU4PdU9SdbvA12o0+EyNA1laD9dNFXaeuCIjFCAdgDGv7Eu+hgWVruvH8VawEPog6JRAICI+PufYqMQaNbQoxIE/qABYelxiQc0KVl3p7bRNsQ4wIEcnTTYDAkTWuPjCc9zPTbjuex6QloZ+oTasGNhLn8LvYQVLfh+mSKPDMhHvRRI12o8+MCZDMF3AiD9L6wXeoo1ZhJq8vxtiqQ/6+WlcEeQJE0oCjVioOwiSvK0ahvyc05mY+kPBIF1enAffdO8IZT8tXu3ulGxdQCCHKrT6aG4NbPh08QiRUtWw/DQXI5rGzxYiB4HjXzCC5eMpKSt2LqwatRddA5z2SdlQdJzoi/DbhuflD05016odBAA+dc51XA+UwII/V6NCbz8v4uLonMthuLf//fTjbl88IHmyXeRe7xieywHc/866ih7k0r4zXIsAK9hUCBjdw40KELLAnZUExJRUiVD/MhciKaqd5ZhoJkBfE2g46zbC5/i6+fnrdUAP93oT+DrQGOtfXTZ9Srak10M9pusNG/TCgrugm6rL5bA7GwODFwMDNSiEvAsOLtSErgMLgQp6bl7qJsG8Cvx4Ktv27mxxlHgPHHUtTEqyAnpK/SX2yYeGYh2cT08Hf5bxLb+5CTD8vRZC46SFAXEoCwjYDJCtGMgz0q0RtNzbMIoPWdND6YMXj5TXQY68PburrdtvpFGGzBPsH9+LdTXfY6D8M0G+WGx56PiE8MHAvXLL9aqEQkb+Z8YW2DFRTqMgeCfb3gPOFi3rNTUQfX1kivKihvmmwHft/f0FlxrFJ3JirNYglQZBNl/Kah1QRIPj8u+plYatwYKLRtmo+qqQa6Gpz63cm4mHhoATBSloiy8A7xWHlsVVurFa1FTPOo11nNdMGGvhHidlQ34wgOUE+z1cKz+gAvr+rJ2p5Kdn3NaF6QdPCz3YTo9yLRvs8B1e++sncxCJVU5mNUmbwhcGRjAAv6XqE/pJSA52JT1U7TVINdNn+BzWc46hwacKzc5ubJqv86Qov2jsYgIObzkCLjaKdd1QOxnY8rcKZF7mozgjdLTWQkNl+nSkvVpD9XpyvMnQlQrTr2924MKP/HwwNoSpEKExVtqqayiydkmG3MBi/p+G+UwM9JYV7HTXQV0uMcziihmOOAmR1+FPCvUC1XYwZM6YIrC5Q9YQDLDN58hv1omYiPuPz+Yung/rtzg/qRd05wge7yjJBW0K3W7LwedkMht+vhLE0mxhIyIxnLzcejY7aZbdQQKJWc75+yHRIepczppJJFB7PaNxN09dpuVhjtg7mp9RwzJQa6KjMtum6x6kBgjW2BjrXhcSmTao+jT7BLB3hcX/uqktqEedrFj+7h/3h531+5oMM8/xX2CbIwFlmeOWhOi7zubDGmmz/HefL1P648Pm1HY6L0PlmYdAjVoFVRq6eQkX3+kI8CaVOz3IT06NMZbinR6a488q26PUJyGy6hvUOKf129dRAPyPhOuHePOjAyqYI3eC7XRfc/JmMTofcYNOKsbgMGVDnG5lVeHCze/GyYRC+OHTtzXz2zd1cexsD6qWzs4kp3Ilcf3nuQhw8iHd0OT7C8EuZT1+R94FVxifcuBouj5S/JdiGF/90N32ECC8/5z8vopFe/1NuOAoAfTiyz/N0BVr0BuyF7yYc88oajjcqMOn8S+R1uUG236rpDhv1wmB5aOjmKo2VAq52vQgPBvxvhzNE9UjZxXWeudYpQIAV0CmZjzHJa6hjuD/cjdtoOD/yKf2xMHv8vLTlezj3UYNVCCu2F0Y0thuWqGruX0yf837X4RgxK+GYi7TZx1SE9zb2unANh2ECYtQENxXf9oeDQRv/dWp09PLSEa3+nWxizAWzjjdF/LZuAQIMHtQBfyT4Leqs09zElchYoGSwEiEokZoig6jpbRiGMXIwgI5VBwxVTTJw/sZ5wZIKieZ+ygxe98eMn5QopPiOEUa5Gu1i+e1Yk7+Pc96L61Q+z5tLi2TFMeDgwoqIGuoXuPF8PGOpWqRdF1wLghJxxRxUdT3DMIyRYKa0M0PX2swnSHxKc0qlCBAG3+WI/ygYrm91aZ4oLe1XuOTF3Q+D22KFz3uxUezH6iO0d2Q+HfzSwTbzk0UGXiM/cc3HPHSCqm5zpG3XphFAV+YuTaoZ0tkvXfJdCIJ9Gd0WhwrKD5OifEk37pm3Qofjl/VlrP6La2+b4PtZ2set9dj8nxVlmQqE/bzRdU7Qh7qO4FJWleGEhnoxna4fbVn9/ZYR50g/clUfzy7P6mul7SFtTz0frhdu40WVLo4kPGs7OO85SCqUtfW8i/dw0y79eJP+Lmelkm3maN+Wc5Pd2Jn4cb+6qZy49tu68XdyDdde49DS47xIj/sW56P1eb6K8WUcd5Mu50hNoekSrDk0kNTwS8GMfMw2gPDQgf/3Ll6A8CKuR/qQgvBgH6nFhXjpDuO3eZN9na/9vTj8XNqPE/cNDACUtL0zECKsRL4k7b+C7dYlzUe4KpPPfun8g96091EZn5b+kpH4DzTp7/zG386r64qDA9fiCn7nfGaBdl52DAofle0wgN4u+0TN90f5/wOqmny/8yvZOYXj36ATkvvCvsi/OCjwwlOhEq+3svocyzsfq/NL9bi7kWNxfFVpUsDsvwq/wahOQas1O1ynWQSbOh+fEZ7vSfL5v/UYk66fXsM3OD+JuTTY5kZp/9BJyY3Bb65wXrgiBN9Iqh1ydun3PLt3aRwU5Q/CBKMIzOP1WpP94Tes4Ana1PQ87wpPBk9Ete/dEPY56Ef+zOYQuf+ofH5zYbu/tHzJhfOcnxjkHlJntXwZhNU6XFMG/XPUUWHM7iP7IYEpqfOLWgcEICncvyBtnh6X63FLy+en49kIBRbX4ypU6tybsvuiAcumIRggL5WL/o1M4yQQHvpSnpCNu9rGCpA8B9aV2XhCw2c0aGvDbj8uYZINRNqYDURarzaQsmNQvCqsfMjg8V3nZ2g58wtmBY4F1zsvFIdKiEi/Pp15D7NXt2nkNyu6TZIA88GWz6bMirNsFcJvdm35iH5ebma8pKBgkGHGST0VMhNwTWcVjrlB5j3gzmrTl5lZeYGnlaV9nWPKd8RuMJNdV3/LIH5Uy2eKPqTwu2gBIttNECDyN8k2Hw2OU9ZYCTMArhJ8trHsD4HCCnWT4PM1dFtUur9t+QSfrChYSazl/CrmQH3mwhXYQQga57Mbb6znQkbsnTOf4PSw8GTks2vl2bzc+eShZX3m9zODnyBAKHD11sJ2Gzn/TtDXuW7c7sfEEM9JVk7tVNCv0udnftBkBwHy7pYv6TBX97mhXhPqAxGYyrvOxHBl3X6WagPO0etQdo5k37aYkgHBrOiyzKeZztObM8NgQNg5sA/ECpDVdDYWCo98f70MstR3OLvgO163AAFmOLNDxwE1mjM7XSXYjmX1BYE6i21ICb5Fj+fXF1SAPJTwk2fJefxIX3zKCP/VedVKkYVkv2fqgL1cyfesGNtF7z8n8znPigN9TpkAYV+fb/lEl6g+ywYGVGYMwkWBV1WAUIcmNTaB5/XzOgsuU6O8XgX7O93k5wUBs2j4OasMHcCLq6tc7TNBxYMAyXxZ56gAX9n2QH0/y7InM9ivk3lXe3LTcS0INP0OE84258c2e+tqav4qoI0A2VK2+4e0r+v5FYUL+0KtxSQhV//lAuSTrrc4NKMmeACXlZvxi4KaCRVEvsTdLRAgzFKW7LA/bvZarSANhu7vRlct+ygD1tnZuMvtM6EACT+vKEBytsh8YOLThdUTA1T+YpMy/MIsSD2vth1mbUORM6sHAbKFrir2lraI/PYCvXfFl5T7cUbLB3+mxlGIAPmPVAGyScsHfKIWS3UfH0YBslXmVaRRsVS6GuR5X6XbtlCzAAEEBhPMk5wfxMfS1+uzsnLJ9i+Q7y7JvB1x/kSiRICwQr1O1VQvLtlPO0yADAHcxFcjPLKJLqroacOMmLEChNk7FQFvLszeCZx6dcW+8pDsKfv7St6cXxoz2zym8PmnKx4LGDDe1PK2llCI/MJ5A1/O8rwk2cREjQyqO7gheLATBQiz+s9K///sxg3Ou+rA/fbirvms5RMnXup8ANhSLtKjLsuelSpAvtDy9UV6cZ0eRgGylKqFeJ9Q2bzUdX5ePpR5mwY2AlRiHR1F+iBAEAiobVFN5quANVveK/Poku1xOJnnfHzX/GeiRIAgSHmGDo3pZ4AJkIZhFr2BGiNzNRNeVt92k2c5e0QIEF6w2WrQCtU66GHXqKnPLO2fE7QF9DwWKHxe1wPF8baU87ixsJr6nZvoQYZK7+QsSKaX+WBLZvGNBtcFNpA3lTTsFmHiurX13D4UfEZlv1/rJKA4EOZG9Lu0XSZ/E42O90sn7xwRIDNSBciNquLolrCzDATIQwx+DJRt2mGZj4guEyCP678nFpvzz0HZCqKbAMnLL/P+/UNthdiEENRlwoHPjkMlhFpR2rf0+q1XdnwVIH+Udkqbfq9T2L6bAHmxrhL2D47HhANj/3wjecCpaqifsDotESAf0OdzvTbHbceYAEEr0OYcqUn0ysR9GgkUbRT5YM8NL+pk9wkGRjLYltXE2LwVlJHVgfanzgujobEJ9AAP+iqFVVWe9HH7YDtm7J/KgsSQmU80iRCpM6twEipA8KB7oNhaPmdYPpAwKDA4MEgsX9jNe/Wl367kEAhs9Nb7SbtS9vlQy6e5oR5IO9WWCJCWCJBJxu6cSQJEn63zXHd1Dyn6y4zoeH09ooKkrD2s16lMgGAXvK6sOa9SKxOW3QQIMOnClRZ32W9w3TLvvMAkbduS7RmwGeAPbvnA1kd1ZcV1mWBvUgHCfb6+Tb+3LWzfSYCsIN/9UFWZ6xe+m6PPxh7BZ4uoo8MJrrByKxEgH8l8nrkyNVgn8hXI3WXnKN/9zHkDvNEn8CdfJ2jo9tsti5cItlvdlQ+Iq5bsb4mS7UaVFVXFMd8pwPmZF4NqPqgx8J0o24UlcpldYYSuc5nN9Wdw3qbbfoMVyDolDRfMfEbPKgobD2laMIovHjQGEF76L7vOK4BM94lK71H1JCrLjNyLALlSV8fdkhAe0ZqcTDNXYaFGXaBNI339tW0ESD9UWGXwvnwYFagK4S07bEt/XqN2Bmwp33KBIMt6U2Fxj0mnfqE29nmN3stbnX+OiyrKhdXhgmcnv25jGbudtwUWj1MUIKilUbG+OaafAabCMkYKVlE4B/wwm2jvQIgQ0DVfiEg7KgtqiusM6+OueppzXjoEPyomYmC6Gq+zeBvITpyXqkeuLLbM699ZncS4YDO4naUeOGXJ8Xrxwvq4qlA26XRgBACDZ+HjnuNABixAcrbTVQ8xOt1W74urDZPzWzv/sBcBknlbBHnqvpQ32Teze3LEdfIu/KAKvLHAvZb3GPth2bFLBAjp3lH34s2V4nJrAmSKwouG3h81FwMcM1Ie7HWDtpZ+TmzFkrr9KKRw5gVaVR7c72fjgZZ5fWvK3+YvDOeDbjeMJ2EQwoe/11UZbpq7t3xcwa9dZNnPSAGygOqTGYjeI+3dJe0AHcBJNskLy7miY2533zCwU4zrLSXf9SJAXoZqJ/PBo20F8QgJEPrSzs15VuYzIZzr/EDLpGStDsf6nA7+WwT97mUF8ms9TrgyIw8crtM8u+1UsUuoihEPrTnqWFGm7iwTIOzzLF394NLcTkXJ9qGrsgmQKQAvMstUfMNPYzmNV0bLR8ryQN0l7R5e3sxHHeftXv2c7+/QWS+RvpfL3+dIIyiKWT36VgbcYbOhoEb5bihEdLA82I0bzXmo36167dwmQkAas8pOZX+LcO7MuokMf1AH8bW7/GY+kQJktq4wSEWS6TGLjT6frHpwhP766q31YTd55vhcXakRI1LUmUMvAoSBZS+EcsvXgVm25HdMWgg0vL7w+bAJEAZ1ItjLVpFc/4/Jbx9347YcZvhkrEaFVHx2UK3epDa5+fE4PQqQMhsI5/1xXWGUCgUF1e212D1b5W7f+XHK4kDGHDUy735PipaiTYk+MMaEkeUmQEYEBg8GCAZNXCiZJZyr3lZPhoNo3U0HXQybVAecK8f9jPNGaQal5bRPzM6e7QYvZMZiJLKgIJYONBSmyu0EDHrvbU0skYvt5AzXWa3R0u85z2+i48684R7h8QaXcK4IkJavV98Orh3ODgz2neJ7YCudjSJoqAF+EYJTBy+8cRCgCMi/6ozyKFc+gPXiheV0X6yE5un+cWnd1/ln4rPSbmv56OjDCr/r2Y3X+VQmj+m5fLJNK8vp1m0Fcqi0e3S2fon2Gc8h7gX3Cw+mXEi+ErUQalH5/w2q2qJ2DTP323Uf7w13rgIEIXV0mz5z7dcPtu9kRGcAv0L71i7vGyvzf2W+KNR+bbbpFIlOoODl7EP+vU77+AHnPc9u0HMk6jy3qeVeWFfI/tqdI2ltVnJGI+BVhNGRlcBpqtd8qJ8CI0Gw4FHzD31Jvub8i0cSP1KJoNohSryXErupEANC0klmT+QmYvWFu+sOwTa8fHuogTbfBt95BseyBHF4o+A7z0x6fq2Sls8AMNulz4T3bfkMxe14KYLQeW+ibmBoP1baSfo3z8gu8vvzUK3Jv9fI/WGgwd2WiUa7ldYCrdYMBs1d2nzPCobYkp1KvkN4MvCxGrqs5QPsrlaDPV4/xOgU1SA76HPSKenl8xG28u873ERVDcFy30Vt2a45PzsuwkoUrzaEatl1mKHncZKeB+/X/6qjAMJkmcL2uFuzAvuqbPNzvdZkt0aITjJAy+end+pzy5cjmBP8hOJhpKQpRrrn4IqPnQL377JYH9RxDPYXufLVYc57VaiWTYJ4vvbJfPDqFXqOPFc4drD6CVe63K9TO52j3vPo1bpRHV489Nr7yw24sOXdfB8ZBqERsVJ5UtViBGf9IPNGQATLbs6/qDyc/ViloGLDM23NoBX9z8dcgQvbMNPLBxYGYgYBXgj82h/OJrtDb+B6i25n9ttpZbGgfh9rwKSvRTdufru88+fIIN1Otx/CMdt5dLX0GN08vtiGTASsjLm/7YRrXtSokzs1+8PjrNj3mXqcTq1shcE5cK0WcZ2fu2fpPnhmmDzM6rI9/eMac60Z7Nvdt8W79JnrHwq2hfQ3nWwQs/ScyvqXr5pnuc7PabfnEbjmnCPXBE1DmYoqv1+dzvGFbX5r9IGNVPJju3h02IVGpFBB9cOy+m+t8WytZzqv8sBY2GSqZ1ZIeK2gevmz9O2BokoQ9Z3zevIXNdhPwzCMSTBbY7awXctHw460wOhRwCAoSbXNIH2o8yoiZrNL67VBwDDDQ7WUOvtnJoeQYDbFTAmVBCpBDKJEET/Q7ppr3/gez5fpVP7UMIwhh4FwJRmc8BCaq0bgmMH2KfXUId0DaSWuwe1T2o9V54iemPTVZOj8XstHruI5dHXmaxLM09XA08MorNRTaix9u7S71ED3TTVYYnDEO+RtzuuNMZoS5LWZts2dt7+ghtrRebXZAfLb43Kddcun+ngqP06Hfvxb7SjYBxBcC7khScxoGMb0Bg+GA9UI91i7gUwH+btneCMdBiwMgRSsIf0B+ZOI5UA/Sf0GdJS5vpGZNjN3dJwY0siuyYyemTcDLYMvBkeMbWSxJR3DUBjmIwTo0ypsx1Rimbogq2C8Q+0vD6jNqBfvNI5xn646Xq73i+uKvaSxVCiGYRiwrXoCTTKK6wBJDiOS4eH6RmIzVC7EeWCAzJMW1gGzaVQ7qIcQOgghBNOn1POCCm5P1zHwj1JTF0qEbB5HgvAgOHH5mq67YRhGEgz8+GdfFHr1qHH5fo3lICaBOszDUrkLLxOCEw9Wb6rb6KuumIZS/VVhVfNEy6dCwaU3D57Ca4Q8VbhZVk2BbxiG0RN47nxIBqi/BCqYebrKwL2VtAfDbqBl1YPaDfvCRzTeAHvC7VmQj2rUWuYzH+MiTVptUrrk0d/cMyK7iQVITW9tGIZRGbyrMPJeruoq0ouTDI/IVVQkDMjDlhokB48lbCrtBBvqHVRe2GHI4nkGwUZ4UzUtFCIFB8kKSbNBtDqrizzYkfvBKpBVBwWxVu/nRTYMwyiDgfdIGajulYGKXDpEIOMtRLBbpwI/wwIzcSJuEXT7asNgX2ZEzvMz5SlWiBj+FikPhs2GosGAP3fei2vpwvkgMHFUIAXH55x3PhhWAW8YxhSEVQdRrBdqXiIGoqjayUMOUa+kMCD4D3da0qpwXhjfsZWUVoJzPvngkeptNq9oQ+mXHSVQFVI/geBFqvud4CbfC+4Xnmp7yza3tHxdaVYloyDkDcOYQuA6S8wAqg8SiJEiYyrGDaB621kadgNKf57qfK4hYi/I08N1KJ43AoYZ/pgNRdrZxKuo2uv2KnEp2XiGXVx7yS78u5bPQHuO9oucTDML/UFAIEze0/I1Nh5Um9RmfblihmEYbUDNQaZJ4jMQIMQOdCv3ORVgEMYOguBAYF6mQY2XqFF6N+cN02VqL64PqxdiWLCjsLohedvhak85X4MgCZCkDvhvtF2vye5+QmJC2e4LeiwKO7EqIkMuqVGWdeWrCI67sbQTNKsqQociOgi15Z2prAzDGDDMthkMidUYhWJM/QCXV2wgG8iA/BkZnMei3eXfe1R9RJ4pghc7eZtxHfOI75m6LauZJQqN43CtUauhPsOgj2DoNPjzu700VczfNcqdIEPqNKzkLNGbYRjG0EBw4g6aUuUODY58CocCstzKd8c4v1ogi2mdtURY7TxP90nBG1LLY9B/MLe5qLqKVOd4W02HlaJhGMbIQhoVKrido/aG+3J7R8sXQUKVlNuNKJBE6VWM77jXvkJ/T1wGXlNL6b/YU1CfYWciRTy2FdSHB2W+eNCv1K6SCw1WG7dq/QNUXcMed2MYhmEEoGpiVUBszEHYMKTdWYjMf1pTqJDy/Qb5/GpNBPkjaZcH7cdqH6F0502a/2p+RcK86YoHt11yiCGUTHAYhmGMOKiasGGwmsCIfgTFmjKfZbiSay9BmwgX2efHnA8ExI5ibrmGYRhTHAZ6PLNIxU7q9i+Sh0s9sW4W4UCsxq3675/V64t0I5RApRQs1QKLLruGYRjGNAcvLQzteF71UljKMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMAzDMIzR4f8BNUdnlI1JQpIAAAAASUVORK5CYII='
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

  /* Logo */
  try {
    const logoPngBytes = Uint8Array.from(atob(LOGO_PNG_B64), (c: string) => c.charCodeAt(0))
    const logoImg = await pdfDoc.embedPng(logoPngBytes)
    const LOGO_W = 138, LOGO_H = 60
    ctx.page.drawImage(logoImg, { x: MARGIN, y: PAGE_H - MARGIN / 2 - LOGO_H, width: LOGO_W, height: LOGO_H })
    ctx.y = PAGE_H - MARGIN / 2 - LOGO_H - 16
  } catch (_) { /* PDF continues without logo */ }


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
