import type { VercelRequest, VercelResponse } from '@vercel/node'

const META_BASE = 'https://graph.facebook.com/v19.0'
const INSTAGRAM_ACCOUNT_ID = '17841447803654486'

function auth(req: VercelRequest, res: VercelResponse): boolean {
  const token = process.env.DASHBOARD_TOKEN
  const header = req.headers.authorization ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token || provided !== token) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!auth(req, res)) return

  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120')

  const accessToken = process.env.META_ACCESS_TOKEN ?? ''

  try {
    // Busca perfil
    const profileUrl = new URL(`${META_BASE}/${INSTAGRAM_ACCOUNT_ID}`)
    profileUrl.searchParams.set('fields', 'id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url')
    profileUrl.searchParams.set('access_token', accessToken)

    // Busca últimos 20 posts
    const mediaUrl = new URL(`${META_BASE}/${INSTAGRAM_ACCOUNT_ID}/media`)
    mediaUrl.searchParams.set('fields', 'id,media_type,media_url,thumbnail_url,permalink,caption,timestamp,like_count,comments_count')
    mediaUrl.searchParams.set('limit', '20')
    mediaUrl.searchParams.set('access_token', accessToken)

    const [profileRes, mediaRes] = await Promise.all([
      fetch(profileUrl.toString()),
      fetch(mediaUrl.toString()),
    ])

    if (!profileRes.ok || !mediaRes.ok) {
      res.status(502).json({ error: 'Erro ao buscar dados do Instagram' })
      return
    }

    const profileData = await profileRes.json() as {
      id: string; username: string; name: string; biography: string
      followers_count: number; follows_count: number; media_count: number
      profile_picture_url?: string
    }

    const mediaData = await mediaRes.json() as {
      data: {
        id: string; media_type: string; media_url?: string; thumbnail_url?: string
        permalink: string; caption?: string; timestamp: string
        like_count: number; comments_count: number
      }[]
    }

    const posts = mediaData.data ?? []

    // Busca insights para cada post em paralelo (lotes de 5)
    const postsWithInsights = await Promise.all(
      posts.map(async post => {
        try {
          const insightMetrics = post.media_type === 'VIDEO'
            ? 'reach,saved,shares,video_views'
            : 'reach,saved,shares'

          const insightUrl = new URL(`${META_BASE}/${post.id}/insights`)
          insightUrl.searchParams.set('metric', insightMetrics)
          insightUrl.searchParams.set('access_token', accessToken)

          const insightRes = await fetch(insightUrl.toString())
          if (!insightRes.ok) return { ...post, reach: 0, saved: 0, shares: 0, videoViews: 0 }

          const insightData = await insightRes.json() as {
            data: { name: string; values: { value: number }[] }[]
          }

          const getValue = (name: string) =>
            insightData.data?.find(d => d.name === name)?.values?.[0]?.value ?? 0

          const reach = getValue('reach')
          const saved = getValue('saved')
          const shares = getValue('shares')
          const videoViews = getValue('video_views')

          const totalEngagement = post.like_count + post.comments_count + saved + shares
          const engagementRate = reach > 0 ? (totalEngagement / reach) * 100 : 0
          const saveRate = reach > 0 ? (saved / reach) * 100 : 0
          const shareRate = reach > 0 ? (shares / reach) * 100 : 0

          return {
            id: post.id,
            mediaType: post.media_type,
            mediaUrl: post.media_url,
            thumbnailUrl: post.thumbnail_url,
            permalink: post.permalink,
            caption: post.caption,
            timestamp: post.timestamp,
            likeCount: post.like_count,
            commentsCount: post.comments_count,
            reach, saved, shares, videoViews,
            engagementRate, saveRate, shareRate,
          }
        } catch {
          return {
            id: post.id,
            mediaType: post.media_type,
            mediaUrl: post.media_url,
            thumbnailUrl: post.thumbnail_url,
            permalink: post.permalink,
            caption: post.caption,
            timestamp: post.timestamp,
            likeCount: post.like_count,
            commentsCount: post.comments_count,
            reach: 0, saved: 0, shares: 0, videoViews: 0,
            engagementRate: 0, saveRate: 0, shareRate: 0,
          }
        }
      })
    )

    res.json({
      profile: {
        username: profileData.username,
        name: profileData.name,
        biography: profileData.biography,
        followersCount: profileData.followers_count,
        followsCount: profileData.follows_count,
        mediaCount: profileData.media_count,
        profilePictureUrl: profileData.profile_picture_url,
      },
      posts: postsWithInsights,
    })
  } catch (err) {
    console.error('instagram-data error:', err)
    res.status(500).json({ error: 'Erro interno' })
  }
}
