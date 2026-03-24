import { useDashboardFetch } from './hooks'
import type { InstagramData } from './types'
import { KpiCard, SectionHeader, TabLoading, TabError, formatPercent } from './components'
import { Badge } from '@/components/ui/badge'
import { Heart, MessageCircle, Bookmark, Share2, Eye, ExternalLink } from 'lucide-react'

interface Props { token: string; enabled: boolean }

export default function TabInstagram({ token, enabled }: Props) {
  const { data, status, error, refetch } = useDashboardFetch<InstagramData>(
    '/api/instagram-data',
    token,
    { enabled, refreshInterval: 10 * 60 * 1000 }
  )

  if (status === 'loading' || status === 'idle') return <TabLoading />
  if (status === 'error') return <TabError message={error ?? 'Erro ao carregar'} onRetry={refetch} />
  if (!data) return null

  const { profile, posts } = data

  return (
    <div className="space-y-6">
      {/* Perfil */}
      <div className="flex items-center gap-4">
        {profile.profilePictureUrl && (
          <img src={profile.profilePictureUrl} alt={profile.username} className="h-16 w-16 rounded-full object-cover" />
        )}
        <div>
          <p className="font-semibold text-lg">@{profile.username}</p>
          <p className="text-sm text-muted-foreground">{profile.name}</p>
          {profile.biography && <p className="mt-1 text-xs text-muted-foreground max-w-sm">{profile.biography}</p>}
        </div>
      </div>

      {/* KPIs do perfil */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Seguidores" value={profile.followersCount.toLocaleString('pt-BR')} color="#d4a853" />
        <KpiCard label="Seguindo" value={profile.followsCount.toLocaleString('pt-BR')} color="#7c9885" />
        <KpiCard label="Posts" value={profile.mediaCount.toLocaleString('pt-BR')} color="#5b8fb9" />
        <KpiCard
          label="Engajamento Médio"
          value={formatPercent(posts.reduce((a, p) => a + p.engagementRate, 0) / (posts.length || 1))}
          sub="últimos 20 posts"
          color="#9b7cc1"
        />
      </div>

      {/* Grid de posts */}
      <SectionHeader title="Últimos Posts" description="Métricas dos 20 posts mais recentes" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map(post => (
          <div key={post.id} className="rounded-lg border p-4 space-y-3 hover:bg-muted/30 transition-colors">
            {/* Miniatura */}
            {(post.mediaUrl || post.thumbnailUrl) && (
              <div className="relative aspect-square overflow-hidden rounded-md bg-muted">
                <img
                  src={post.thumbnailUrl ?? post.mediaUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
                <Badge variant="secondary" className="absolute right-2 top-2 text-xs">
                  {post.mediaType === 'VIDEO' ? 'Vídeo' : post.mediaType === 'CAROUSEL_ALBUM' ? 'Carrossel' : 'Imagem'}
                </Badge>
              </div>
            )}

            {/* Caption */}
            {post.caption && (
              <p className="line-clamp-2 text-xs text-muted-foreground">{post.caption}</p>
            )}

            {/* Métricas */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="flex items-center gap-1">
                <Heart className="h-3 w-3 text-rose-500" />
                <span>{post.likeCount.toLocaleString('pt-BR')}</span>
              </div>
              <div className="flex items-center gap-1">
                <MessageCircle className="h-3 w-3 text-blue-500" />
                <span>{post.commentsCount.toLocaleString('pt-BR')}</span>
              </div>
              <div className="flex items-center gap-1">
                <Bookmark className="h-3 w-3 text-yellow-500" />
                <span>{post.saved.toLocaleString('pt-BR')}</span>
              </div>
              <div className="flex items-center gap-1">
                <Share2 className="h-3 w-3 text-green-500" />
                <span>{post.shares.toLocaleString('pt-BR')}</span>
              </div>
              <div className="flex items-center gap-1">
                <Eye className="h-3 w-3 text-purple-500" />
                <span>{post.reach.toLocaleString('pt-BR')}</span>
              </div>
              <div className="text-muted-foreground">
                {formatPercent(post.engagementRate)} eng.
              </div>
            </div>

            {/* Data + link */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{new Date(post.timestamp).toLocaleDateString('pt-BR')}</span>
              <a href={post.permalink} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-foreground">
                Ver post <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
