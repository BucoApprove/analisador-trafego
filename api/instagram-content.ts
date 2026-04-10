/**
 * API de gerenciamento de conteúdo do Instagram (admin only)
 * Suporta: IMAGE e REELS
 *
 * IMPORTANTE: Crie a tabela no Supabase antes de usar:
 *
 * CREATE TABLE instagram_posts (
 *   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
 *   created_by UUID REFERENCES auth.users(id),
 *   container_id TEXT,
 *   instagram_post_id TEXT,
 *   media_url TEXT NOT NULL,
 *   caption TEXT DEFAULT '',
 *   media_type TEXT DEFAULT 'IMAGE',
 *   scheduled_time TIMESTAMPTZ,
 *   published_at TIMESTAMPTZ,
 *   status TEXT DEFAULT 'scheduled'
 *     CHECK (status IN ('scheduled','processing','publishing','published','failed','cancelled')),
 *   error_message TEXT,
 *   permalink TEXT,
 *   created_at TIMESTAMPTZ DEFAULT NOW()
 * );
 *
 * ALTER TABLE instagram_posts ENABLE ROW LEVEL SECURITY;
 *
 * CREATE POLICY "Apenas admins" ON instagram_posts
 *   USING (EXISTS (
 *     SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
 *   ))
 *   WITH CHECK (EXISTS (
 *     SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
 *   ));
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authUser, requireAdmin } from './_supabase-auth.js'
import { createClient } from '@supabase/supabase-js'

const META_BASE = 'https://graph.facebook.com/v22.0'
const INSTAGRAM_ACCOUNT_ID = '17841447803654486'

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
    { auth: { persistSession: false } }
  )
}

type MediaType = 'IMAGE' | 'REELS'

async function createContainer(
  mediaUrl: string,
  caption: string,
  mediaType: MediaType,
  accessToken: string,
  thumbOffset?: number,
) {
  const body: Record<string, string> = {
    caption,
    published: 'false',
    access_token: accessToken,
  }

  if (mediaType === 'REELS') {
    body.media_type = 'REELS'
    body.video_url = mediaUrl
    body.share_to_feed = 'true'
    if (thumbOffset !== undefined) body.thumb_offset = String(thumbOffset)
  } else {
    body.image_url = mediaUrl
  }

  const res = await fetch(`${META_BASE}/${INSTAGRAM_ACCOUNT_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  return res.json() as Promise<{ id?: string; error?: { message: string } }>
}

async function checkContainerStatus(containerId: string, accessToken: string) {
  const res = await fetch(
    `${META_BASE}/${containerId}?fields=status_code&access_token=${accessToken}`
  )
  return res.json() as Promise<{ status_code?: string; error?: { message: string } }>
}

async function publishContainer(containerId: string, accessToken: string) {
  const res = await fetch(`${META_BASE}/${INSTAGRAM_ACCOUNT_ID}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      creation_id: containerId,
      access_token: accessToken,
    }).toString(),
  })
  return res.json() as Promise<{ id?: string; error?: { message: string } }>
}

async function getPermalink(mediaId: string, accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${META_BASE}/${mediaId}?fields=permalink&access_token=${accessToken}`)
    const data = await res.json() as { permalink?: string }
    return data.permalink ?? null
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await authUser(req, res)
  if (!user) return
  if (!requireAdmin(user, res)) return

  const supabase = getSupabase()
  const accessToken = process.env.META_ACCESS_TOKEN ?? ''

  // ─── GET: listar posts ────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('instagram_posts')
      .select('*')
      .not('status', 'eq', 'cancelled')
      .order('created_at', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ posts: data ?? [] })
  }

  // ─── POST: criar/agendar post ─────────────────────────────────────────────
  if (req.method === 'POST') {
    const { mediaUrl, caption, mediaType = 'IMAGE', scheduledTime, publishNow, thumbOffset } = req.body as {
      mediaUrl?: string
      caption?: string
      mediaType?: MediaType
      scheduledTime?: string
      publishNow?: boolean
      thumbOffset?: number
    }

    if (!mediaUrl?.trim()) {
      return res.status(400).json({ error: 'URL da mídia é obrigatória' })
    }
    if (!['IMAGE', 'REELS'].includes(mediaType)) {
      return res.status(400).json({ error: 'mediaType inválido' })
    }

    if (publishNow) {
      // Publicação imediata
      const container = await createContainer(mediaUrl, caption ?? '', mediaType, accessToken, thumbOffset)
      if (!container.id) {
        return res.status(502).json({
          error: container.error?.message ?? 'Erro ao criar container no Instagram',
        })
      }

      // Para Reels, aguarda o processamento de vídeo (max 30s inline)
      let statusCode = 'IN_PROGRESS'
      const maxWait = mediaType === 'REELS' ? 10 : 3
      for (let i = 0; i < maxWait; i++) {
        await new Promise(r => setTimeout(r, 3000))
        const statusData = await checkContainerStatus(container.id, accessToken)
        statusCode = statusData.status_code ?? 'IN_PROGRESS'
        if (statusCode === 'FINISHED' || statusCode === 'ERROR') break
      }

      if (statusCode === 'ERROR' || (mediaType === 'REELS' && statusCode !== 'FINISHED')) {
        // Salva como 'processing' para o cron publicar quando estiver pronto
        const { data: post, error: dbError } = await supabase
          .from('instagram_posts')
          .insert({
            created_by: user.id,
            container_id: container.id,
            media_url: mediaUrl,
            caption: caption ?? '',
            media_type: mediaType,
            status: 'processing',
          })
          .select()
          .single()

        if (dbError) console.error('DB error:', dbError.message)
        return res.json({
          success: true,
          processing: true,
          message: 'Vídeo em processamento. Será publicado automaticamente assim que estiver pronto.',
          post,
        })
      }

      const published = await publishContainer(container.id, accessToken)
      if (!published.id) {
        return res.status(502).json({
          error: published.error?.message ?? 'Erro ao publicar no Instagram',
        })
      }

      const permalink = await getPermalink(published.id, accessToken)

      const { data: post } = await supabase
        .from('instagram_posts')
        .insert({
          created_by: user.id,
          container_id: container.id,
          instagram_post_id: published.id,
          media_url: mediaUrl,
          caption: caption ?? '',
          media_type: mediaType,
          status: 'published',
          published_at: new Date().toISOString(),
          permalink,
        })
        .select()
        .single()

      return res.json({ success: true, post })
    }

    // ─── Agendamento ─────────────────────────────────────────────────────
    if (!scheduledTime) {
      return res.status(400).json({ error: 'Data de agendamento é obrigatória' })
    }

    const scheduledDate = new Date(scheduledTime)
    if (scheduledDate <= new Date(Date.now() + 10 * 60 * 1000)) {
      return res.status(400).json({ error: 'O agendamento deve ser pelo menos 10 minutos no futuro' })
    }

    const { data: post, error: dbError } = await supabase
      .from('instagram_posts')
      .insert({
        created_by: user.id,
        media_url: mediaUrl,
        caption: caption ?? '',
        media_type: mediaType,
        scheduled_time: scheduledTime,
        status: 'scheduled',
      })
      .select()
      .single()

    if (dbError) return res.status(500).json({ error: dbError.message })
    return res.json({ success: true, post })
  }

  // ─── DELETE: cancelar post ────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const id = req.query.id as string
    if (!id) return res.status(400).json({ error: 'id obrigatório' })

    const { data: post } = await supabase
      .from('instagram_posts')
      .select('status')
      .eq('id', id)
      .single()

    if (!post) return res.status(404).json({ error: 'Post não encontrado' })
    if (post.status === 'published') {
      return res.status(400).json({ error: 'Post já publicado não pode ser cancelado' })
    }

    const { error } = await supabase
      .from('instagram_posts')
      .update({ status: 'cancelled' })
      .eq('id', id)

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
