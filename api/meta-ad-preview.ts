/**
 * GET /api/meta-ad-preview?adId=123&format=INSTAGRAM_STANDARD
 *
 * Gera a prévia oficial do anúncio via Ad Preview API do Meta — o mesmo
 * preview que aparece dentro do Business Manager ao clicar no criativo,
 * mas acessível fora dele (não exige login/permissão na conta de anúncios).
 * Retorna um <iframe> pronto (campo `body` da resposta da Graph API).
 *
 * Cache de 1h — criativos raramente mudam.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authUser } from './_supabase-auth.js'

const META_BASE = 'https://graph.facebook.com/v19.0'

const ALLOWED_FORMATS = new Set([
  'INSTAGRAM_STANDARD',
  'INSTAGRAM_STORY',
  'DESKTOP_FEED_STANDARD',
  'MOBILE_FEED_STANDARD',
])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const _user = await authUser(req, res); if (!_user) return

  const adId = typeof req.query.adId === 'string' ? req.query.adId.trim() : ''
  if (!adId) return res.status(400).json({ error: 'adId é obrigatório' })

  const format = typeof req.query.format === 'string' && ALLOWED_FORMATS.has(req.query.format)
    ? req.query.format
    : 'INSTAGRAM_STANDARD'

  const accessToken = process.env.META_ACCESS_TOKEN ?? ''
  if (!accessToken) return res.status(503).json({ error: 'META_ACCESS_TOKEN não configurado' })

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600')

  try {
    const url = new URL(`${META_BASE}/${adId}/previews`)
    url.searchParams.set('ad_format',    format)
    url.searchParams.set('access_token', accessToken)

    const metaRes = await fetch(url.toString())
    const data    = await metaRes.json()

    if (data.error) {
      console.error('meta-ad-preview Meta error:', data.error)
      return res.status(400).json({ error: data.error.message })
    }

    const html = data.data?.[0]?.body ?? null
    if (!html) return res.status(404).json({ error: 'Prévia não disponível para este anúncio' })

    res.json({ html })
  } catch (err) {
    console.error('meta-ad-preview error:', err)
    res.status(500).json({ error: 'Erro interno' })
  }
}
