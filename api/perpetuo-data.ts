import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authUser } from './_supabase-auth.js'

const META_BASE = 'https://graph.facebook.com/v19.0'

const ACCOUNT_IDS: Record<string, string> = {
  conta1: 'act_1082683452063319',
  conta2: 'act_565958430809772',
}

// Keywords para identificar qual campanha pertence a qual etapa/produto
interface NameFilter { include: string[]; exclude?: string[] }

const NAME_FILTERS: Record<string, NameFilter> = {
  etapa1:             { include: ['impulsi', 'boost', 'seguidor', '[instagram] - post'] },
  etapa2:             { include: ['captura', 'aula'] },
  etapa3:             { include: ['relacionamento', 'engajamento'], exclude: ['ba25', 'ba 25'] },
  etapa4:             { include: ['convers', 'venda'], exclude: ['ba25', 'ba 25'] },
  etapa5:             { include: ['remarketing', 'retarget', 'rmkt'] },
  anatomia:           { include: ['anatomia', 'anato'],                    exclude: ['[low]', 'low_'] },
  patologia:          { include: ['patologia', '[pato', 'pós pato'],        exclude: ['[low]', 'low_'] },
  'lowticket-brasil': { include: ['[low', 'low_'],                          exclude: ['latam', 'mexico', 'colombia'] },
  'lowticket-latam':  { include: ['latam', 'mexico', 'colombia'] },
}

const VALID_VIEWS = new Set(Object.keys(NAME_FILTERS))

// Deriva os action_types que o Meta usa como "Resultado" para um adset.
function getResultTypes(adset: {
  optimization_goal?: string
  promoted_object?: { custom_conversion_id?: string; custom_event_type?: string; custom_event_str?: string }
}, campaignObjective?: string, customConvByEvent?: Map<string, string>): string[] {
  const po = adset.promoted_object
  // Custom conversion explícita (tem ID)
  if (po?.custom_conversion_id) {
    return [`offsite_conversion.custom.${po.custom_conversion_id}`]
  }
  // Custom event do pixel (custom_event_type=OTHER + custom_event_str)
  const eventStr = po?.custom_event_str ?? ''
  if (po?.custom_event_type === 'OTHER' && eventStr) {
    const ccId = customConvByEvent?.get(eventStr.toLowerCase())
    // Retorna o ID da custom conversion + fb_pixel_custom como fallback para dados históricos
    // actionVal usará o primeiro tipo que tiver valor > 0 (sem double-count)
    if (ccId) return [`offsite_conversion.custom.${ccId}`, 'offsite_conversion.fb_pixel_custom']
    return ['offsite_conversion.fb_pixel_custom']
  }
  // Evento padrão
  const event = po?.custom_event_type ?? ''
  if (event === 'LEAD')                  return ['lead', 'onsite_conversion.lead_grouped']
  if (event === 'PURCHASE')              return ['purchase', 'offsite_conversion.fb_pixel_purchase']
  if (event === 'COMPLETE_REGISTRATION') return ['complete_registration']
  // Fallback pelo optimization_goal
  const goal = adset.optimization_goal ?? ''
  if (['LEAD_GENERATION', 'LEAD'].includes(goal))        return ['lead', 'onsite_conversion.lead_grouped']
  // Fallback pelo objective da campanha
  const obj = campaignObjective ?? ''
  if (['LEAD_GENERATION', 'OUTCOME_LEADS'].includes(obj)) return ['lead', 'onsite_conversion.lead_grouped']
  if (['OUTCOME_SALES', 'CONVERSIONS'].includes(obj))     return ['purchase', 'offsite_conversion.fb_pixel_purchase']
  return ['lead', 'onsite_conversion.lead_grouped']
}

function matchesFilter(campaignName: string, filter: NameFilter): boolean {
  const lower = campaignName.toLowerCase()
  if (filter.exclude?.some(kw => lower.includes(kw))) return false
  return filter.include.some(kw => lower.includes(kw))
}

function actionVal(
  actions: { action_type: string; value: string }[] | undefined,
  ...types: string[]
): number {
  if (!actions) return 0
  // Usa o primeiro tipo que tiver valor > 0 (evita double-count entre custom conversion e fb_pixel_custom)
  for (const t of types) {
    const val = Number(actions.find(a => a.action_type === t)?.value ?? 0)
    if (val > 0) return val
  }
  return 0
}

// Decodifica o shortcode do Instagram para o media ID numérico nativo.
// Instagram usa base64url com alphabet próprio de 64 chars.
// Ex: "DE7hLIuM7zQ" → "3547575032298585296"
function instagramShortcodeToMediaId(shortcode: string): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let id = BigInt(0)
  for (const char of shortcode) {
    const idx = ALPHABET.indexOf(char)
    if (idx < 0) return ''
    id = id * BigInt(64) + BigInt(idx)
  }
  return id.toString()
}

async function metaGet(url: URL): Promise<Record<string, unknown>> {
  const res = await fetch(url.toString())
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Meta API ${res.status}: ${txt.substring(0, 300)}`)
  }
  return res.json() as Promise<Record<string, unknown>>
}

// Busca todas as páginas de uma API do Meta (segue paging.next automaticamente)
async function metaGetAll(url: URL): Promise<any[]> {
  const allData: any[] = []
  let nextUrl: string | null = url.toString()
  while (nextUrl) {
    const res = await fetch(nextUrl)
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Meta API ${res.status}: ${txt.substring(0, 300)}`)
    }
    const json = await res.json() as Record<string, unknown>
    const pageData = (json.data as any[]) ?? []
    allData.push(...pageData)
    const paging = json.paging as any
    nextUrl = paging?.next ?? null
  }
  return allData
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdRow {
  adId: string
  adName: string
  spend: number
  results: number
  costPerResult: number
}

interface AdsetRow {
  adsetId: string
  adsetName: string
  adsetStatus: string
  audienceName: string | null
  dailyBudget: number | null
  lifetimeBudget: number | null
  spend: number
  results?: number
  costPerResult?: number
  landingPageViews?: number
  conversionRate?: number
  videoViews3s?: number
  videoViews25pct?: number
  ads: AdRow[]
}

interface CampaignRow {
  campaignId: string
  campaignName: string
  adsets: AdsetRow[]
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const _user = await authUser(req, res)
  if (!_user) return

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  const account = typeof req.query.account === 'string' ? req.query.account : ''

  const accessToken = process.env.META_ACCESS_TOKEN ?? ''
  if (!accessToken) {
    return res.status(503).json({ error: 'META_ACCESS_TOKEN não configurado' })
  }
  const view    = typeof req.query.view    === 'string' ? req.query.view    : ''

  if (!ACCOUNT_IDS[account]) {
    return res.status(400).json({ error: 'account inválido (conta1 | conta2)' })
  }
  if (!VALID_VIEWS.has(view)) {
    return res.status(400).json({ error: `view inválido. Válidos: ${[...VALID_VIEWS].join(', ')}` })
  }

  const today = new Date().toISOString().split('T')[0]
  const re    = /^\d{4}-\d{2}-\d{2}$/
  const since = typeof req.query.since === 'string' && re.test(req.query.since)
    ? req.query.since
    : new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0]
  const until = typeof req.query.until === 'string' && re.test(req.query.until)
    ? req.query.until
    : today

  const acctId    = ACCOUNT_IDS[account]
  const timeRange = JSON.stringify({ since, until })
  const filter    = NAME_FILTERS[view]

  const isVideo = view === 'etapa3'
  const isLead  = view === 'etapa2' || view === 'anatomia' || view === 'patologia'

  // ── Modo rawdebug: retorna resposta crua de um único adset para identificar fields ──
  if (typeof req.query.rawdebug === 'string') {
    const adsetId = req.query.rawdebug
    // Tenta variações para expor instagram_profile_visit
    const baseFields = [
      'spend', 'actions', 'unique_actions',
      'outbound_clicks', 'unique_outbound_clicks',
      'clicks', 'unique_clicks', 'inline_link_clicks',
      'inline_post_engagement', 'reach', 'impressions',
    ].join(',')

    const variants: Array<{ key: string; url: URL }> = []

    // Variante 1: padrão sem janelas (comportamento atual)
    const urlDefault = new URL(`${META_BASE}/${adsetId}/insights`)
    urlDefault.searchParams.set('fields',       baseFields)
    urlDefault.searchParams.set('time_range',   timeRange)
    urlDefault.searchParams.set('access_token', accessToken)
    urlDefault.searchParams.set('limit',        '10')
    variants.push({ key: 'default_no_windows', url: urlDefault })

    // Variante 2: todas as janelas de atribuição explícitas
    const urlAllWindows = new URL(`${META_BASE}/${adsetId}/insights`)
    urlAllWindows.searchParams.set('fields',                     baseFields)
    urlAllWindows.searchParams.set('action_attribution_windows', '1d_click,7d_click,1d_view,28d_click,28d_view')
    urlAllWindows.searchParams.set('time_range',                 timeRange)
    urlAllWindows.searchParams.set('access_token',               accessToken)
    urlAllWindows.searchParams.set('limit',                      '10')
    variants.push({ key: 'all_windows', url: urlAllWindows })

    // Variante 3: action_report_time=impression (em vez de conversion)
    const urlImpression = new URL(`${META_BASE}/${adsetId}/insights`)
    urlImpression.searchParams.set('fields',             baseFields)
    urlImpression.searchParams.set('action_report_time', 'impression')
    urlImpression.searchParams.set('time_range',         timeRange)
    urlImpression.searchParams.set('access_token',       accessToken)
    urlImpression.searchParams.set('limit',              '10')
    variants.push({ key: 'report_time_impression', url: urlImpression })

    const results: Record<string, unknown> = {}
    for (const { key, url } of variants) {
      try {
        const rawRes  = await fetch(url.toString())
        const rawJson = await rawRes.json() as any
        // Extrai só os action_types do primeiro registro para facilitar leitura
        const row = rawJson?.data?.[0]
        results[key] = {
          raw:              rawJson,
          actionTypes:      Object.fromEntries((row?.actions        ?? []).map((a: any) => [a.action_type, a.value])),
          uniqueActionTypes: Object.fromEntries((row?.unique_actions ?? []).map((a: any) => [a.action_type, a.value])),
        }
      } catch (e: any) {
        results[key] = { error: e.message }
      }
    }
    return res.json({ rawdebug: true, adsetId, dateRange: { since, until }, results })
  }

  // ── Modo creativedebug: mostra todos os campos de creative de um adset ──────
  if (typeof req.query.creativedebug === 'string') {
    const adsetId = req.query.creativedebug
    try {
      const adsUrl = new URL(`${META_BASE}/${adsetId}/ads`)
      adsUrl.searchParams.set('fields', [
        'id', 'name', 'status',
        'creative{id,object_story_id,effective_object_story_id,instagram_permalink_url,object_type}',
      ].join(','))
      adsUrl.searchParams.set('access_token', accessToken)
      adsUrl.searchParams.set('limit', '10')
      const adsRes  = await fetch(adsUrl.toString())
      const adsBody = await adsRes.json() as any
      return res.json({ creativedebug: true, adsetId, ads: adsBody.data ?? [], raw: adsBody })
    } catch (e: any) {
      return res.status(500).json({ error: e.message })
    }
  }

  // ── Modo followsdebug: testa o pipeline completo de follows para 1 adset ────
  if (typeof req.query.followsdebug === 'string') {
    const adsetId = req.query.followsdebug
    try {
      // Busca creative com todos os campos de ID disponíveis
      const adsUrl = new URL(`${META_BASE}/${adsetId}/ads`)
      adsUrl.searchParams.set('fields', 'id,creative{id,object_story_id,effective_object_story_id,instagram_permalink_url,object_type}')
      adsUrl.searchParams.set('access_token', accessToken)
      adsUrl.searchParams.set('limit', '10')
      const adsRes  = await fetch(adsUrl.toString())
      const adsBody = await adsRes.json() as any
      const ads     = adsBody.data ?? []

      const steps: any[] = []
      for (const ad of ads) {
        const creative              = (ad.creative as any) ?? {}
        const objectStoryId         = creative.object_story_id         as string | undefined
        const effectiveObjectStoryId = creative.effective_object_story_id as string | undefined

        // object_story_id para posts IG nativos = "{ig_user_id}_{ig_media_id}"
        // Se começa com o IG account ID, a parte depois do _ é o IG media ID nativo
        const igAccountId  = '17841401980622840'
        const igMediaIdFromObjectStory = objectStoryId?.startsWith(igAccountId + '_')
          ? objectStoryId.split('_')[1]
          : undefined

        // Tenta insights com o ID extraído de object_story_id
        let insightsFromObjectStory: any = null
        if (igMediaIdFromObjectStory) {
          const iUrl = new URL(`https://graph.facebook.com/v22.0/${igMediaIdFromObjectStory}/insights`)
          iUrl.searchParams.set('metric', 'follows')
          iUrl.searchParams.set('access_token', accessToken)
          const iRes = await fetch(iUrl.toString())
          insightsFromObjectStory = await iRes.json()
        }

        // Tenta insights com a parte depois do _ do effective_object_story_id
        const effectivePostId = effectiveObjectStoryId?.split('_')[1]
        let insightsFromEffective: any = null
        if (effectivePostId) {
          const iUrl = new URL(`https://graph.facebook.com/v22.0/${effectivePostId}/insights`)
          iUrl.searchParams.set('metric', 'follows')
          iUrl.searchParams.set('access_token', accessToken)
          const iRes = await fetch(iUrl.toString())
          insightsFromEffective = await iRes.json()
        }

        steps.push({
          adId: ad.id,
          objectStoryId,
          effectiveObjectStoryId,
          igMediaIdFromObjectStory,
          effectivePostId,
          insightsFromObjectStory,
          insightsFromEffective,
        })
      }

      return res.json({ followsdebug: true, adsetId, steps })
    } catch (e: any) {
      return res.status(500).json({ error: e.message })
    }
  }

  // ── Modo etapa1debug: busca todos os adsets de etapa1 com campos candidatos ──
  if (req.query.etapa1debug === 'true') {
    const url = new URL(`${META_BASE}/${acctId}/insights`)
    url.searchParams.set('level',  'adset')
    url.searchParams.set('fields', [
      'campaign_name', 'adset_id', 'adset_name', 'spend',
      'reach', 'impressions',
      'inline_post_engagement',
      'actions', 'unique_actions', 'outbound_clicks',
      'video_thruplay_watched_actions',
    ].join(','))
    url.searchParams.set('time_range',   timeRange)
    url.searchParams.set('access_token', accessToken)
    url.searchParams.set('limit',        '200')

    // Também busca optimization_goal + promoted_object de cada adset
    const adsetMetaUrl = new URL(`${META_BASE}/${acctId}/adsets`)
    adsetMetaUrl.searchParams.set('fields',       'id,optimization_goal,promoted_object,campaign_id')
    adsetMetaUrl.searchParams.set('access_token', accessToken)
    adsetMetaUrl.searchParams.set('limit',        '500')

    try {
      const [rows, adsetMeta] = await Promise.all([metaGetAll(url), metaGetAll(adsetMetaUrl)])
      const adsetGoalMap = new Map(adsetMeta.map((a: any) => [
        a.id as string,
        { optimization_goal: a.optimization_goal, promoted_object: a.promoted_object },
      ]))

      const etapa1Rows = rows.filter((r: any) => matchesFilter(r.campaign_name as string, NAME_FILTERS['etapa1']))
      return res.json({
        etapa1debug: true,
        dateRange: { since, until },
        adsets: etapa1Rows.map((r: any) => ({
          adsetId:           r.adset_id,
          adsetName:         r.adset_name,
          campaignName:      r.campaign_name,
          spend:             r.spend,
          // Objetivo do conjunto — chave para descobrir qual métrica o Meta usa como "Resultado"
          optimization_goal: adsetGoalMap.get(r.adset_id as string)?.optimization_goal ?? null,
          promoted_object:   adsetGoalMap.get(r.adset_id as string)?.promoted_object ?? null,
          // Campos standalone
          reach:                  r.reach,
          impressions:            r.impressions,
          inline_post_engagement: r.inline_post_engagement,
          outbound_clicks:        r.outbound_clicks,
          // Todos os action_types como objeto chave/valor
          actionTypes: Object.fromEntries(
            (r.actions ?? []).map((a: any) => [a.action_type, Number(a.value)])
          ),
          uniqueActionTypes: Object.fromEntries(
            (r.unique_actions ?? []).map((a: any) => [a.action_type, Number(a.value)])
          ),
        })),
      })
    } catch (e: any) {
      return res.status(500).json({ error: e.message })
    }
  }

  const adsetInsightFields = [
    'campaign_id', 'campaign_name', 'adset_id', 'adset_name',
    'spend', 'actions', 'unique_actions', 'outbound_clicks',
    'video_thruplay_watched_actions', 'video_p25_watched_actions',
  ].join(',')

  const adInsightFields = [
    'campaign_id', 'campaign_name', 'adset_id', 'ad_id', 'ad_name', 'spend', 'actions', 'unique_actions', 'outbound_clicks',
  ].join(',')

  try {
    // ── 1. Insights no nível de conjunto de anúncios ──────────────────────────
    const adsetUrl = new URL(`${META_BASE}/${acctId}/insights`)
    adsetUrl.searchParams.set('level',        'adset')
    adsetUrl.searchParams.set('fields',       adsetInsightFields)
    adsetUrl.searchParams.set('time_range',   timeRange)
    adsetUrl.searchParams.set('access_token', accessToken)
    adsetUrl.searchParams.set('limit',        '200')

    // ── 2. Insights no nível de anúncio ──────────────────────────────────────
    const adUrl = new URL(`${META_BASE}/${acctId}/insights`)
    adUrl.searchParams.set('level',        'ad')
    adUrl.searchParams.set('fields',       adInsightFields)
    adUrl.searchParams.set('time_range',   timeRange)
    adUrl.searchParams.set('access_token', accessToken)
    adUrl.searchParams.set('limit',        '500')

    // ── 3. Adsets: orçamentos + promoted_object (onde custom_conversion_id vive) ──
    const budgetUrl = new URL(`${META_BASE}/${acctId}/adsets`)
    budgetUrl.searchParams.set('fields',        'id,daily_budget,lifetime_budget,optimization_goal,promoted_object,campaign_id,effective_status,targeting')
    budgetUrl.searchParams.set('access_token',  accessToken)
    budgetUrl.searchParams.set('limit',         '500')

    // ── 4. Campanhas: objective como fallback ─────────────────────────────────
    const campaignUrl = new URL(`${META_BASE}/${acctId}/campaigns`)
    campaignUrl.searchParams.set('fields',           'id,objective')
    campaignUrl.searchParams.set('effective_status', JSON.stringify(['ACTIVE', 'PAUSED', 'ARCHIVED']))
    campaignUrl.searchParams.set('access_token',     accessToken)
    campaignUrl.searchParams.set('limit',            '500')

    // ── 5. Custom conversions: mapeia custom_event_str → custom_conversion_id ──
    const customConvUrl = new URL(`${META_BASE}/${acctId}/customconversions`)
    customConvUrl.searchParams.set('fields',       'id,name,rule')
    customConvUrl.searchParams.set('access_token', accessToken)
    customConvUrl.searchParams.set('limit',        '200')

    const [adsetInsightsData, adInsightsData, adsetsData, campaignsData, customConvsData] = await Promise.all([
      metaGetAll(adsetUrl),
      metaGetAll(adUrl),
      metaGetAll(budgetUrl),
      metaGetAll(campaignUrl),
      metaGetAll(customConvUrl),
    ])

    // Mapa: eventStr (lowercase) → custom_conversion_id
    const customConvByEvent = new Map<string, string>()
    for (const cc of customConvsData) {
      try {
        const rule = JSON.parse(cc.rule as string ?? '{}')
        // Formato real: {"and":[{"event":{"eq":"EventName"}}, ...]}
        const andClauses: any[] = rule?.and ?? []
        for (const clause of andClauses) {
          const eventName = clause?.event?.eq
          if (eventName) {
            const key = (eventName as string).toLowerCase()
            if (!customConvByEvent.has(key)) customConvByEvent.set(key, cc.id as string)
          }
        }
      } catch { /* rule inválida */ }
    }

    // Mapa campaignId → objective (fallback)
    const campaignObjective = new Map<string, string>()
    for (const c of campaignsData) {
      campaignObjective.set(c.id as string, c.objective ?? '')
    }

    // Mapa adsetId → action_types corretos para "Resultado"
    const adsetResultTypes = new Map<string, string[]>()

    // Mapa de orçamentos + resultTypes + status + audiência por adset
    type Budget = { daily: number | null; lifetime: number | null; status: string; audienceName: string | null }
    const budgetMap = new Map<string, Budget>()
    for (const s of adsetsData) {
      const audiences = (s.targeting as any)?.custom_audiences as { id: string; name: string }[] | undefined
      const audienceName = audiences && audiences.length > 0 ? audiences[0].name : null
      budgetMap.set(s.id as string, {
        daily:       s.daily_budget    ? Number(s.daily_budget)    / 100 : null,
        lifetime:    s.lifetime_budget ? Number(s.lifetime_budget) / 100 : null,
        status:      (s.effective_status as string) ?? 'UNKNOWN',
        audienceName,
      })
      const obj = campaignObjective.get(s.campaign_id as string)
      adsetResultTypes.set(s.id as string, getResultTypes(s, obj, customConvByEvent))
    }


    // ── Etapa1: busca followers ganhos via Instagram Graph API ────────────────
    // Pipeline (mesmo do Instagram Gestor):
    //   adset → creative.instagram_permalink_url
    //   → extrai shortcode → decodifica para IG native media ID (sem media list)
    //   → /{ig_post_id}/insights?metric=follows
    // Não requer pages_read_engagement — funciona com instagram_manage_insights
    const ETAPA1_IG_ACCOUNT = '17841401980622840'
    const adsetFollowsMap = new Map<string, number>()
    if (view === 'etapa1') {
      try {
        const etapa1AdsetIds = adsetInsightsData
          .filter((r: any) => matchesFilter(r.campaign_name as string, filter))
          .map((r: any) => r.adset_id as string)

        if (etapa1AdsetIds.length > 0) {
          // 1. Busca creative fields de cada adset → extrai IG native media ID
          //    Fontes tentadas em ordem de prioridade:
          //    a) instagram_post_id        → ID nativo IG direto (posts via "Usar post existente")
          //    b) instagram_permalink_url  → decodifica shortcode (/p/, /reel/, /tv/)
          //    c) object_story_id / effective_object_story_id → só se prefixo = IG account ID
          const adsetIgIdMap = new Map<string, string>() // adsetId → ig native media ID
          await Promise.all(
            etapa1AdsetIds.map(async (adsetId) => {
              try {
                const adsUrl = new URL(`${META_BASE}/${adsetId}/ads`)
                adsUrl.searchParams.set('fields',       'id,creative{instagram_post_id,instagram_permalink_url,object_story_id,effective_object_story_id}')
                adsUrl.searchParams.set('access_token', accessToken)
                adsUrl.searchParams.set('limit',        '10')
                const adsBody = await (await fetch(adsUrl.toString())).json() as any
                for (const ad of (adsBody.data ?? [])) {
                  const creative = (ad.creative as any) ?? {}
                  let igMediaId: string | undefined

                  // a) instagram_post_id → ID nativo do IG diretamente
                  if (creative.instagram_post_id) {
                    igMediaId = String(creative.instagram_post_id)
                  }

                  // b) permalink → shortcode decode
                  if (!igMediaId) {
                    const plUrl = creative.instagram_permalink_url as string | undefined
                    if (plUrl) {
                      const m = plUrl.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)\/?/)
                      if (m) igMediaId = instagramShortcodeToMediaId(m[2]) || undefined
                    }
                  }

                  // c) object_story_id / effective_object_story_id
                  //    Só usa se começar com o IG account ID (descarta FB Page ID prefix)
                  if (!igMediaId) {
                    const storyId = (creative.object_story_id ?? creative.effective_object_story_id) as string | undefined
                    if (storyId?.startsWith(ETAPA1_IG_ACCOUNT + '_')) {
                      igMediaId = storyId.split('_')[1]
                    }
                  }

                  if (igMediaId) { adsetIgIdMap.set(adsetId, igMediaId); break }
                }
              } catch { /* skip */ }
            })
          )

          // Fallback: adsets ainda sem IG media ID → match por legenda
          // Mesmo método do Instagram Gestor: lista posts da conta IG e compara
          // o nome do adset com a legenda do post (funciona para posts de Página FB
          // impulsionados no IG, onde o creative não tem instagram_post_id)
          const unmappedIds = etapa1AdsetIds.filter(id => !adsetIgIdMap.has(id))
          if (unmappedIds.length > 0) {
            try {
              const igListUrl = new URL(`https://graph.facebook.com/v22.0/${ETAPA1_IG_ACCOUNT}/media`)
              igListUrl.searchParams.set('fields',       'id,permalink,caption')
              igListUrl.searchParams.set('limit',        '100')
              igListUrl.searchParams.set('access_token', accessToken)
              const igPosts: { id: string; permalink: string; caption?: string }[] =
                ((await (await fetch(igListUrl.toString())).json() as any).data ?? [])

              for (const adsetId of unmappedIds) {
                // Extrai palavras-chave do nome do adset:
                // "Post: Nervos Cranianos" → ["nervos", "cranianos"]
                // "Post do Instagram: A Cirurgia Bucomaxilofacial é..." → ["cirurgia", "bucomaxilofacial"]
                const adsetRow   = adsetInsightsData.find((r: any) => r.adset_id === adsetId)
                const adsetName  = (adsetRow?.adset_name as string ?? '').toLowerCase()
                const cleanName  = adsetName
                  .replace(/^post do instagram:\s*/i, '')
                  .replace(/^post:\s*/i, '')
                  .replace(/\[.*?\]/g, '')   // remove [brackets]
                  .replace(/\.\.\.$/, '')     // remove trailing ...
                  .trim()
                const keywords   = cleanName.split(/\s+/).filter(w => w.length > 3)
                if (keywords.length === 0) continue

                const match = igPosts.find(p => {
                  const cap = (p.caption ?? '').toLowerCase()
                  return keywords.every(kw => cap.includes(kw))
                })
                if (match) adsetIgIdMap.set(adsetId, match.id)
              }
            } catch { /* fallback failed */ }
          }

          // 2. Busca follows para cada IG media ID único
          const uniqueIgIds = new Set<string>(adsetIgIdMap.values())
          const followsByIgId = new Map<string, number>()
          await Promise.all(
            [...uniqueIgIds].map(async (igId) => {
              try {
                const iUrl = new URL(`https://graph.facebook.com/v22.0/${igId}/insights`)
                iUrl.searchParams.set('metric',       'follows')
                iUrl.searchParams.set('access_token', accessToken)
                const iBody = await (await fetch(iUrl.toString())).json() as any
                followsByIgId.set(igId, Number(iBody.data?.find((d: any) => d.name === 'follows')?.values?.[0]?.value ?? 0))
              } catch { followsByIgId.set(igId, 0) }
            })
          )

          // 3. Mapa final: adsetId → follows
          for (const [adsetId, igId] of adsetIgIdMap) {
            adsetFollowsMap.set(adsetId, followsByIgId.get(igId) ?? 0)
          }
        }
      } catch (e) {
        console.error('etapa1 follows lookup error:', (e as Error).message)
      }
    }

    // Insights de anúncios agrupados por adsetId
    const adsByAdset = new Map<string, any[]>()
    for (const ad of adInsightsData) {
      if (!matchesFilter(ad.campaign_name as string, filter)) continue
      const list = adsByAdset.get(ad.adset_id as string) ?? []
      list.push(ad)
      adsByAdset.set(ad.adset_id as string, list)
    }

    // Monta resposta agrupada por campanha
    const campaignMap = new Map<string, CampaignRow>()

    for (const row of adsetInsightsData) {
      if (!matchesFilter(row.campaign_name as string, filter)) continue

      const spend  = Number(row.spend ?? 0)
      const budget = budgetMap.get(row.adset_id as string) ?? { daily: null, lifetime: null, status: 'UNKNOWN', audienceName: null }

      const adsetRow: AdsetRow = {
        adsetId:        row.adset_id,
        adsetName:      row.adset_name,
        adsetStatus:    budget.status ?? 'UNKNOWN',
        audienceName:   budget.audienceName ?? null,
        dailyBudget:    budget.daily,
        lifetimeBudget: budget.lifetime,
        spend,
        ads: (adsByAdset.get(row.adset_id as string) ?? []).map((ad: any): AdRow => {
          const adSpend   = Number(ad.spend ?? 0)
          let adResults: number
          if (isVideo) {
            adResults = 0
          } else if (view === 'etapa1') {
            // follows é métrica de post, não de anúncio individual
            adResults = 0
          } else {
            const adResTypes = adsetResultTypes.get(ad.adset_id as string) ?? ['lead']
            adResults = actionVal(ad.actions, ...adResTypes)
          }
          return {
            adId:          ad.ad_id,
            adName:        ad.ad_name,
            spend:         adSpend,
            results:       adResults,
            costPerResult: adResults > 0 ? adSpend / adResults : 0,
          }
        }),
      }

      if (isVideo) {
        adsetRow.videoViews3s    = Number(row.video_thruplay_watched_actions?.[0]?.value ?? 0)
        adsetRow.videoViews25pct = Number(row.video_p25_watched_actions?.[0]?.value ?? 0)
      } else if (view === 'etapa1') {
        // Seguidores: tenta vários action types da Marketing API (sem permissões extras)
        // 'follow'         → seguidores de página/perfil
        // 'profile_visit'  → visitas ao perfil do Instagram (Posts Impulsionados via app)
        // Fallback: pipeline Instagram Graph API via adsetFollowsMap
        const followsFromActions = actionVal(row.actions        as any, 'follow', 'profile_visit')
        const followsFromUnique  = actionVal((row as any).unique_actions, 'follow', 'profile_visit')
        const followsFromApi     = adsetFollowsMap.get(row.adset_id as string) ?? 0
        const follows            = followsFromActions > 0 ? followsFromActions
                                 : followsFromUnique  > 0 ? followsFromUnique
                                 : followsFromApi
        adsetRow.results       = follows
        adsetRow.costPerResult = follows > 0 ? spend / follows : 0
      } else {
        const rowResTypes      = adsetResultTypes.get(row.adset_id as string) ?? ['lead']
        const results          = actionVal(row.actions, ...rowResTypes)
        const landingPageViews = actionVal(row.actions, 'landing_page_view')
        adsetRow.results       = results
        adsetRow.costPerResult = results > 0 ? spend / results : 0
        if (isLead) {
          adsetRow.landingPageViews = landingPageViews
          adsetRow.conversionRate   = landingPageViews > 0 ? (results / landingPageViews) * 100 : 0
        }
      }

      const cid = row.campaign_id as string
      if (!campaignMap.has(cid)) {
        campaignMap.set(cid, { campaignId: cid, campaignName: row.campaign_name, adsets: [] })
      }
      campaignMap.get(cid)!.adsets.push(adsetRow)
    }

    // Modo allcampaigns: lista todos os nomes únicos de campanhas (sem filtro) para diagnóstico de filtros
    if (req.query.allcampaigns === 'true') {
      const campaignNames = [...new Set(adsetInsightsData.map((r: any) => r.campaign_name as string))].sort()
      return res.json({ allCampaignNames: campaignNames, total: campaignNames.length, dateRange: { since, until } })
    }

    // Modo debug: retorna todos os action_types distintos para identificar conversões customizadas
    if (req.query.debug === 'true') {
      const actionTypeSummary: Record<string, number> = {}
      for (const row of adsetInsightsData) {
        if (!matchesFilter(row.campaign_name as string, filter)) continue
        for (const action of (row.actions ?? []) as { action_type: string; value: string }[]) {
          actionTypeSummary[action.action_type] = (actionTypeSummary[action.action_type] ?? 0) + Number(action.value)
        }
      }      // Compara métricas candidatas por campanha para etapa1
      const uniqueClicksPerCampaign: Record<string, number> = {}
      const outboundClicksPerCampaign: Record<string, number> = {}
      for (const row of adsetInsightsData) {
        if (!matchesFilter(row.campaign_name as string, filter)) continue
        const c = row.campaign_name as string
        uniqueClicksPerCampaign[c]   = (uniqueClicksPerCampaign[c] ?? 0)   + actionVal(row.unique_actions, 'link_click')
        outboundClicksPerCampaign[c] = (outboundClicksPerCampaign[c] ?? 0) + actionVal(row.outbound_clicks, 'outbound_click')
      }      // Mostra promoted_object e resultTypes por adset para diagnóstico
      const adsetDebug: Record<string, unknown> = {}
      for (const s of adsetsData) {
        const adsetInsightRow = adsetInsightsData.find((r: any) => r.adset_id === s.id)
        if (!adsetInsightRow) continue
        if (!matchesFilter(adsetInsightRow.campaign_name as string, filter)) continue
        adsetDebug[s.id] = {
          campaign:          adsetInsightRow.campaign_name,
          optimization_goal: s.optimization_goal,
          promoted_object:   s.promoted_object,
          customConvId:      customConvByEvent.get((s.promoted_object?.custom_event_str ?? '').toLowerCase()),
          resultTypes:       adsetResultTypes.get(s.id as string),
        }
      }
      return res.json({
        debug: true,
        actionTypes: actionTypeSummary,
        uniqueClicksPerCampaign,
        outboundClicksPerCampaign,
        adsets: adsetDebug,
        customConversions: customConvsData.map((cc: any) => ({
          id: cc.id, name: cc.name, rule: cc.rule,
        })),
        dateRange: { since, until },
      })
    }

    return res.json({
      view,
      campaigns: [...campaignMap.values()],
      dateRange:  { since, until },
    })
  } catch (err: any) {
    console.error('perpetuo-data error:', err)
    return res.status(500).json({ error: err.message ?? 'Erro interno' })
  }
}
