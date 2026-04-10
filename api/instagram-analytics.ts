/**
 * Analytics de conta do Instagram (admin only)
 * Retorna: seguidores, alcance, contas engajadas, views de stories + posts + stories ativos
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authUser, requireAdmin } from './_supabase-auth.js'

const META_BASE = 'https://graph.facebook.com/v22.0'
const INSTAGRAM_ACCOUNT_ID = '17841401980622840'

type InsightValue  = { value: number; end_time: string }
type InsightMetric = { name: string; period: string; values: InsightValue[] }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await authUser(req, res)
  if (!user) return
  if (!requireAdmin(user, res)) return

  const accessToken = process.env.META_ACCESS_TOKEN ?? ''
  const days = Math.min(parseInt((req.query.days as string) ?? '30', 10) || 30, 90)

  const until   = new Date()
  const since   = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const sinceTs = Math.floor(since.getTime() / 1000)
  const untilTs = Math.floor(until.getTime() / 1000)

  let dailyStats: {
    date: string; reach: number; engaged: number
    profileTaps: number; followers: number; followerGain: number; views: number
  }[] = []

  let summary = {
    totalReach: 0, totalEngaged: 0, totalProfileTaps: 0, totalViews: 0,
    followerGainTotal: 0, avgDailyReach: 0,
  }

  let insightsError: string | null = null

  try {
    // Métricas com period=day simples
    const params = new URLSearchParams({
      metric: 'reach,follower_count,views',
      period: 'day',
      since: sinceTs.toString(),
      until: untilTs.toString(),
      access_token: accessToken,
    })

    // Métricas que exigem metric_type=total_value
    const paramsTotals = new URLSearchParams({
      metric: 'accounts_engaged,profile_links_taps',
      period: 'day',
      metric_type: 'total_value',
      since: sinceTs.toString(),
      until: untilTs.toString(),
      access_token: accessToken,
    })

    const [insightsRes, totalRes] = await Promise.all([
      fetch(`${META_BASE}/${INSTAGRAM_ACCOUNT_ID}/insights?${params}`),
      fetch(`${META_BASE}/${INSTAGRAM_ACCOUNT_ID}/insights?${paramsTotals}`),
    ])

    const insightsBody = await insightsRes.json() as {
      data?: InsightMetric[]
      error?: { message: string; code: number }
    }
    const totalBody = await totalRes.json() as {
      data?: InsightMetric[]
      error?: { message: string; code: number }
    }

    if (insightsBody.error) {
      insightsError = insightsBody.error.message
    } else {
      const getVal = (name: string, body: typeof insightsBody): InsightValue[] =>
        body.data?.find(d => d.name === name)?.values ?? []

      const reachValues      = getVal('reach', insightsBody)
      const followerValues   = getVal('follower_count', insightsBody)
      const viewsValues      = getVal('views', insightsBody)
      const engagedValues    = totalBody.error ? [] : getVal('accounts_engaged', totalBody)
      const profileTapValues = totalBody.error ? [] : getVal('profile_links_taps', totalBody)

      const dateMap = new Map<string, typeof dailyStats[number]>()

      const merge = (
        values: InsightValue[],
        key: 'reach' | 'engaged' | 'profileTaps' | 'followers' | 'views'
      ) => {
        values.forEach(v => {
          const date = v.end_time.slice(0, 10)
          const row = dateMap.get(date) ?? {
            date, reach: 0, engaged: 0, profileTaps: 0, followers: 0, followerGain: 0, views: 0,
          }
          row[key] = v.value
          dateMap.set(date, row)
        })
      }

      merge(reachValues,      'reach')
      merge(followerValues,   'followers')
      merge(viewsValues,      'views')
      merge(engagedValues,    'engaged')
      merge(profileTapValues, 'profileTaps')

      dailyStats = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date))
      for (let i = 1; i < dailyStats.length; i++) {
        dailyStats[i].followerGain = dailyStats[i].followers - dailyStats[i - 1].followers
      }

      summary = {
        totalReach:      reachValues.reduce((s, v) => s + v.value, 0),
        totalEngaged:    engagedValues.reduce((s, v) => s + v.value, 0),
        totalProfileTaps: profileTapValues.reduce((s, v) => s + v.value, 0),
        totalViews:      viewsValues.reduce((s, v) => s + v.value, 0),
        followerGainTotal: dailyStats.length > 1
          ? dailyStats.at(-1)!.followers - dailyStats[0].followers : 0,
        avgDailyReach: Math.round(
          reachValues.reduce((s, v) => s + v.value, 0) / Math.max(dailyStats.length, 1)
        ),
      }
    }
  } catch (err) {
    insightsError = (err as Error).message
  }

  // ─── Stories ativos (últimas 24h) ────────────────────────────────────────
  let stories: object[] = []
  try {
    const storiesRes = await fetch(
      `${META_BASE}/${INSTAGRAM_ACCOUNT_ID}/stories?fields=id,media_type,media_url,timestamp&access_token=${accessToken}`
    )
    const storiesBody = await storiesRes.json() as {
      data?: { id: string; media_type: string; media_url?: string; timestamp: string }[]
      error?: { message: string }
    }

    if (!storiesBody.error && storiesBody.data?.length) {
      stories = await Promise.all(
        storiesBody.data.map(async story => {
          try {
            const iRes = await fetch(
              `${META_BASE}/${story.id}/insights?metric=impressions,reach,replies,taps_forward,taps_back,exits&access_token=${accessToken}`
            )
            const iBody = await iRes.json() as {
              data?: { name: string; values: { value: number }[] }[]
              error?: { message: string }
            }

            if (iBody.error) throw new Error(iBody.error.message)

            const get = (n: string) => iBody.data?.find(d => d.name === n)?.values?.[0]?.value ?? 0

            return {
              id: story.id,
              mediaType: story.media_type,
              mediaUrl: story.media_url,
              timestamp: story.timestamp,
              impressions: get('impressions'),
              reach: get('reach'),
              replies: get('replies'),
              tapsForward: get('taps_forward'),
              tapsBack: get('taps_back'),
              exits: get('exits'),
            }
          } catch {
            return {
              id: story.id,
              mediaType: story.media_type,
              mediaUrl: story.media_url,
              timestamp: story.timestamp,
              impressions: 0, reach: 0, replies: 0,
              tapsForward: 0, tapsBack: 0, exits: 0,
            }
          }
        })
      )
    }
  } catch (err) {
    console.error('stories error:', (err as Error).message)
  }

  // ─── Posts com insights ───────────────────────────────────────────────────
  let posts: object[] = []
  try {
    const mediaUrl = new URL(`${META_BASE}/${INSTAGRAM_ACCOUNT_ID}/media`)
    mediaUrl.searchParams.set('fields', 'id,media_type,media_url,thumbnail_url,permalink,caption,timestamp,like_count,comments_count')
    mediaUrl.searchParams.set('limit', '20')
    mediaUrl.searchParams.set('access_token', accessToken)

    const mediaRes  = await fetch(mediaUrl.toString())
    const mediaBody = await mediaRes.json() as {
      data?: {
        id: string; media_type: string; media_url?: string; thumbnail_url?: string
        permalink: string; caption?: string; timestamp: string
        like_count: number; comments_count: number
      }[]
      error?: { message: string }
    }

    if (mediaBody.error) throw new Error(mediaBody.error.message)

    posts = await Promise.all(
      (mediaBody.data ?? []).map(async post => {
        try {
          const isVideo = post.media_type === 'VIDEO' || post.media_type === 'REELS'
          const metrics = isVideo ? 'reach,saved,shares,video_views' : 'reach,saved,shares'
          const iUrl    = new URL(`${META_BASE}/${post.id}/insights`)
          iUrl.searchParams.set('metric', metrics)
          iUrl.searchParams.set('access_token', accessToken)

          const iRes  = await fetch(iUrl.toString())
          const iBody = await iRes.json() as {
            data?: { name: string; values: { value: number }[] }[]
            error?: { message: string }
          }

          if (iBody.error) throw new Error(iBody.error.message)

          const get      = (n: string) => iBody.data?.find(d => d.name === n)?.values?.[0]?.value ?? 0
          const reach    = get('reach')
          const saved    = get('saved')
          const shares   = get('shares')
          const videoViews = get('video_views')
          const totalEng = post.like_count + post.comments_count + saved + shares
          const engRate  = reach > 0 ? (totalEng / reach) * 100 : 0

          return {
            id: post.id, mediaType: post.media_type, mediaUrl: post.media_url,
            thumbnailUrl: post.thumbnail_url, permalink: post.permalink,
            caption: post.caption, timestamp: post.timestamp,
            likeCount: post.like_count, commentsCount: post.comments_count,
            reach, saved, shares, videoViews, engRate,
          }
        } catch {
          return {
            id: post.id, mediaType: post.media_type, mediaUrl: post.media_url,
            thumbnailUrl: post.thumbnail_url, permalink: post.permalink,
            caption: post.caption, timestamp: post.timestamp,
            likeCount: post.like_count, commentsCount: post.comments_count,
            reach: 0, saved: 0, shares: 0, videoViews: 0, engRate: 0,
          }
        }
      })
    )
  } catch (err) {
    console.error('instagram-analytics posts error:', (err as Error).message)
  }

  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120')
  res.json({ dailyStats, summary, posts, stories, insightsError })
}
