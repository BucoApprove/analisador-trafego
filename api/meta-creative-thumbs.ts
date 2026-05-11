/**
 * GET /api/meta-creative-thumbs?adIds=id1,id2,...
 *
 * Retorna thumbnail_url (ou image_url) de cada criativo Meta Ads.
 * Máximo 50 ad IDs por chamada.
 * Cache de 1 hora — criativos raramente mudam.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authUser } from './_supabase-auth.js'

const META_BASE = 'https://graph.facebook.com/v19.0'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const _user = await authUser(req, res); if (!_user) return

  const raw = typeof req.query.adIds === 'string' ? req.query.adIds : ''
  const adIds = raw.split(',').map(s => s.trim()).filter(Boolean)
  if (adIds.length === 0) return res.json({})
  if (adIds.length > 50) return res.status(400).json({ error: 'Máximo 50 ad IDs por chamada' })

  const accessToken = process.env.META_ACCESS_TOKEN ?? ''
  if (!accessToken) return res.status(503).json({ error: 'META_ACCESS_TOKEN não configurado' })

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600')

  try {
    const url = new URL(META_BASE + '/')
    url.searchParams.set('ids',          adIds.join(','))
    url.searchParams.set('fields',       'creative{thumbnail_url,image_url}')
    url.searchParams.set('access_token', accessToken)

    const metaRes = await fetch(url.toString())
    const data    = await metaRes.json()

    if (data.error) {
      console.error('meta-creative-thumbs Meta error:', data.error)
      return res.status(400).json({ error: data.error.message })
    }

    const result: Record<string, string | null> = {}
    for (const adId of adIds) {
      const ad = data[adId]
      result[adId] = ad?.creative?.thumbnail_url ?? ad?.creative?.image_url ?? null
    }

    res.json(result)
  } catch (err) {
    console.error('meta-creative-thumbs error:', err)
    res.status(500).json({ error: 'Erro interno' })
  }
}
