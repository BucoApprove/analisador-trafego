/**
 * GET /api/meta-thumb-by-name?name=ads_0106_05
 *
 * Resolve a thumbnail de um anúncio a partir do nome (ad_name = utm_content),
 * sem precisar carregar todos os ads do período antecipadamente. Busca nas
 * contas Meta configuradas (META_AD_ACCOUNTS) o ad cujo nome bate exatamente,
 * pega o ad_id e retorna a thumbnail do criativo. Sob demanda, uma chamada por
 * anúncio — usado pelo tooltip de thumbnail no drill-down de leads do Placar.
 *
 * Cache de 1h por nome — criativos raramente mudam.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authUser } from './_supabase-auth.js'

const META_BASE = 'https://graph.facebook.com/v19.0'

function accountIds(): string[] {
  const multi = (process.env.META_AD_ACCOUNTS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (multi.length > 0) return multi
  const single = process.env.META_AD_ACCOUNT_ID ?? ''
  return single ? [single.replace(/^act_/, '')] : []
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const _user = await authUser(req, res); if (!_user) return

  const name = typeof req.query.name === 'string' ? req.query.name.trim() : ''
  if (!name) return res.status(400).json({ error: 'name é obrigatório' })

  const accessToken = process.env.META_ACCESS_TOKEN ?? ''
  const accounts = accountIds()
  if (!accessToken || accounts.length === 0) {
    return res.status(503).json({ error: 'META_ACCESS_TOKEN ou META_AD_ACCOUNTS não configurado' })
  }

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600')

  try {
    for (const aid of accounts) {
      const url = new URL(`${META_BASE}/act_${aid}/ads`)
      url.searchParams.set('fields', 'name,creative{thumbnail_url,image_url}')
      url.searchParams.set('filtering', JSON.stringify([{ field: 'ad.name', operator: 'EQUAL', value: name }]))
      url.searchParams.set('limit', '5')
      url.searchParams.set('access_token', accessToken)

      const r = await fetch(url.toString())
      if (!r.ok) continue
      const data = await r.json() as { data?: Array<{ name?: string; creative?: { thumbnail_url?: string; image_url?: string } }> }
      const ad = data.data?.find(a => a.name === name) ?? data.data?.[0]
      if (ad?.creative) {
        return res.json({ thumbnail: ad.creative.thumbnail_url ?? ad.creative.image_url ?? null })
      }
    }
    res.json({ thumbnail: null })
  } catch (err) {
    console.error('meta-thumb-by-name error:', err)
    res.status(500).json({ error: 'Erro interno' })
  }
}
