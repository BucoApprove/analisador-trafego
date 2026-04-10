import { useState, useEffect, useCallback } from 'react'
import {
  Calendar, Clock, Image, Send, X, RefreshCw,
  Camera, AlertCircle, CheckCircle, Loader2, ExternalLink,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SectionHeader, TabError } from './components'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props { token: string; enabled: boolean }

interface InstagramPost {
  id: string
  media_url: string
  caption: string
  media_type: string
  scheduled_time: string | null
  published_at: string | null
  status: 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled'
  error_message: string | null
  instagram_post_id: string | null
  permalink: string | null
  created_at: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<InstagramPost['status'], string> = {
  scheduled:  'Agendado',
  publishing: 'Publicando...',
  published:  'Publicado',
  failed:     'Falhou',
  cancelled:  'Cancelado',
}

const STATUS_COLOR: Record<InstagramPost['status'], string> = {
  scheduled:  'bg-blue-100 text-blue-700',
  publishing: 'bg-yellow-100 text-yellow-700',
  published:  'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-700',
  cancelled:  'bg-gray-100 text-gray-500',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Data mínima para agendamento (15 min no futuro)
function minScheduleDate() {
  return new Date(Date.now() + 15 * 60 * 1000).toISOString().slice(0, 16)
}

// ─── Post Card ────────────────────────────────────────────────────────────────

function PostCard({ post, onCancel }: { post: InstagramPost; onCancel: (id: string) => void }) {
  const canCancel = post.status === 'scheduled' || post.status === 'failed'

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex gap-3">
          {/* Thumbnail */}
          <div className="shrink-0 h-16 w-16 rounded-md bg-muted overflow-hidden border">
            <img
              src={post.media_url}
              alt=""
              className="h-full w-full object-cover"
              onError={e => {
                const el = e.target as HTMLImageElement
                el.style.display = 'none'
                el.parentElement!.innerHTML =
                  '<div class="h-full w-full flex items-center justify-center text-muted-foreground"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div>'
              }}
            />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0 space-y-1.5">
                {/* Caption */}
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {post.caption || <span className="italic">Sem legenda</span>}
                </p>

                {/* Status + Data */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[post.status]}`}>
                    {STATUS_LABEL[post.status]}
                  </span>

                  {post.scheduled_time && post.status === 'scheduled' && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDateTime(post.scheduled_time)}
                    </span>
                  )}

                  {post.published_at && post.status === 'published' && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <CheckCircle className="h-3 w-3 text-green-600" />
                      {formatDateTime(post.published_at)}
                    </span>
                  )}

                  {post.permalink && (
                    <a
                      href={post.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-pink-600 hover:underline flex items-center gap-0.5"
                    >
                      Ver no Instagram
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                {/* Erro */}
                {post.error_message && (
                  <p className="text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {post.error_message}
                  </p>
                )}
              </div>

              {/* Botão cancelar */}
              {canCancel && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0 h-8 w-8 p-0"
                  title="Cancelar post"
                  onClick={() => onCancel(post.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export default function TabInstagramGestor({ token, enabled }: Props) {
  const [posts, setPosts] = useState<InstagramPost[]>([])
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Form
  const [mediaUrl, setMediaUrl] = useState('')
  const [caption, setCaption] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [publishNow, setPublishNow] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null)

  const loadPosts = useCallback(async () => {
    setLoadingPosts(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/instagram-content', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? `Erro ${res.status}`)
      }
      const data = await res.json() as { posts: InstagramPost[] }
      setPosts(data.posts)
    } catch (e) {
      setLoadError((e as Error).message)
    } finally {
      setLoadingPosts(false)
    }
  }, [token])

  useEffect(() => {
    if (enabled) loadPosts()
  }, [enabled, loadPosts])

  async function handleSubmit() {
    setSubmitError(null)
    setSubmitSuccess(null)

    if (!mediaUrl.trim()) return setSubmitError('URL da mídia é obrigatória')
    if (!publishNow && !scheduledTime) return setSubmitError('Selecione a data e hora de publicação')
    if (caption.length > 2200) return setSubmitError('Legenda muito longa (máx. 2.200 caracteres)')

    setSubmitting(true)
    try {
      const res = await fetch('/api/instagram-content', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mediaUrl,
          caption,
          scheduledTime: publishNow ? undefined : scheduledTime,
          publishNow,
        }),
      })
      const data = await res.json() as { success?: boolean; error?: string }
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`)

      setSubmitSuccess(publishNow ? 'Post publicado com sucesso!' : 'Post agendado com sucesso!')
      setMediaUrl('')
      setCaption('')
      setScheduledTime('')
      await loadPosts()
    } catch (e) {
      setSubmitError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel(id: string) {
    if (!confirm('Cancelar este post agendado?')) return
    try {
      const res = await fetch(`/api/instagram-content?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? `Erro ${res.status}`)
      }
      await loadPosts()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  if (!enabled) return null

  const scheduledPosts  = posts.filter(p => p.status === 'scheduled' || p.status === 'publishing')
  const publishedPosts  = posts.filter(p => p.status === 'published')
  const failedPosts     = posts.filter(p => p.status === 'failed')

  return (
    <div className="space-y-6">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera className="h-5 w-5 text-pink-600" />
          <h1 className="text-xl font-bold">Instagram — Conteúdo</h1>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-pink-100 text-pink-700">
            Admin
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={loadPosts} disabled={loadingPosts}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loadingPosts ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {/* ─── Formulário de novo post ─────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Send className="h-4 w-4 text-pink-600" />
            Novo Post
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* URL da mídia */}
          <div>
            <label className="text-sm font-medium mb-1 block">URL da Imagem *</label>
            <div className="flex gap-2">
              <input
                type="url"
                value={mediaUrl}
                onChange={e => { setMediaUrl(e.target.value); setSubmitSuccess(null) }}
                placeholder="https://exemplo.com/imagem.jpg"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {mediaUrl && (
                <a href={mediaUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" type="button" title="Pré-visualizar imagem">
                    <Image className="h-4 w-4" />
                  </Button>
                </a>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              A URL deve ser pública (HTTPS) — JPEG ou PNG, min. 320px
            </p>
          </div>

          {/* Legenda */}
          <div>
            <label className="text-sm font-medium mb-1 flex justify-between">
              <span>Legenda</span>
              <span className={caption.length > 2000 ? 'text-red-500 font-semibold' : 'text-muted-foreground'}>
                {caption.length.toLocaleString('pt-BR')}/2.200
              </span>
            </label>
            <textarea
              value={caption}
              onChange={e => { setCaption(e.target.value); setSubmitSuccess(null) }}
              placeholder="Escreva a legenda do post..."
              rows={4}
              maxLength={2200}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          </div>

          {/* Modo de publicação */}
          <div>
            <label className="text-sm font-medium mb-2 block">Modo de Publicação</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setPublishNow(false); setSubmitSuccess(null) }}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border transition-colors ${
                  !publishNow
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-input bg-background hover:bg-accent'
                }`}
              >
                <Calendar className="h-3.5 w-3.5" />
                Agendar
              </button>
              <button
                type="button"
                onClick={() => { setPublishNow(true); setSubmitSuccess(null) }}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border transition-colors ${
                  publishNow
                    ? 'bg-pink-600 text-white border-pink-600'
                    : 'border-input bg-background hover:bg-accent'
                }`}
              >
                <Send className="h-3.5 w-3.5" />
                Publicar Agora
              </button>
            </div>
          </div>

          {/* Data/hora (só quando agendar) */}
          {!publishNow && (
            <div>
              <label className="text-sm font-medium mb-1 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Data e Hora de Publicação *
              </label>
              <input
                type="datetime-local"
                value={scheduledTime}
                min={minScheduleDate()}
                onChange={e => { setScheduledTime(e.target.value); setSubmitSuccess(null) }}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Mínimo: 15 minutos a partir de agora
              </p>
            </div>
          )}

          {/* Feedback */}
          {submitError && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {submitError}
            </div>
          )}
          {submitSuccess && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
              <CheckCircle className="h-4 w-4 shrink-0" />
              {submitSuccess}
            </div>
          )}

          {/* Submit */}
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className={publishNow ? 'bg-pink-600 hover:bg-pink-700' : ''}
          >
            {submitting
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : publishNow
                ? <Send className="h-4 w-4 mr-2" />
                : <Calendar className="h-4 w-4 mr-2" />
            }
            {publishNow ? 'Publicar Agora' : 'Agendar Post'}
          </Button>
        </CardContent>
      </Card>

      {/* ─── Erro ao carregar lista ──────────────────────────────────────── */}
      {loadError && <TabError message={loadError} onRetry={loadPosts} />}

      {/* ─── Posts agendados ─────────────────────────────────────────────── */}
      {scheduledPosts.length > 0 && (
        <div>
          <SectionHeader
            title="Posts Agendados"
            description={`${scheduledPosts.length} post(s) na fila de publicação`}
          />
          <div className="space-y-3">
            {scheduledPosts.map(post => (
              <PostCard key={post.id} post={post} onCancel={handleCancel} />
            ))}
          </div>
        </div>
      )}

      {/* ─── Posts com erro ──────────────────────────────────────────────── */}
      {failedPosts.length > 0 && (
        <div>
          <SectionHeader
            title="Falha na Publicação"
            description="Verifique o erro e reagende se necessário"
          />
          <div className="space-y-3">
            {failedPosts.map(post => (
              <PostCard key={post.id} post={post} onCancel={handleCancel} />
            ))}
          </div>
        </div>
      )}

      {/* ─── Posts publicados ────────────────────────────────────────────── */}
      {publishedPosts.length > 0 && (
        <div>
          <SectionHeader
            title="Publicados"
            description={`${publishedPosts.length} post(s) publicados`}
          />
          <div className="space-y-3">
            {publishedPosts.slice(0, 15).map(post => (
              <PostCard key={post.id} post={post} onCancel={handleCancel} />
            ))}
          </div>
        </div>
      )}

      {/* ─── Estado vazio ────────────────────────────────────────────────── */}
      {!loadingPosts && !loadError && posts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <Camera className="h-10 w-10 mb-3 opacity-25" />
          <p className="font-medium">Nenhum post registrado ainda</p>
          <p className="text-sm mt-1">Use o formulário acima para agendar ou publicar um post.</p>
        </div>
      )}
    </div>
  )
}
