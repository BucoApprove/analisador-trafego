/**
 * API de gerenciamento de conteúdo do Instagram (admin only)
 *
 * IMPORTANTE: Antes de usar, crie a tabela no Supabase com o SQL abaixo:
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
 *     CHECK (status IN ('scheduled','publishing','published','failed','cancelled')),
 *   error_message TEXT,
 *   permalink TEXT,
 *   created_at TIMESTAMPTZ DEFAULT NOW()
 * );
 *
 * ALTER TABLE instagram_posts ENABLE ROW LEVEL SECURITY;
 *
 * CREATE POLICY "Apenas admins" ON instagram_posts
 *   USING (
 *     EXISTS (
 *       SELECT 1 FROM profiles
 *       WHERE profiles.id = auth.uid()
 *       AND profiles.role = 'admin'
 *     )
 *   )
 *   WITH CHECK (
 *     EXISTS (
 *       SELECT 1 FROM profiles
 *       WHERE profiles.id = auth.uid()
 *       AND profiles.role = 'admin'
 *     )
 *   );
 *
 * Também adicione ao .env.local:
 *   INSTAGRAM_APP_ID=1644568043522210
 *   INSTAGRAM_APP_SECRET=7717ea51adf51e0b3e1b55a9c8d08a39
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

async function createContainer(mediaUrl: string, caption: string, accessToken: string) {
  const res = await fetch(`${META_BASE}/${INSTAGRAM_ACCOUNT_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      image_url: mediaUrl,
      caption,
      published: 'false',
      access_token: accessToken,
    }).toString(),
  })
  return res.json() as Promise<{ id?: string; error?: { message: string } }>
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
    const { mediaUrl, caption, scheduledTime, publishNow } = req.body as {
      mediaUrl?: string
      caption?: string
      scheduledTime?: string
      publishNow?: boolean
    }

    if (!mediaUrl?.trim()) {
      return res.status(400).json({ error: 'URL da mídia é obrigatória' })
    }

    if (publishNow) {
      // Criar container e publicar imediatamente
      const container = await createContainer(mediaUrl, caption ?? '', accessToken)
      if (!container.id) {
        return res.status(502).json({
          error: container.error?.message ?? 'Erro ao criar container no Instagram',
        })
      }

      const published = await publishContainer(container.id, accessToken)
      if (!published.id) {
        return res.status(502).json({
          error: published.error?.message ?? 'Erro ao publicar no Instagram',
        })
      }

      const permalink = await getPermalink(published.id, accessToken)

      const { data: post, error: dbError } = await supabase
        .from('instagram_posts')
        .insert({
          created_by: user.id,
          container_id: container.id,
          instagram_post_id: published.id,
          media_url: mediaUrl,
          caption: caption ?? '',
          media_type: 'IMAGE',
          status: 'published',
          published_at: new Date().toISOString(),
          permalink,
        })
        .select()
        .single()

      if (dbError) console.error('DB error:', dbError.message)
      return res.json({ success: true, post })
    }

    // Agendar para mais tarde — salva no Supabase, cron publica na hora certa
    if (!scheduledTime) {
      return res.status(400).json({ error: 'Data de agendamento é obrigatória' })
    }

    const scheduledDate = new Date(scheduledTime)
    const minTime = new Date(Date.now() + 10 * 60 * 1000) // mínimo 10 min
    if (scheduledDate <= minTime) {
      return res.status(400).json({ error: 'O agendamento deve ser pelo menos 10 minutos no futuro' })
    }

    const { data: post, error: dbError } = await supabase
      .from('instagram_posts')
      .insert({
        created_by: user.id,
        media_url: mediaUrl,
        caption: caption ?? '',
        media_type: 'IMAGE',
        scheduled_time: scheduledTime,
        status: 'scheduled',
      })
      .select()
      .single()

    if (dbError) return res.status(500).json({ error: dbError.message })
    return res.json({ success: true, post })
  }

  // ─── DELETE: cancelar post agendado ──────────────────────────────────────
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
