import { useState, useEffect, useCallback } from 'react'
import {
  Calendar, Clock, Image, Send, X, RefreshCw, Camera,
  AlertCircle, CheckCircle, Loader2, ExternalLink, Film,
  Heart, MessageCircle, Bookmark, Share2, Eye, TrendingUp, Users,
  UserPlus, Link2, Timer, Repeat2,
} from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SectionHeader, TabError, TabLoading, KpiCard, CHART_COLORS, formatPercent } from './components'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props { token: string; enabled: boolean }

type MediaType = 'IMAGE' | 'REELS'
type PostStatus = 'scheduled' | 'processing' | 'publishing' | 'published' | 'failed' | 'cancelled'

interface ScheduledPost {
  id: string
  media_url: string
  caption: string
  media_type: MediaType
  scheduled_time: string | null
  published_at: string | null
  status: PostStatus
  error_message: string | null
  instagram_post_id: string | null
  permalink: string | null
  created_at: string
}

interface DailyStat {
  date: string
  reach: number
  engaged: number
  profileTaps: number
  followers: number
  followerGain: number
  views: number
}

interface AnalyticsSummary {
  totalReach: number
  totalEngaged: number
  totalProfileTaps: number
  totalViews: number
  followerGainTotal: number
  avgDailyReach: number
}

interface AnalyticsPost {
  id: string
  mediaType: string
  mediaUrl?: string
  thumbnailUrl?: string
  permalink: string
  caption?: string
  timestamp: string
  likeCount: number
  commentsCount: number
  reach: number
  saved: number
  shares: number
  follows: number
  profileVisits: number
  videoViews: number
  avgWatchTimeSec: number
  replays: number
  engRate: number
}

interface AnalyticsStory {
  id: string
  mediaType: string
  mediaUrl?: string
  timestamp: string
  impressions: number
  reach: number
  replies: number
  tapsForward: number
  tapsBack: number
  exits: number
}

interface AnalyticsData {
  dailyStats: DailyStat[]
  summary: AnalyticsSummary
  posts: AnalyticsPost[]
  stories: AnalyticsStory[]
  insightsError: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<PostStatus, string> = {
  scheduled:  'Agendado',
  processing: 'Processando...',
  publishing: 'Publicando...',
  published:  'Publicado',
  failed:     'Falhou',
  cancelled:  'Cancelado',
}
const STATUS_COLOR: Record<PostStatus, string> = {
  scheduled:  'bg-blue-100 text-blue-700',
  processing: 'bg-yellow-100 text-yellow-700',
  publishing: 'bg-yellow-100 text-yellow-700',
  published:  'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-700',
  cancelled:  'bg-gray-100 text-gray-500',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) { return n.toLocaleString('pt-BR') }
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
function minSchedule() {
  return new Date(Date.now() + 15 * 60 * 1000).toISOString().slice(0, 16)
}

// ─── Seção Toggle ─────────────────────────────────────────────────────────────

function SectionTab({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-pink-600 text-pink-600'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

// ─── Post Card (agendados) ────────────────────────────────────────────────────

function ScheduledPostCard({ post, onCancel }: { post: ScheduledPost; onCancel: (id: string) => void }) {
  const canCancel = post.status === 'scheduled' || post.status === 'failed'
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex gap-3">
          <div className="shrink-0 h-16 w-16 rounded-md bg-muted overflow-hidden border flex items-center justify-center">
            {post.media_type === 'REELS'
              ? <Film className="h-6 w-6 text-muted-foreground" />
              : <img
                  src={post.media_url}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  {post.media_type === 'REELS' && (
                    <Badge variant="secondary" className="text-xs py-0 px-1.5">Reels</Badge>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[post.status]}`}>
                    {STATUS_LABEL[post.status]}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {post.caption || <span className="italic">Sem legenda</span>}
                </p>
                <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                  {post.scheduled_time && post.status === 'scheduled' && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {fmtDate(post.scheduled_time)}
                    </span>
                  )}
                  {post.published_at && (
                    <span className="flex items-center gap-1">
                      <CheckCircle className="h-3 w-3 text-green-600" />
                      {fmtDate(post.published_at)}
                    </span>
                  )}
                  {post.permalink && (
                    <a
                      href={post.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-pink-600 hover:underline flex items-center gap-0.5"
                    >
                      Ver <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                {post.error_message && (
                  <p className="text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {post.error_message}
                  </p>
                )}
              </div>
              {canCancel && (
                <Button
                  variant="ghost" size="sm"
                  className="h-8 w-8 p-0 text-red-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                  title="Cancelar"
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

// ─── Seção de Agendamento ─────────────────────────────────────────────────────

function AgendamentoSection({ token }: { token: string }) {
  const [posts, setPosts] = useState<ScheduledPost[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [mediaType, setMediaType] = useState<MediaType>('IMAGE')
  const [mediaUrl, setMediaUrl] = useState('')
  const [caption, setCaption] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [publishNow, setPublishNow] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null)

  const loadPosts = useCallback(async () => {
    setLoading(true); setLoadError(null)
    try {
      const res = await fetch('/api/instagram-content', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json() as { posts?: ScheduledPost[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`)
      setPosts(data.posts ?? [])
    } catch (e) {
      setLoadError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { loadPosts() }, [loadPosts])

  async function handleSubmit() {
    setSubmitError(null); setSubmitSuccess(null)
    if (!mediaUrl.trim()) return setSubmitError('URL da mídia é obrigatória')
    if (!publishNow && !scheduledTime) return setSubmitError('Selecione a data de publicação')
    if (caption.length > 2200) return setSubmitError('Legenda muito longa (máx. 2.200 caracteres)')

    setSubmitting(true)
    try {
      const res = await fetch('/api/instagram-content', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaUrl, caption, mediaType, scheduledTime: publishNow ? undefined : scheduledTime, publishNow }),
      })
      const data = await res.json() as { success?: boolean; error?: string; processing?: boolean; message?: string }
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`)

      if (data.processing) {
        setSubmitSuccess(data.message ?? 'Vídeo em processamento, será publicado automaticamente.')
      } else {
        setSubmitSuccess(publishNow ? 'Publicado com sucesso!' : 'Post agendado com sucesso!')
      }
      setMediaUrl(''); setCaption(''); setScheduledTime('')
      await loadPosts()
    } catch (e) {
      setSubmitError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel(id: string) {
    if (!confirm('Cancelar este post?')) return
    try {
      const res = await fetch(`/api/instagram-content?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        throw new Error(d.error ?? `Erro ${res.status}`)
      }
      await loadPosts()
    } catch (e) { alert((e as Error).message) }
  }

  const scheduledPosts  = posts.filter(p => ['scheduled','processing','publishing'].includes(p.status))
  const publishedPosts  = posts.filter(p => p.status === 'published')
  const failedPosts     = posts.filter(p => p.status === 'failed')

  return (
    <div className="space-y-6">
      {/* Formulário */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Send className="h-4 w-4 text-pink-600" />
            Novo Post
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Tipo de mídia */}
          <div>
            <label className="text-sm font-medium mb-2 block">Tipo de Conteúdo</label>
            <div className="flex gap-2">
              {(['IMAGE', 'REELS'] as MediaType[]).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => { setMediaType(type); setMediaUrl(''); setSubmitSuccess(null) }}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border transition-colors ${
                    mediaType === type
                      ? 'bg-pink-600 text-white border-pink-600'
                      : 'border-input bg-background hover:bg-accent'
                  }`}
                >
                  {type === 'IMAGE' ? <Image className="h-3.5 w-3.5" /> : <Film className="h-3.5 w-3.5" />}
                  {type === 'IMAGE' ? 'Imagem' : 'Reels'}
                </button>
              ))}
            </div>
          </div>

          {/* URL */}
          <div>
            <label className="text-sm font-medium mb-1 block">
              {mediaType === 'IMAGE' ? 'URL da Imagem *' : 'URL do Vídeo *'}
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={mediaUrl}
                onChange={e => { setMediaUrl(e.target.value); setSubmitSuccess(null) }}
                placeholder="https://..."
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {mediaUrl && mediaType === 'IMAGE' && (
                <a href={mediaUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" type="button" title="Visualizar">
                    <Image className="h-4 w-4" />
                  </Button>
                </a>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {mediaType === 'IMAGE'
                ? 'URL pública HTTPS — JPEG ou PNG, mín. 320px'
                : 'URL pública HTTPS — MP4, H.264, proporção 9:16, mín. 3s, máx. 15min'}
            </p>
          </div>

          {/* Legenda */}
          <div>
            <label className="text-sm font-medium mb-1 flex justify-between">
              <span>Legenda</span>
              <span className={caption.length > 2000 ? 'text-red-500 font-semibold' : 'text-muted-foreground'}>
                {fmt(caption.length)}/2.200
              </span>
            </label>
            <textarea
              value={caption}
              onChange={e => { setCaption(e.target.value); setSubmitSuccess(null) }}
              placeholder="Escreva a legenda..."
              rows={4}
              maxLength={2200}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          </div>

          {/* Modo */}
          <div>
            <label className="text-sm font-medium mb-2 block">Publicação</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setPublishNow(false); setSubmitSuccess(null) }}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border transition-colors ${
                  !publishNow ? 'bg-primary text-primary-foreground border-primary' : 'border-input bg-background hover:bg-accent'
                }`}
              >
                <Calendar className="h-3.5 w-3.5" /> Agendar
              </button>
              <button
                type="button"
                onClick={() => { setPublishNow(true); setSubmitSuccess(null) }}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border transition-colors ${
                  publishNow ? 'bg-pink-600 text-white border-pink-600' : 'border-input bg-background hover:bg-accent'
                }`}
              >
                <Send className="h-3.5 w-3.5" /> Publicar Agora
              </button>
            </div>
          </div>

          {!publishNow && (
            <div>
              <label className="text-sm font-medium mb-1 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> Data e Hora *
              </label>
              <input
                type="datetime-local"
                value={scheduledTime}
                min={minSchedule()}
                onChange={e => { setScheduledTime(e.target.value); setSubmitSuccess(null) }}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-xs text-muted-foreground mt-1">Mínimo: 15 minutos a partir de agora</p>
            </div>
          )}

          {submitError && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0" /> {submitError}
            </div>
          )}
          {submitSuccess && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
              <CheckCircle className="h-4 w-4 shrink-0" /> {submitSuccess}
            </div>
          )}

          <Button onClick={handleSubmit} disabled={submitting} className={publishNow ? 'bg-pink-600 hover:bg-pink-700' : ''}>
            {submitting
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : publishNow ? <Send className="h-4 w-4 mr-2" /> : <Calendar className="h-4 w-4 mr-2" />
            }
            {publishNow ? 'Publicar Agora' : 'Agendar Post'}
          </Button>
        </CardContent>
      </Card>

      {loadError && <TabError message={loadError} onRetry={loadPosts} />}

      {/* Agendados / em processamento */}
      {scheduledPosts.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <SectionHeader title="Na Fila" description={`${scheduledPosts.length} post(s) aguardando publicação`} />
          </div>
          <div className="space-y-3">
            {scheduledPosts.map(p => <ScheduledPostCard key={p.id} post={p} onCancel={handleCancel} />)}
          </div>
        </div>
      )}

      {/* Falhados */}
      {failedPosts.length > 0 && (
        <div>
          <SectionHeader title="Falha na Publicação" description="Verifique o erro e tente novamente" />
          <div className="space-y-3">
            {failedPosts.map(p => <ScheduledPostCard key={p.id} post={p} onCancel={handleCancel} />)}
          </div>
        </div>
      )}

      {/* Publicados recentes */}
      {publishedPosts.length > 0 && (
        <div>
          <SectionHeader title="Publicados Recentemente" description={`${publishedPosts.length} posts`} />
          <div className="space-y-3">
            {publishedPosts.slice(0, 10).map(p => <ScheduledPostCard key={p.id} post={p} onCancel={handleCancel} />)}
          </div>
        </div>
      )}

      {!loading && !loadError && posts.length === 0 && (
        <div className="flex flex-col items-center py-16 text-muted-foreground text-center">
          <Camera className="h-10 w-10 mb-3 opacity-25" />
          <p className="font-medium">Nenhum post registrado</p>
          <p className="text-sm mt-1">Use o formulário acima para agendar ou publicar.</p>
        </div>
      )}
    </div>
  )
}

// ─── Seção de Análise ─────────────────────────────────────────────────────────

function AnaliseSection({ token }: { token: string }) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(30)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/instagram-analytics?days=${days}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json() as AnalyticsData & { error?: string }
      if (!res.ok) throw new Error(body.error ?? `Erro ${res.status}`)
      setData(body)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [token, days])

  useEffect(() => { load() }, [load])

  if (loading) return <TabLoading />
  if (error) return <TabError message={error} onRetry={load} />
  if (!data) return null

  const { summary, dailyStats, posts, stories, insightsError } = data

  // Formata datas para eixo X
  const chartData = dailyStats.map(d => ({
    ...d,
    label: new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
  }))

  const topPosts = [...posts].sort((a, b) => b.engRate - a.engRate)

  return (
    <div className="space-y-6">
      {/* Header com selector de período */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Período de análise</p>
        <div className="flex gap-1">
          {[7, 30, 60, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                days === d ? 'bg-primary text-primary-foreground' : 'border border-input hover:bg-accent'
              }`}
            >
              {d}d
            </button>
          ))}
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="ml-2">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Aviso de permissão ausente */}
      {insightsError && (
        <div className="flex items-start gap-2 rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Gráficos de conta indisponíveis</p>
            <p className="text-xs mt-0.5 font-mono bg-yellow-100 px-1 rounded">{insightsError}</p>
          </div>
        </div>
      )}

      {/* KPIs resumo */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={`Novos Seguidores (${days}d)`}
          value={summary.followerGainTotal >= 0 ? `+${fmt(summary.followerGainTotal)}` : fmt(summary.followerGainTotal)}
          color={summary.followerGainTotal >= 0 ? '#7c9885' : '#c17c74'}
        />
        <KpiCard label={`Alcance Total (${days}d)`} value={fmt(summary.totalReach)} color="#5b8fb9" />
        <KpiCard label={`Contas Engajadas (${days}d)`} value={fmt(summary.totalEngaged)} color="#d4a853" />
        <KpiCard label={`Views (${days}d)`} value={fmt(summary.totalViews)} color="#9b7cc1" />
      </div>

      {/* Gráfico: Seguidores */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4 text-green-600" />
              Seguidores por Dia
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={60}
                  tickFormatter={v => v.toLocaleString('pt-BR')} />
                <Tooltip formatter={(v: unknown) => [fmt(v as number), 'Seguidores']} />
                <Line type="monotone" dataKey="followers" stroke={CHART_COLORS[1]} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Gráfico: Ganho diário de seguidores */}
      {chartData.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-600" />
              Ganho Diário de Seguidores
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData.slice(1)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
                <Tooltip formatter={(v: unknown) => [fmt(v as number), 'Novos seguidores']} />
                <Bar dataKey="followerGain" fill={CHART_COLORS[1]} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Gráfico: Alcance + Views diário */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Eye className="h-4 w-4 text-purple-600" />
              Alcance e Views por Dia
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={60}
                  tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                <Tooltip formatter={(v: unknown, name: unknown) => [fmt(v as number), name === 'reach' ? 'Alcance' : 'Views']} />
                <Line type="monotone" dataKey="reach" stroke={CHART_COLORS[2]} dot={false} strokeWidth={2} name="reach" />
                <Line type="monotone" dataKey="views" stroke={CHART_COLORS[4]} dot={false} strokeWidth={2} name="views" />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-2 justify-center text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ background: CHART_COLORS[2] }} /> Alcance</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ background: CHART_COLORS[4] }} /> Views</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stories ativos */}
      {stories.length > 0 && (
        <div>
          <SectionHeader
            title="Stories Ativos (últimas 24h)"
            description={`${stories.length} story(ies) no ar agora`}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {stories.map(story => (
              <Card key={story.id}>
                <CardContent className="pt-4">
                  <div className="flex gap-3">
                    {story.mediaUrl && (
                      <div className="shrink-0 w-14 h-20 rounded bg-muted overflow-hidden border">
                        <img src={story.mediaUrl} alt="" className="h-full w-full object-cover" />
                      </div>
                    )}
                    <div className="flex-1 space-y-1.5 text-xs">
                      <p className="text-muted-foreground">
                        {new Date(story.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <div className="grid grid-cols-2 gap-y-1">
                        <span className="flex items-center gap-1"><Eye className="h-3 w-3 text-purple-500" /> {fmt(story.impressions)} imp.</span>
                        <span className="flex items-center gap-1"><Users className="h-3 w-3 text-blue-500" /> {fmt(story.reach)} alcance</span>
                        <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3 text-green-500" /> {fmt(story.replies)} resp.</span>
                        <span className="flex items-center gap-1 text-red-500"><X className="h-3 w-3" /> {fmt(story.exits)} saídas</span>
                        <span className="col-span-2 text-muted-foreground">
                          ▶ {fmt(story.tapsForward)} frente · ◀ {fmt(story.tapsBack)} atrás
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Posts: top por engajamento */}
      {topPosts.length > 0 && (
        <div>
          <SectionHeader
            title="Desempenho dos Posts"
            description="Últimos 20 posts ordenados por taxa de engajamento"
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {topPosts.map(post => (
              <div key={post.id} className="rounded-lg border p-3 space-y-3 hover:bg-muted/30 transition-colors">
                {/* Miniatura */}
                {(post.mediaUrl || post.thumbnailUrl) && (
                  <div className="relative aspect-square overflow-hidden rounded-md bg-muted">
                    <img
                      src={post.thumbnailUrl ?? post.mediaUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    <Badge variant="secondary" className="absolute right-2 top-2 text-xs">
                      {post.mediaType === 'VIDEO' || post.mediaType === 'REELS' ? 'Reels'
                        : post.mediaType === 'CAROUSEL_ALBUM' ? 'Carrossel' : 'Imagem'}
                    </Badge>
                  </div>
                )}
                {post.caption && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{post.caption}</p>
                )}
                {/* Métricas principais */}
                <div className="grid grid-cols-3 gap-y-1.5 text-xs">
                  <div className="flex items-center gap-1">
                    <Heart className="h-3 w-3 text-rose-500" />
                    <span>{fmt(post.likeCount)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <MessageCircle className="h-3 w-3 text-blue-500" />
                    <span>{fmt(post.commentsCount)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Bookmark className="h-3 w-3 text-yellow-500" />
                    <span>{fmt(post.saved)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Share2 className="h-3 w-3 text-green-500" />
                    <span>{fmt(post.shares)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Eye className="h-3 w-3 text-purple-500" />
                    <span>{fmt(post.reach)}</span>
                  </div>
                  <div className="font-medium text-pink-600">
                    {formatPercent(post.engRate)} eng.
                  </div>
                </div>

                {/* Novos seguidores + cliques externos */}
                <div className="grid grid-cols-2 gap-y-1 text-xs border-t pt-2 mt-1">
                  <div className="flex items-center gap-1">
                    <UserPlus className="h-3 w-3 text-emerald-500" />
                    <span className="text-muted-foreground">Seguidores:</span>
                    <span className="font-medium">+{fmt(post.follows)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Link2 className="h-3 w-3 text-sky-500" />
                    <span className="text-muted-foreground">Cliques ext.:</span>
                    <span className="font-medium">{fmt(post.profileVisits)}</span>
                  </div>
                </div>

                {/* Métricas de Reels */}
                {(post.mediaType === 'VIDEO' || post.mediaType === 'REELS') && (
                  <div className="grid grid-cols-2 gap-y-1 text-xs border-t pt-2 mt-1 bg-violet-50/60 rounded-md px-2 pb-2">
                    <div className="col-span-2 text-[10px] font-semibold text-violet-600 uppercase tracking-wide pt-1 mb-0.5">
                      Reels
                    </div>
                    <div className="flex items-center gap-1">
                      <Eye className="h-3 w-3 text-violet-500" />
                      <span className="text-muted-foreground">Views:</span>
                      <span className="font-medium">{fmt(post.videoViews)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Repeat2 className="h-3 w-3 text-violet-500" />
                      <span className="text-muted-foreground">Replays:</span>
                      <span className="font-medium">{fmt(post.replays)}</span>
                    </div>
                    {post.avgWatchTimeSec > 0 && (
                      <div className="flex items-center gap-1 col-span-2">
                        <Timer className="h-3 w-3 text-violet-500" />
                        <span className="text-muted-foreground">Tempo médio:</span>
                        <span className="font-medium">{post.avgWatchTimeSec}s</span>
                        {post.videoViews > 0 && post.replays > 0 && (
                          <span className="ml-auto text-violet-600 font-medium">
                            {formatPercent((post.replays / post.videoViews) * 100)} replay
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {/* Rodapé */}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{new Date(post.timestamp).toLocaleDateString('pt-BR')}</span>
                  <a
                    href={post.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 hover:text-foreground"
                  >
                    Ver <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab Principal ────────────────────────────────────────────────────────────

export default function TabInstagramGestor({ token, enabled }: Props) {
  const [section, setSection] = useState<'agendamento' | 'analise'>('agendamento')

  if (!enabled) return null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera className="h-5 w-5 text-pink-600" />
          <h1 className="text-xl font-bold">Instagram — Gestor</h1>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-pink-100 text-pink-700">Admin</span>
        </div>
      </div>

      {/* Sub-abas */}
      <div className="border-b flex gap-0">
        <SectionTab active={section === 'agendamento'} onClick={() => setSection('agendamento')}>
          Agendamento de Conteúdo
        </SectionTab>
        <SectionTab active={section === 'analise'} onClick={() => setSection('analise')}>
          Análise de Conteúdo
        </SectionTab>
      </div>

      {section === 'agendamento' && <AgendamentoSection token={token} />}
      {section === 'analise'    && <AnaliseSection token={token} />}
    </div>
  )
}
