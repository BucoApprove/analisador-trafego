import { useState, useEffect, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, RefreshCw, ChevronDown, Trophy } from 'lucide-react'

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

interface PerpetuoResponse {
  view: string
  campaigns: CampaignRow[]
  dateRange: { since: string; until: string }
}

// ─── Nav config ───────────────────────────────────────────────────────────────

// CONTA1_VIEWS preserved for reference — navigation is now handled by STAGE_CONFIG
// const CONTA1_VIEWS = [ ... ]

const CONTA2_VIEWS = [
  { id: 'anatomia',           label: 'Pós-Grad. Anatomia'  },
  { id: 'patologia',          label: 'Pós-Grad. Patologia' },
  { id: 'lowticket-brasil',   label: 'Low Ticket Brasil'   },
  { id: 'lowticket-latam',    label: 'Low Ticket Latam'    },
]

// ─── Stage card config (conta1 only) ─────────────────────────────────────────

const STAGE_CONFIG = [
  {
    id: 'etapa1', label: 'Descoberta', icon: '📸',
    bg:        'bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-950/50 dark:to-blue-900/50',
    activeBg:  'from-blue-200 to-blue-300 dark:from-blue-900/70 dark:to-blue-800/70',
    labelCls:  'text-blue-700 dark:text-blue-400',
    arrowHex:  '#93c5fd',
    metricLabel: (results: number) => `${fmt(results)} seguidor${results !== 1 ? 'es' : ''}`,
    subLabel:  'CPS médio',
    isVideo:   false,
  },
  {
    id: 'etapa2', label: 'Captura', icon: '🎯',
    bg:        'bg-gradient-to-br from-purple-100 to-purple-200 dark:from-purple-950/50 dark:to-purple-900/50',
    activeBg:  'from-purple-200 to-purple-300 dark:from-purple-900/70 dark:to-purple-800/70',
    labelCls:  'text-purple-700 dark:text-purple-400',
    arrowHex:  '#c4b5fd',
    metricLabel: (results: number) => `${fmt(results)} lead${results !== 1 ? 's' : ''}`,
    subLabel:  'CPL médio',
    isVideo:   false,
  },
  {
    id: 'etapa3', label: 'Relacionamento', icon: '🤝',
    bg:        'bg-gradient-to-br from-yellow-100 to-amber-200 dark:from-yellow-950/50 dark:to-amber-900/50',
    activeBg:  'from-yellow-200 to-amber-300 dark:from-yellow-900/70 dark:to-amber-800/70',
    labelCls:  'text-yellow-800 dark:text-yellow-400',
    arrowHex:  '#fde68a',
    metricLabel: (results: number) => `${fmt(results)} reprod.`,
    subLabel:  'Views 25%',
    isVideo:   true,
  },
  {
    id: 'etapa4', label: 'Conversão', icon: '💰',
    bg:        'bg-gradient-to-br from-orange-100 to-orange-200 dark:from-orange-950/50 dark:to-orange-900/50',
    activeBg:  'from-orange-200 to-orange-300 dark:from-orange-900/70 dark:to-orange-800/70',
    labelCls:  'text-orange-700 dark:text-orange-400',
    arrowHex:  '#fdba74',
    metricLabel: (results: number) => `${fmt(results)} resultado${results !== 1 ? 's' : ''}`,
    subLabel:  'CPA médio',
    isVideo:   false,
  },
  {
    id: 'etapa5', label: 'Remarketing', icon: '🔁',
    bg:        'bg-gradient-to-br from-pink-100 to-pink-200 dark:from-pink-950/50 dark:to-pink-900/50',
    activeBg:  'from-pink-200 to-pink-300 dark:from-pink-900/70 dark:to-pink-800/70',
    labelCls:  'text-pink-700 dark:text-pink-400',
    arrowHex:  '#f9a8d4',
    metricLabel: (results: number) => `${fmt(results)} lead${results !== 1 ? 's' : ''}`,
    subLabel:  'CPL médio',
    isVideo:   false,
  },
] as const

// ─── Helpers ──────────────────────────────────────────────────────────────────

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
}

function fmt(v: number) {
  return v.toLocaleString('pt-BR')
}

function pct(v: number) {
  return `${v.toFixed(1)}%`
}

function todayIso() {
  return new Date().toISOString().split('T')[0]
}

function firstOfMonthIso() {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().split('T')[0]
}

// ─── Budget cell ──────────────────────────────────────────────────────────────

function BudgetCell({ daily, lifetime }: { daily: number | null; lifetime: number | null }) {
  if (daily != null)    return <span>{brl(daily)}<span className="text-muted-foreground text-xs ml-0.5">/dia</span></span>
  if (lifetime != null) return <span>{brl(lifetime)}<span className="text-muted-foreground text-xs ml-0.5"> total</span></span>
  return <span className="text-muted-foreground">—</span>
}

// Campanhas com esses prefixos são de lançamento (BA25, PPT-BA, etc.)
const LANCAMENTO_KEYWORDS = ['ba25', 'ppt-ba', 'ba 25']
function isLancamento(name: string): boolean {
  const lower = name.toLowerCase()
  return LANCAMENTO_KEYWORDS.some(kw => lower.includes(kw))
}

// ─── Sales drilldown types (from launch-sales-utms API) ──────────────────────

interface SalesDrilldownItem {
  source: string
  campaign: string
  medium: string
  content: string
  count: number
}

interface SalesData {
  totalBuyers: number
  since: string
  until: string
  drilldown: SalesDrilldownItem[]
}

// ─── CampaignCard — accordion visual ─────────────────────────────────────────

function CampaignCard({
  campaign,
  isVideo,
  isLead,
  isRmkt,
  isFollower,
  onlyActive,
  resultLabel,
  cprLabel,
}: {
  campaign: CampaignRow
  isVideo: boolean
  isLead: boolean
  isRmkt: boolean
  isFollower: boolean
  onlyActive: boolean
  resultLabel: string
  cprLabel: string
}) {
  const [open, setOpen] = useState(false)
  const [openAdsets, setOpenAdsets] = useState<Set<string>>(new Set())

  const visibleAdsets = onlyActive
    ? campaign.adsets.filter(a => a.adsetStatus === 'ACTIVE')
    : campaign.adsets

  if (visibleAdsets.length === 0) return null

  // Totais da campanha
  const totSpend   = visibleAdsets.reduce((s, a) => s + a.spend, 0)
  const totResults = visibleAdsets.reduce((s, a) => s + (isVideo ? (a.videoViews3s ?? 0) : (a.results ?? 0)), 0)
  const cpr        = totResults > 0 ? totSpend / totResults : 0
  const hasActive  = visibleAdsets.some(a => a.adsetStatus === 'ACTIVE')

  function toggleAdset(id: string) {
    setOpenAdsets(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
      {/* ── Campaign header ── */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/40 transition-colors text-left"
      >
        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${hasActive ? 'bg-emerald-500 shadow-[0_0_0_3px_#d1fae5]' : 'bg-muted-foreground/40'}`} />
        <span className="flex-1 font-semibold text-sm truncate">{campaign.campaignName}</span>
        <div className="hidden sm:flex items-center gap-6 shrink-0">
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Investido</p>
            <p className="text-sm font-bold">{brl(totSpend)}</p>
          </div>
          {!isVideo && (
            <>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">{resultLabel}</p>
                <p className="text-sm font-bold">{fmt(totResults)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">{cprLabel}</p>
                <p className="text-sm font-bold">{cpr > 0 ? brl(cpr) : '—'}</p>
              </div>
            </>
          )}
          {isVideo && (
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Views ≥3s</p>
              <p className="text-sm font-bold">{fmt(totResults)}</p>
            </div>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* ── Adsets (accordion body) ── */}
      {open && (
        <div className="bg-muted/30 border-t border-border divide-y divide-border">
          {visibleAdsets.map(adset => {
            const isPaused   = adset.adsetStatus !== 'ACTIVE'
            const displayName = isRmkt && adset.audienceName ? adset.audienceName : adset.adsetName
            const adsetOpen  = openAdsets.has(adset.adsetId)
            const hasAds     = !isVideo && adset.ads.length > 0
            const adsetResults = isVideo ? (adset.videoViews3s ?? 0) : (adset.results ?? 0)
            const adsetCpr     = adsetResults > 0 ? adset.spend / adsetResults : 0

            return (
              <div key={adset.adsetId} className={isPaused ? 'opacity-40' : ''}>
                {/* adset row */}
                <div
                  className={`flex items-center gap-3 px-5 py-3 ${hasAds ? 'cursor-pointer hover:bg-muted/50' : ''} transition-colors`}
                  onClick={() => hasAds && toggleAdset(adset.adsetId)}
                >
                  <span className={`h-2 w-2 rounded-full shrink-0 ${isPaused ? 'bg-muted-foreground/30' : 'bg-emerald-400'}`} />
                  <span className="flex-1 text-sm font-medium truncate">
                    {displayName}
                    {isPaused && <span className="ml-2 text-xs font-normal text-muted-foreground">(pausado)</span>}
                  </span>
                  <div className="hidden sm:flex items-center gap-5 text-right shrink-0">
                    <div>
                      <p className="text-[10px] text-muted-foreground">Orçamento</p>
                      <p className="text-xs font-semibold"><BudgetCell daily={adset.dailyBudget} lifetime={adset.lifetimeBudget} /></p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Investido</p>
                      <p className="text-xs font-semibold">{brl(adset.spend)}</p>
                    </div>
                    {!isVideo && (
                      <>
                        <div>
                          <p className="text-[10px] text-muted-foreground">{resultLabel}</p>
                          <p className="text-xs font-semibold">{fmt(adsetResults)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">{cprLabel}</p>
                          <p className="text-xs font-semibold">{adsetCpr > 0 ? brl(adsetCpr) : '—'}</p>
                        </div>
                        {isLead && (
                          <div>
                            <p className="text-[10px] text-muted-foreground">Conv. Pág.</p>
                            <p className="text-xs font-semibold">{(adset.landingPageViews ?? 0) > 0 ? pct(adset.conversionRate ?? 0) : '—'}</p>
                          </div>
                        )}
                      </>
                    )}
                    {isVideo && (
                      <div>
                        <p className="text-[10px] text-muted-foreground">Views 25%</p>
                        <p className="text-xs font-semibold">{fmt(adset.videoViews25pct ?? 0)}</p>
                      </div>
                    )}
                  </div>
                  {hasAds && (
                    <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${adsetOpen ? 'rotate-180' : ''}`} />
                  )}
                </div>

                {/* ad rows */}
                {hasAds && adsetOpen && (
                  <div className="bg-background/60 border-t border-border divide-y divide-border/60">
                    {adset.ads.map((ad, i) => {
                      const isTop = i === 0 && ad.results > 0
                      const maxRes = adset.ads[0]?.results ?? 1
                      const barPct = maxRes > 0 ? (ad.results / maxRes) * 100 : 0
                      return (
                        <div key={ad.adId} className={`flex items-center gap-3 px-7 py-2.5 ${ad.results === 0 ? 'opacity-40' : ''}`}>
                          <span className="w-5 shrink-0 text-sm">
                            {isTop ? <Trophy className="h-3.5 w-3.5 text-amber-500" /> : <span className="opacity-0"><Trophy className="h-3.5 w-3.5" /></span>}
                          </span>
                          <span className="w-40 shrink-0 text-xs text-muted-foreground truncate">{ad.adName}</span>
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-40">
                            <div
                              className={`h-full rounded-full ${isTop ? 'bg-amber-400' : 'bg-primary/60'}`}
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                          <span className="text-xs font-semibold w-20 text-right shrink-0">{fmt(ad.results)} {isFollower ? 'seg.' : 'leads'}</span>
                          <span className="text-xs text-muted-foreground w-16 text-right shrink-0">
                            {ad.results > 0 ? brl(ad.costPerResult) : '—'}
                          </span>
                          <span className="text-xs text-muted-foreground w-16 text-right shrink-0">{brl(ad.spend)}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Top Criativos por Vendas ─────────────────────────────────────────────────

function TopCreativesByConversion({ token, since, until }: { token: string; since: string; until: string }) {
  const [data, setData]       = useState<SalesData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [open, setOpen]       = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ since, until })
      const res  = await fetch(`/api/launch-sales-utms?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erro ao carregar vendas')
      setData(json)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // top 15 por utm_content (criativo)
  const topCreatives = data?.drilldown
    .reduce<{ content: string; campaign: string; count: number }[]>((acc, d) => {
      const key = d.content || '(sem utm_content)'
      const existing = acc.find(x => x.content === key)
      if (existing) {
        existing.count += d.count
        if (!existing.campaign && d.campaign) existing.campaign = d.campaign
      } else {
        acc.push({ content: key, campaign: d.campaign || '', count: d.count })
      }
      return acc
    }, [])
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)

  const maxCount = topCreatives?.[0]?.count ?? 1

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
      <button
        onClick={() => { setOpen(v => !v); if (!open && !data && !loading) load() }}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/40 transition-colors text-left"
      >
        <Trophy className="h-4 w-4 text-amber-500 shrink-0" />
        <span className="flex-1 font-semibold text-sm">Top Criativos por Vendas</span>
        <span className="text-xs text-muted-foreground">Cruzamento UTM × Vendas</span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-border px-5 py-4">
          {loading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {data && topCreatives && (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground">
                  Total de compradores no período: <strong className="text-foreground">{fmt(data.totalBuyers)}</strong>
                </p>
                <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" /> Atualizar
                </Button>
              </div>
              {topCreatives.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">Sem dados de UTM para o período.</p>
              )}
              {topCreatives.map((c, i) => {
                const barPct = (c.count / maxCount) * 100
                const isTop  = i === 0
                return (
                  <div key={c.content} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${isTop ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800' : 'bg-muted/30'}`}>
                    <span className="w-5 shrink-0 text-sm font-bold text-muted-foreground">{isTop ? '🏆' : `${i + 1}`}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{c.content}</p>
                      {c.campaign && <p className="text-[10px] text-muted-foreground truncate">{c.campaign}</p>}
                    </div>
                    <div className="w-32 h-2 bg-muted rounded-full overflow-hidden shrink-0">
                      <div
                        className={`h-full rounded-full ${isTop ? 'bg-amber-400' : 'bg-primary/70'}`}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold w-16 text-right shrink-0">{c.count} venda{c.count !== 1 ? 's' : ''}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


// ─── Tab principal ────────────────────────────────────────────────────────────

interface TabPerpetuoProps {
  token: string
  enabled: boolean
}

// Cache global (sobrevive re-renders, limpo apenas pelo botão Atualizar)
type CacheEntry = { data: PerpetuoResponse; fetchedAt: Date }
const _cache: Map<string, CacheEntry> = new Map()

export default function TabPerpetuo({ token, enabled }: TabPerpetuoProps) {
  const [account, setAccount] = useState<'conta1' | 'conta2'>('conta1')
  const [view, setView]       = useState('etapa2')
  const [since, setSince]     = useState(firstOfMonthIso)
  const [until, setUntil]     = useState(todayIso)
  const [data, setData]       = useState<PerpetuoResponse | null>(null)
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [onlyActive, setOnlyActive] = useState(true)

  // Rastreia quais chaves já foram buscadas nesta sessão
  const fetchedKeys = useRef<Set<string>>(new Set())

  const isVideo      = view === 'etapa3'
  const isLead       = view === 'etapa2' || view === 'anatomia' || view === 'patologia'
  const isFollower   = view === 'etapa1'

  function cacheKey() {
    return `${account}|${view}|${since}|${until}`
  }

  async function loadData(force = false) {
    const key = cacheKey()
    if (!force) {
      const cached = _cache.get(key)
      if (cached) {
        setData(cached.data)
        setFetchedAt(cached.fetchedAt)
        return
      }
    }
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ account, view, since, until })
      const res = await fetch(`/api/perpetuo-data?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erro ao carregar dados')
      const now = new Date()
      _cache.set(key, { data: json, fetchedAt: now })
      fetchedKeys.current.add(key)
      setData(json)
      setFetchedAt(now)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Carrega ao ativar a aba pela primeira vez ou trocar view/conta/período
  useEffect(() => {
    if (!enabled) return
    const key = cacheKey()
    const cached = _cache.get(key)
    if (cached) {
      setData(cached.data)
      setFetchedAt(cached.fetchedAt)
    } else {
      loadData()
    }
  }, [enabled, account, view]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleAccountChange(acc: 'conta1' | 'conta2') {
    setAccount(acc)
    setView(acc === 'conta1' ? 'etapa2' : 'anatomia')
  }

  function handleViewChange(v: string) {
    setView(v)
  }

  // Totais consolidados para o sumário rápido
  const totals = data?.campaigns.reduce(
    (acc, c) => {
      for (const adset of c.adsets) {
        acc.spend   += adset.spend
        acc.results += adset.results ?? 0
      }
      return acc
    },
    { spend: 0, results: 0 },
  )
  const resultLabel = isFollower ? 'Seguidores' : 'Resultados'
  const cprLabel    = isFollower ? 'CPS' : 'CPR'

  return (
    <div className="space-y-5">

      {/* ── Linha superior: contas + toggle + período ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={account === 'conta1' ? 'default' : 'outline'}
          onClick={() => handleAccountChange('conta1')}
        >
          GBS Launch
        </Button>
        <Button
          size="sm"
          variant={account === 'conta2' ? 'default' : 'outline'}
          onClick={() => handleAccountChange('conta2')}
        >
          GBS Pós-grad
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => setOnlyActive(v => !v)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${onlyActive ? 'bg-primary' : 'bg-muted-foreground/40'}`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${onlyActive ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
          <span className="text-sm text-muted-foreground mr-3">
            {onlyActive ? 'Somente ativos' : 'Todos (incl. pausados)'}
          </span>
          <Input
            type="date"
            value={since}
            onChange={e => setSince(e.target.value)}
            className="w-36 h-8 text-sm"
          />
          <span className="text-muted-foreground text-sm">até</span>
          <Input
            type="date"
            value={until}
            onChange={e => setUntil(e.target.value)}
            className="w-36 h-8 text-sm"
          />
          <Button onClick={() => loadData(true)} disabled={loading} size="sm">
            {loading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <RefreshCw className="h-4 w-4" />
            }
            <span className="ml-1.5">Atualizar</span>
          </Button>
        </div>
      </div>

      {/* ── Stage cards (conta1) / botões produto (conta2) ── */}
      {account === 'conta1' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 pb-2">
          {STAGE_CONFIG.map(stage => {
            const cacheKey = `conta1|${stage.id}|${since}|${until}`
            const cached   = _cache.get(cacheKey)
            const isActive = view === stage.id
            let spend = 0; let results = 0; let video25 = 0; let hasData = false
            if (cached) {
              hasData = true
              for (const c of cached.data.campaigns) {
                for (const a of c.adsets) {
                  spend   += a.spend
                  results += stage.isVideo ? (a.videoViews3s ?? 0) : (a.results ?? 0)
                  video25 += a.videoViews25pct ?? 0
                }
              }
            }
            const cpr = results > 0 ? spend / results : 0
            return (
              <button
                key={stage.id}
                onClick={() => handleViewChange(stage.id)}
                className={`relative rounded-2xl p-4 text-left transition-all duration-200 ${stage.bg} ${
                  isActive
                    ? 'ring-2 ring-black/20 dark:ring-white/20 shadow-xl -translate-y-1'
                    : 'hover:-translate-y-1 hover:shadow-lg'
                }`}
              >
                <span className="text-2xl mb-2 block">{stage.icon}</span>
                <div className={`text-[10px] font-extrabold uppercase tracking-widest mb-3 ${stage.labelCls}`}>
                  {stage.label}
                </div>
                {hasData ? (
                  <>
                    <div className="text-lg font-extrabold text-foreground leading-tight">{brl(spend)}</div>
                    <div className="text-[11px] text-muted-foreground mb-1.5">Total investido</div>
                    <div className="text-xs font-bold text-foreground">
                      {stage.isVideo
                        ? `${fmt(video25)} views 25%`
                        : cpr > 0
                          ? `${stage.subLabel} ${brl(cpr)}`
                          : stage.metricLabel(results)
                      }
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-lg font-extrabold text-foreground/25">—</div>
                    <div className="text-[11px] text-muted-foreground mb-1.5">Total investido</div>
                    <div className="text-xs text-muted-foreground/50">Clique para carregar</div>
                  </>
                )}
                {isActive && (
                  <div
                    className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 w-0 h-0"
                    style={{
                      borderLeft: '11px solid transparent',
                      borderRight: '11px solid transparent',
                      borderTop: `14px solid ${stage.arrowHex}`,
                    }}
                  />
                )}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {CONTA2_VIEWS.map(v => (
            <Button
              key={v.id}
              size="sm"
              variant={view === v.id ? 'default' : 'outline'}
              onClick={() => handleViewChange(v.id)}
            >
              {v.label}
            </Button>
          ))}
        </div>
      )}

      {/* ── Timestamp última atualização ── */}
      {fetchedAt && !loading && (
        <p className="text-xs text-muted-foreground -mt-2">
          Dados carregados às {fetchedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </p>
      )}

      {/* ── Erro ── */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* ── Sumário rápido (apenas conta2 — conta1 usa stage cards) ── */}
      {!loading && data && totals && !isVideo && account === 'conta2' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground mb-1">Total Investido</p>
              <p className="text-xl font-bold">{brl(totals.spend)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground mb-1">Total {resultLabel}</p>
              <p className="text-xl font-bold">{fmt(totals.results)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground mb-1">{cprLabel} Médio</p>
              <p className="text-xl font-bold">
                {totals.results > 0 ? brl(totals.spend / totals.results) : '—'}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Campanhas ── */}
      {!loading && data && (() => {
        const campaigns = data.campaigns
        const isCaptura = view === 'etapa2'
        const isRmkt    = view === 'etapa5'
        const sharedProps = { isVideo, isLead, isFollower, onlyActive, resultLabel, cprLabel }
        if (!isCaptura) {
          return (
            <div className="space-y-3">
              {campaigns.map(c => (
                <CampaignCard key={c.campaignId} campaign={c} isRmkt={isRmkt} {...sharedProps} />
              ))}
            </div>
          )
        }
        const perpetuo   = campaigns.filter(c => !isLancamento(c.campaignName))
        const lancamento = campaigns.filter(c =>  isLancamento(c.campaignName))
        return (
          <div className="space-y-6">
            {perpetuo.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-bold tracking-widest uppercase text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/40 rounded-full px-3 py-1">Perpétuo</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                {perpetuo.map(c => (
                  <CampaignCard key={c.campaignId} campaign={c} isRmkt={false} {...sharedProps} />
                ))}
              </div>
            )}
            {lancamento.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-bold tracking-widest uppercase text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/40 rounded-full px-3 py-1">Lançamento</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                {lancamento.map(c => (
                  <CampaignCard key={c.campaignId} campaign={c} isRmkt={false} {...sharedProps} />
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Top Criativos por Vendas (apenas conta1, não-video) ── */}
      {!loading && account === 'conta1' && !isVideo && (
        <div className="pt-2">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Análise de Vendas</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <TopCreativesByConversion token={token} since={since} until={until} />
        </div>
      )}

      {/* ── Vazio ── */}
      {!loading && data && data.campaigns.length === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          Nenhuma campanha encontrada para este período e filtro.
        </div>
      )}
    </div>
  )
}
