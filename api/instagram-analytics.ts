/**
 * Analytics de conta do Instagram (admin only)
 * Retorna: crescimento de seguidores, alcance e impressões diários
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authUser, requireAdmin } from './_supabase-auth.js'

const META_BASE = 'https://graph.facebook.com/v22.0'
const INSTAGRAM_ACCOUNT_ID = '17841447803654486'

type InsightValue = { value: number; end_time: string }
type InsightMetric = { name: string; period: string; values: InsightValue[] }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await authUser(req, res)
  if (!user) return
  if (!requireAdmin(user, res)) return

  const accessToken = process.env.META_ACCESS_TOKEN ?? ''
  const days = Math.min(parseInt(req.query.days as string ?? '30', 10) || 30, 90)

  const until = new Date()
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const sinceTs = Math.floor(since.getTime() / 1000)
  const untilTs = Math.floor(until.getTime() / 1000)

  try {
    // ─── Insights diários da conta ───────────────────────────────────────
    const params = new URLSearchParams({
      metric: 'reach,impressions,profile_views,follower_count',
      period: 'day',
      since: sinceTs.toString(),
      until: untilTs.toString(),
      access_token: accessToken,
    })

    const insightsRes = await fetch(`${META_BASE}/${INSTAGRAM_ACCOUNT_ID}/insights?${params}`)
    const insightsBody = await insightsRes.json() as {
      data?: InsightMetric[]
      error?: { message: string; code: number }
    }

    if (insightsBody.error) {
      throw new Error(insightsBody.error.message)
    }

    const getValues = (name: string): InsightValue[] =>
      insightsBody.data?.find(d => d.name === name)?.values ?? []

    const reachValues       = getValues('reach')
    const impressionValues  = getValues('impressions')
    const profileViewValues = getValues('profile_views')
    const followerValues    = getValues('follower_count')

    // ─── Últimos 20 posts com insights ──────────────────────────────────
    const mediaUrl = new URL(`${META_BASE}/${INSTAGRAM_ACCOUNT_ID}/media`)
    mediaUrl.searchParams.set('fields', 'id,media_type,media_url,thumbnail_url,permalink,caption,timestamp,like_count,comments_count')
    mediaUrl.searchParams.set('limit', '20')
    mediaUrl.searchParams.set('access_token', accessToken)

    const mediaRes = await fetch(mediaUrl.toString())
    const mediaBody = await mediaRes.json() as {
      data?: {
        id: string; media_type: string; media_url?: string; thumbnail_url?: string
        permalink: string; caption?: string; timestamp: string
        like_count: number; comments_count: number
      }[]
    }

    const posts = mediaBody.data ?? []

    const postsWithInsights = await Promise.all(
      posts.map(async post => {
        try {
          const isVideo = post.media_type === 'VIDEO' || post.media_type === 'REELS'
          const metrics = isVideo ? 'reach,saved,shares,video_views' : 'reach,saved,shares'
          const iUrl = new URL(`${META_BASE}/${post.id}/insights`)
          iUrl.searchParams.set('metric', metrics)
          iUrl.searchParams.set('access_token', accessToken)

          const iRes = await fetch(iUrl.toString())
          if (!iRes.ok) throw new Error('insights error')
          const iBody = await iRes.json() as { data: { name: string; values: { value: number }[] }[] }

          const get = (n: string) => iBody.data?.find(d => d.name === n)?.values?.[0]?.value ?? 0
          const reach  = get('reach')
          const saved  = get('saved')
          const shares = get('shares')
          const videoViews = get('video_views')
          const totalEng = post.like_count + post.comments_count + saved + shares
          const engRate = reach > 0 ? (totalEng / reach) * 100 : 0

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
            reach, saved, shares, videoViews, engRate,
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
            reach: 0, saved: 0, shares: 0, videoViews: 0, engRate: 0,
          }
        }
      })
    )

    // ─── Monta série diária ──────────────────────────────────────────────
    const dateMap = new Map<string, {
      date: string
      reach: number
      impressions: number
      profileViews: number
      followers: number
    }>()

    const merge = (values: InsightValue[], key: 'reach' | 'impressions' | 'profileViews' | 'followers') => {
      values.forEach(v => {
        const date = v.end_time.slice(0, 10)
        const row = dateMap.get(date) ?? { date, reach: 0, impressions: 0, profileViews: 0, followers: 0 }
        row[key] = v.value
        dateMap.set(date, row)
      })
    }

    merge(reachValues,       'reach')
    merge(impressionValues,  'impressions')
    merge(profileViewValues, 'profileViews')
    merge(followerValues,    'followers')

    const dailyStats = Array.from(dateMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))

    // Calcula ganho de seguidores por dia
    const dailyStatsWithGain = dailyStats.map((row, i) => ({
      ...row,
      followerGain: i === 0 ? 0 : row.followers - dailyStats[i - 1].followers,
    }))

    const totalReach        = reachValues.reduce((s, v) => s + v.value, 0)
    const totalImpressions  = impressionValues.reduce((s, v) => s + v.value, 0)
    const totalProfileViews = profileViewValues.reduce((s, v) => s + v.value, 0)
    const followerGainTotal = dailyStats.length > 1
      ? dailyStats.at(-1)!.followers - dailyStats[0].followers
      : 0

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120')
    res.json({
      dailyStats: dailyStatsWithGain,
      summary: {
        totalReach,
        totalImpressions,
        totalProfileViews,
        followerGainTotal,
        avgDailyReach: Math.round(totalReach / Math.max(dailyStats.length, 1)),
      },
      posts: postsWithInsights,
    })
  } catch (err) {
    console.error('instagram-analytics error:', err)
    res.status(500).json({ error: (err as Error).message ?? 'Erro interno' })
  }
}
