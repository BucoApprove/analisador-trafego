/**
 * Endpoint de diagnóstico — descobre o ID real da conta Instagram vinculada ao token
 * Acesse: GET /api/instagram-debug (admin only)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authUser, requireAdmin } from './_supabase-auth.js'

const META_BASE = 'https://graph.facebook.com/v22.0'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await authUser(req, res)
  if (!user) return
  if (!requireAdmin(user, res)) return

  const token = process.env.META_ACCESS_TOKEN ?? ''

  const results: Record<string, unknown> = {}

  // 1. Quem sou eu
  try {
    const r = await fetch(`${META_BASE}/me?fields=id,name&access_token=${token}`)
    results.me = await r.json()
  } catch (e) { results.me = { error: (e as Error).message } }

  // 2. Páginas vinculadas ao token
  try {
    const r = await fetch(`${META_BASE}/me/accounts?fields=id,name,instagram_business_account&access_token=${token}`)
    results.pages = await r.json()
  } catch (e) { results.pages = { error: (e as Error).message } }

  // 3. Conta IG direto via /me/instagram_accounts
  try {
    const r = await fetch(`${META_BASE}/me/instagram_accounts?fields=id,username,name&access_token=${token}`)
    results.instagram_accounts = await r.json()
  } catch (e) { results.instagram_accounts = { error: (e as Error).message } }

  // 4. Testa o ID atual
  const currentId = '17841401980622840'
  try {
    const r = await fetch(`${META_BASE}/${currentId}?fields=id,username,name,followers_count&access_token=${token}`)
    results.current_id_test = await r.json()
  } catch (e) { results.current_id_test = { error: (e as Error).message } }

  // 5. Testa insights diretamente
  try {
    const since = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000)
    const until = Math.floor(Date.now() / 1000)
    const params = new URLSearchParams({
      metric: 'reach,impressions,follower_count',
      period: 'day',
      since: since.toString(),
      until: until.toString(),
      access_token: token,
    })
    const r = await fetch(`${META_BASE}/${currentId}/insights?${params}`)
    results.insights_test = await r.json()
  } catch (e) { results.insights_test = { error: (e as Error).message } }

  res.json(results)
}
