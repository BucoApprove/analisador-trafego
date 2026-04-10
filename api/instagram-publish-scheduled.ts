/**
 * Cron job: publica posts agendados e processa Reels em fila
 * Executa a cada 5 minutos via Vercel Cron
 *
 * Fluxo para imagens:
 *   scheduled → [cron cria container + publica] → published
 *
 * Fluxo para Reels (processamento de vídeo pode demorar):
 *   scheduled → [cron cria container] → processing → [próximo cron verifica status] → published
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
  const token = process.env.META_ACCESS_TOKEN ?? ''

  const results: { id: string; action: string; success: boolean; error?: string }[] = []

  // ─── Fase 1: Publicar containers já processados (Reels em processing) ──
  const { data: processing } = await supabase
    .from('instagram_posts')
    .select('*')
    .eq('status', 'processing')
    .not('container_id', 'is', null)
    .limit(5)

  for (const post of processing ?? []) {
    try {
      const statusRes = await fetch(
        `${META_BASE}/${post.container_id}?fields=status_code&access_token=${token}`
      )
      const statusData = await statusRes.json() as { status_code?: string }

      if (statusData.status_code !== 'FINISHED') {
        results.push({ id: post.id, action: 'check_status', success: false, error: `status: ${statusData.status_code}` })
        continue
      }

      const publishRes = await fetch(`${META_BASE}/${INSTAGRAM_ACCOUNT_ID}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ creation_id: post.container_id, access_token: token }).toString(),
      })
      const published = await publishRes.json() as { id?: string; error?: { message: string } }

      if (!published.id) throw new Error(published.error?.message ?? 'Erro ao publicar')

      let permalink: string | null = null
      try {
        const plRes = await fetch(`${META_BASE}/${published.id}?fields=permalink&access_token=${token}`)
        const plData = await plRes.json() as { permalink?: string }
        permalink = plData.permalink ?? null
      } catch { /* ignora */ }

      await supabase.from('instagram_posts').update({
        status: 'published',
        instagram_post_id: published.id,
        published_at: new Date().toISOString(),
        permalink,
        error_message: null,
      }).eq('id', post.id)

      results.push({ id: post.id, action: 'publish_processing', success: true })
    } catch (err) {
      const message = (err as Error).message
      await supabase.from('instagram_posts').update({ status: 'failed', error_message: message }).eq('id', post.id)
      results.push({ id: post.id, action: 'publish_processing', success: false, error: message })
    }
  }

  // ─── Fase 2: Publicar posts agendados com horário vencido ──────────────
  const dueTime = new Date(Date.now() + 60 * 1000).toISOString()

  const { data: scheduled, error } = await supabase
    .from('instagram_posts')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_time', dueTime)
    .limit(10)

  if (error) {
    console.error('Erro ao buscar posts agendados:', error.message)
    return res.status(500).json({ error: error.message, results })
  }

  for (const post of scheduled ?? []) {
    try {
      // Cria container
      const isReels = post.media_type === 'REELS'
      const containerBody: Record<string, string> = {
        caption: post.caption ?? '',
        published: 'false',
        access_token: token,
      }

      if (isReels) {
        containerBody.media_type = 'REELS'
        containerBody.video_url = post.media_url
        containerBody.share_to_feed = 'true'
      } else {
        containerBody.image_url = post.media_url
      }

      const containerRes = await fetch(`${META_BASE}/${INSTAGRAM_ACCOUNT_ID}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(containerBody).toString(),
      })
      const container = await containerRes.json() as { id?: string; error?: { message: string } }

      if (!container.id) throw new Error(container.error?.message ?? 'Erro ao criar container')

      // Salva container_id e muda para processing (evita duplo processamento)
      await supabase.from('instagram_posts').update({
        status: 'processing',
        container_id: container.id,
      }).eq('id', post.id).eq('status', 'scheduled')

      // Para imagens, aguarda 3s e tenta publicar direto
      if (!isReels) {
        await new Promise(r => setTimeout(r, 3000))

        const statusRes = await fetch(
          `${META_BASE}/${container.id}?fields=status_code&access_token=${token}`
        )
        const statusData = await statusRes.json() as { status_code?: string }

        if (statusData.status_code === 'FINISHED') {
          const publishRes = await fetch(`${META_BASE}/${INSTAGRAM_ACCOUNT_ID}/media_publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ creation_id: container.id, access_token: token }).toString(),
          })
          const published = await publishRes.json() as { id?: string; error?: { message: string } }

          if (published.id) {
            let permalink: string | null = null
            try {
              const plRes = await fetch(`${META_BASE}/${published.id}?fields=permalink&access_token=${token}`)
              const plData = await plRes.json() as { permalink?: string }
              permalink = plData.permalink ?? null
            } catch { /* ignora */ }

            await supabase.from('instagram_posts').update({
              status: 'published',
              instagram_post_id: published.id,
              published_at: new Date().toISOString(),
              permalink,
              error_message: null,
            }).eq('id', post.id)

            results.push({ id: post.id, action: 'publish_scheduled', success: true })
            continue
          }
        }
      }

      // Reels ou imagem não pronta: fica em 'processing' para próximo cron
      results.push({ id: post.id, action: 'container_created', success: true })
    } catch (err) {
      const message = (err as Error).message
      console.error(`Erro ao processar post ${post.id}:`, message)
      await supabase.from('instagram_posts').update({ status: 'failed', error_message: message }).eq('id', post.id)
      results.push({ id: post.id, action: 'publish_scheduled', success: false, error: message })
    }
  }

  return res.json({ processed: results.length, results })
}
