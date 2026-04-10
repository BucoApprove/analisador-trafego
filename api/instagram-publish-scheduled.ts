/**
 * Cron job: publica posts do Instagram agendados
 * Executa a cada 5 minutos via Vercel Cron
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const META_BASE = 'https://graph.facebook.com/v22.0'
const INSTAGRAM_ACCOUNT_ID = '17841447803654486'

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const supabase = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
    { auth: { persistSession: false } }
  )
  const accessToken = process.env.META_ACCESS_TOKEN ?? ''

  // Busca posts agendados com scheduled_time <= agora (+ 1 min de buffer)
  const dueTime = new Date(Date.now() + 60 * 1000).toISOString()

  const { data: posts, error } = await supabase
    .from('instagram_posts')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_time', dueTime)
    .limit(10)

  if (error) {
    console.error('Erro ao buscar posts agendados:', error.message)
    return res.status(500).json({ error: error.message })
  }

  if (!posts || posts.length === 0) {
    return res.json({ processed: 0, message: 'Nenhum post para publicar' })
  }

  const results: { id: string; success: boolean; error?: string }[] = []

  for (const post of posts) {
    try {
      // Marca como 'publishing' para evitar processamento duplo
      await supabase
        .from('instagram_posts')
        .update({ status: 'publishing' })
        .eq('id', post.id)
        .eq('status', 'scheduled') // guard extra

      // 1. Cria o container de mídia
      const containerRes = await fetch(`${META_BASE}/${INSTAGRAM_ACCOUNT_ID}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          image_url: post.media_url,
          caption: post.caption ?? '',
          published: 'false',
          access_token: accessToken,
        }).toString(),
      })
      const container = await containerRes.json() as { id?: string; error?: { message: string } }

      if (!container.id) {
        throw new Error(container.error?.message ?? 'Erro ao criar container')
      }

      // 2. Aguarda 2s para o container ficar pronto
      await new Promise(r => setTimeout(r, 2000))

      // 3. Verifica status do container
      const statusRes = await fetch(
        `${META_BASE}/${container.id}?fields=status_code&access_token=${accessToken}`
      )
      const statusData = await statusRes.json() as { status_code?: string }
      if (statusData.status_code && statusData.status_code !== 'FINISHED') {
        // Container ainda não processado — reagenda (mantém como scheduled)
        await supabase
          .from('instagram_posts')
          .update({ status: 'scheduled', error_message: `Container status: ${statusData.status_code}` })
          .eq('id', post.id)
        results.push({ id: post.id, success: false, error: `Container não pronto: ${statusData.status_code}` })
        continue
      }

      // 4. Publica
      const publishRes = await fetch(`${META_BASE}/${INSTAGRAM_ACCOUNT_ID}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          creation_id: container.id,
          access_token: accessToken,
        }).toString(),
      })
      const published = await publishRes.json() as { id?: string; error?: { message: string } }

      if (!published.id) {
        throw new Error(published.error?.message ?? 'Erro ao publicar')
      }

      // 5. Busca permalink
      let permalink: string | null = null
      try {
        const plRes = await fetch(
          `${META_BASE}/${published.id}?fields=permalink&access_token=${accessToken}`
        )
        const plData = await plRes.json() as { permalink?: string }
        permalink = plData.permalink ?? null
      } catch { /* ignora */ }

      await supabase
        .from('instagram_posts')
        .update({
          status: 'published',
          container_id: container.id,
          instagram_post_id: published.id,
          published_at: new Date().toISOString(),
          permalink,
          error_message: null,
        })
        .eq('id', post.id)

      results.push({ id: post.id, success: true })
    } catch (err) {
      const message = (err as Error).message
      console.error(`Erro ao publicar post ${post.id}:`, message)
      await supabase
        .from('instagram_posts')
        .update({ status: 'failed', error_message: message })
        .eq('id', post.id)
      results.push({ id: post.id, success: false, error: message })
    }
  }

  return res.json({
    processed: results.length,
    results,
  })
}
