/**
 * GET /api/meta-ad-preview?adId=123&format=INSTAGRAM_STANDARD
 *
 * Gera a prévia oficial do anúncio via Ad Preview API do Meta — o mesmo
 * preview que aparece dentro do Business Manager ao clicar no criativo,
 * mas acessível fora dele (não exige login/permissão na conta de anúncios).
 * Retorna um <iframe> pronto (campo `body` da resposta da Graph API).
 *
 * Também resolve o link real do post (o mesmo que "Ver post" > "Post do
 * Instagram/Facebook com comentários" no Business Manager): todo anúncio
 * veiculado tem um post por trás (effective_object_story_id), gerado
 * automaticamente pelo Meta mesmo quando não é um post orgânico publicado
 * manualmente — por isso o link existe pra praticamente qualquer anúncio.
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
    const previewUrl = new URL(`${META_BASE}/${adId}/previews`)
    previewUrl.searchParams.set('ad_format',    format)
    previewUrl.searchParams.set('access_token', accessToken)

    const storyIdUrl = new URL(`${META_BASE}/${adId}`)
    storyIdUrl.searchParams.set('fields',       'creative{effective_object_story_id}')
    storyIdUrl.searchParams.set('access_token', accessToken)

    const [previewRes, storyIdRes] = await Promise.all([
      fetch(previewUrl.toString()),
      fetch(storyIdUrl.toString()),
    ])
    const previewData = await previewRes.json()
    const storyIdData = await storyIdRes.json()

    if (previewData.error) {
      console.error('meta-ad-preview Meta error:', previewData.error)
      return res.status(400).json({ error: previewData.error.message })
    }

    const html = previewData.data?.[0]?.body ?? null
    if (!html) return res.status(404).json({ error: 'Prévia não disponível para este anúncio' })

    let postUrl: string | null = null
    const storyId = storyIdData?.creative?.effective_object_story_id
    if (storyId) {
      const postUrlReq = new URL(`${META_BASE}/${storyId}`)
      postUrlReq.searchParams.set('fields',       'permalink_url')
      postUrlReq.searchParams.set('access_token', accessToken)
      const postRes = await fetch(postUrlReq.toString())
      const postData = await postRes.json()
      postUrl = postData?.permalink_url ?? null
    }

    res.json({ html, postUrl })
  } catch (err) {
    console.error('meta-ad-preview error:', err)
    res.status(500).json({ error: 'Erro interno' })
  }
}
