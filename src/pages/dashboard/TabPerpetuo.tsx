import { useState, useEffect, useRef, Fragment } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, RefreshCw } from 'lucide-react'

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

const CONTA1_VIEWS = [
  { id: 'etapa1', label: 'Posts Impulsionados' },
  { id: 'etapa2', label: 'Captura' },
  { id: 'etapa3', label: 'Relacionamento' },
  { id: 'etapa4', label: 'Conversão' },
  { id: 'etapa5', label: 'Remarketing' },
]

const CONTA2_VIEWS = [
  { id: 'anatomia',           label: 'Pós-Grad. Anatomia'  },
  { id: 'patologia',          label: 'Pós-Grad. Patologia' },
  { id: 'lowticket-brasil',   label: 'Low Ticket Brasil'   },
  { id: 'lowticket-latam',    label: 'Low Ticket Latam'    },
]

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

// ─── Table ────────────────────────────────────────────────────────────────────

function CampaignTable({
  campaign,
  isVideo,
  isLead,
  isRmkt,
  onlyActive,
}: {
  campaign: CampaignRow
  isVideo: boolean
  isLead: boolean
  isRmkt: boolean
  onlyActive: boolean
}) {
  const visibleAdsets = onlyActive
    ? campaign.adsets.filter(a => a.adsetStatus === 'ACTIVE')
    : campaign.adsets

  if (visibleAdsets.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">{campaign.campaignName}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground text-xs">
                <th className="pb-2 font-medium text-left pr-6">{isRmkt ? 'Público / Anúncio' : 'Conjunto / Anúncio'}</th>
                <th className="pb-2 font-medium text-right pr-6">Orçamento</th>
                <th className="pb-2 font-medium text-right pr-6">Investido</th>
                {isVideo ? (
                  <>
                    <th className="pb-2 font-medium text-right pr-6">Views ≥3s</th>
                    <th className="pb-2 font-medium text-right">Views 25%</th>
                  </>
                ) : (
                  <>
                    <th className="pb-2 font-medium text-right pr-6">Resultados</th>
                    <th className="pb-2 font-medium text-right pr-6">CPR</th>
                    {isLead && <th className="pb-2 font-medium text-right">Conv. Página</th>}
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {visibleAdsets.map(adset => {
                const displayName = isRmkt && adset.audienceName ? adset.audienceName : adset.adsetName
                const isPaused = adset.adsetStatus !== 'ACTIVE'
                return (
                  <Fragment key={adset.adsetId}>
                    {/* Adset row */}
                    <tr className={`border-b bg-muted/30 ${isPaused ? 'opacity-50' : ''}`}>
                      <td className="py-2 pr-6 font-medium">
                        {displayName}
                        {isPaused && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">(pausado)</span>
                        )}
                      </td>
                      <td className="py-2 pr-6 text-right">
                        <BudgetCell daily={adset.dailyBudget} lifetime={adset.lifetimeBudget} />
                      </td>
                      <td className="py-2 pr-6 text-right">{brl(adset.spend)}</td>
                      {isVideo ? (
                        <>
                          <td className="py-2 pr-6 text-right">{fmt(adset.videoViews3s ?? 0)}</td>
                          <td className="py-2 text-right">{fmt(adset.videoViews25pct ?? 0)}</td>
                        </>
                      ) : (
                        <>
                          <td className="py-2 pr-6 text-right">{fmt(adset.results ?? 0)}</td>
                          <td className="py-2 pr-6 text-right">
                            {(adset.results ?? 0) > 0 ? brl(adset.costPerResult ?? 0) : '—'}
                          </td>
                          {isLead && (
                            <td className="py-2 text-right">
                              {(adset.landingPageViews ?? 0) > 0 ? pct(adset.conversionRate ?? 0) : '—'}
                            </td>
                          )}
                        </>
                      )}
                    </tr>
                    {/* Ad rows — skip for video view */}
                    {!isVideo && adset.ads.map(ad => (
                      <tr key={ad.adId} className={`border-b hover:bg-muted/20 ${isPaused ? 'opacity-50' : ''}`}>
                        <td className="py-1.5 pr-6 pl-6 text-muted-foreground">
                          <span className="mr-1 opacity-50">↳</span>{ad.adName}
                        </td>
                        <td className="py-1.5 pr-6 text-right text-muted-foreground">—</td>
                        <td className="py-1.5 pr-6 text-right text-muted-foreground">{brl(ad.spend)}</td>
                        <td className="py-1.5 pr-6 text-right text-muted-foreground">{fmt(ad.results)}</td>
                        <td className="py-1.5 pr-6 text-right text-muted-foreground">
                          {ad.results > 0 ? brl(ad.costPerResult) : '—'}
                        </td>
                        {isLead && <td className="py-1.5 text-right text-muted-foreground">—</td>}
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
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

  const currentViews = account === 'conta1' ? CONTA1_VIEWS : CONTA2_VIEWS
  const isVideo      = view === 'etapa3'
  const isLead       = view === 'etapa2' || view === 'anatomia' || view === 'patologia'

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

  return (
    <div className="space-y-5">

      {/* ── Seletor de conta ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={account === 'conta1' ? 'default' : 'outline'}
          onClick={() => handleAccountChange('conta1')}
        >
          GBS Launch — Lançamentos
        </Button>
        <Button
          size="sm"
          variant={account === 'conta2' ? 'default' : 'outline'}
          onClick={() => handleAccountChange('conta2')}
        >
          GBS — Pós-graduações
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setOnlyActive(v => !v)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${onlyActive ? 'bg-primary' : 'bg-muted-foreground/40'}`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${onlyActive ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
          <span className="text-sm text-muted-foreground">
            {onlyActive ? 'Somente ativos' : 'Todos (incl. pausados)'}
          </span>
        </div>
      </div>

      {/* ── Seletor de etapa/produto + período ── */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-2">
          {currentViews.map(v => (
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
        <div className="flex items-center gap-2 ml-auto">
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

      {/* ── Sumário rápido ── */}
      {!loading && data && totals && !isVideo && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground mb-1">Total Investido</p>
              <p className="text-xl font-bold">{brl(totals.spend)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground mb-1">Total Resultados</p>
              <p className="text-xl font-bold">{fmt(totals.results)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground mb-1">CPR Médio</p>
              <p className="text-xl font-bold">
                {totals.results > 0 ? brl(totals.spend / totals.results) : '—'}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Tabelas por campanha ── */}
      {!loading && data && (() => {
        const campaigns = data.campaigns
        const isCaptura = view === 'etapa2'
        const isRmkt    = view === 'etapa5'
        if (!isCaptura) {
          return campaigns.map(c => (
            <CampaignTable key={c.campaignId} campaign={c} isVideo={isVideo} isLead={isLead} isRmkt={isRmkt} onlyActive={onlyActive} />
          ))
        }
        const perpetuo   = campaigns.filter(c => !isLancamento(c.campaignName))
        const lancamento = campaigns.filter(c =>  isLancamento(c.campaignName))
        return (
          <div className="space-y-6">
            {perpetuo.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-bold tracking-widest uppercase text-emerald-700 bg-emerald-100 rounded-full px-3 py-1">Perpétuo</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                {perpetuo.map(c => (
                  <CampaignTable key={c.campaignId} campaign={c} isVideo={isVideo} isLead={isLead} isRmkt={false} onlyActive={onlyActive} />
                ))}
              </div>
            )}
            {lancamento.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-bold tracking-widest uppercase text-blue-700 bg-blue-100 rounded-full px-3 py-1">Lançamento</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                {lancamento.map(c => (
                  <CampaignTable key={c.campaignId} campaign={c} isVideo={isVideo} isLead={isLead} isRmkt={false} onlyActive={onlyActive} />
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Vazio ── */}
      {!loading && data && data.campaigns.length === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          Nenhuma campanha encontrada para este período e filtro.
        </div>
      )}
    </div>
  )
}
