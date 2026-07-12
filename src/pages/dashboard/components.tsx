import { useState, useEffect } from 'react'
import { Loader2, AlertTriangle, RefreshCw, ChevronDown, Trophy, X, ExternalLink } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { UtmSalesAttribution, BA25ProfileEntry } from './types'

// ─── Paleta de cores ──────────────────────────────────────────────────────────
export const CHART_COLORS = ['#d4a853', '#7c9885', '#5b8fb9', '#c17c74', '#9b7cc1', '#6b8e8e']

// ─── KPI Card ─────────────────────────────────────────────────────────────────
interface KpiCardProps {
  label: string
  value: string | number
  sub?: string
  color?: string
}

export function KpiCard({ label, value, sub, color = '#d4a853' }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          {label}
        </p>
        <p className="text-3xl font-bold tracking-tight" style={{ color }}>
          {value}
        </p>
        {sub && <p className="mt-2 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}

// ─── KPIs de lançamento meteórico (Investimento/Leads/CPL/Antecipado) ─────────
// Usado no card do topo do lançamento (TabBA25) e no resumo do lançamento
// ativo no Placar (TabPlacar) — mesma fórmula, dois lugares de exibição.
export interface LancamentoLeadsKpisInput {
  totalLeads: number
  metaLeads: number
  investimento: number       // gasto captura (Meta Ads)
  receitaAntecipado: number  // líquido das vendas do produto de antecipação
  qtdVendasAntecipado: number
}

export function LancamentoLeadsKpis({ totalLeads, metaLeads, investimento, receitaAntecipado, qtdVendasAntecipado }: LancamentoLeadsKpisInput) {
  const brl2 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const cpl = totalLeads > 0 && investimento > 0 ? investimento / totalLeads : null
  const investLiquido = investimento - receitaAntecipado
  const cplReal = totalLeads > 0 && investimento > 0 ? investLiquido / totalLeads : null
  const pctMetaLeads = metaLeads > 0 ? Math.round((totalLeads / metaLeads) * 100) : null

  const stats = [
    { label: 'Investimento total', value: `R$ ${brl2(investimento)}`, color: CHART_COLORS[3], sub: 'gasto captura (Meta Ads)' },
    { label: 'Leads totais', value: totalLeads.toLocaleString('pt-BR'), color: CHART_COLORS[1], sub: metaLeads > 0 ? `meta: ${metaLeads.toLocaleString('pt-BR')}` : 'tags + UTM' },
    { label: 'Custo por lead', value: cpl != null ? `R$ ${brl2(cpl)}` : '—', color: CHART_COLORS[4], sub: 'invest ÷ leads' },
    { label: 'Vendas antecipadas', value: `R$ ${brl2(receitaAntecipado)}`, color: CHART_COLORS[0], sub: `${qtdVendasAntecipado.toLocaleString('pt-BR')} venda(s)` },
    { label: 'Custo por lead real', value: cplReal != null ? `R$ ${brl2(cplReal)}` : '—', color: cplReal != null && cplReal <= 0 ? '#7c9885' : CHART_COLORS[2], sub: 'invest líquido ÷ leads' },
    { label: '% da meta de leads', value: pctMetaLeads != null ? `${pctMetaLeads}%` : '—', color: '#7c9885', sub: 'leads ÷ meta' },
  ]

  return (
    <div className="flex flex-wrap gap-px border-b">
      {stats.map(s => (
        <div key={s.label} className="flex-1 min-w-[100px] px-4 py-2">
          <p className="text-[10px] text-muted-foreground">{s.label}</p>
          <p className="text-lg font-bold tabular-nums leading-tight" style={{ color: s.color }}>{s.value}</p>
          <p className="text-[9px] text-muted-foreground truncate">{s.sub}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Modal de prévia do anúncio (Ad Preview API) ──────────────────────────────
// Renderiza o iframe oficial que o Meta gera pra mostrar como o anúncio aparece
// no feed/Instagram — o mesmo preview que se vê dentro do Business Manager, mas
// sem precisar estar logado/ter permissão na conta de anúncios.
export function AdPreviewModal({
  adId,
  adName,
  token,
  onClose,
}: {
  adId: string
  adName: string
  token: string
  onClose: () => void
}) {
  const [html, setHtml] = useState<string | null | undefined>(undefined)
  const [postUrl, setPostUrl] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    setHtml(undefined)
    setPostUrl(null)
    fetch(`/api/meta-ad-preview?adId=${adId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => { setHtml(data?.html ?? null); setPostUrl(data?.postUrl ?? null) })
      .catch(() => setHtml(null))
  }, [adId, token])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="relative rounded-xl overflow-hidden shadow-2xl bg-card max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b">
          <p className="text-sm font-medium truncate pr-4">{adName}</p>
          <button onClick={onClose} className="shrink-0 rounded-full p-1 hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center justify-center min-h-[300px] max-h-[80vh] overflow-auto">
          {html === undefined ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : html ? (
            <div className="w-full [&_iframe]:w-full [&_iframe]:min-h-[500px] [&_iframe]:border-0" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12 px-6">Prévia não disponível para este anúncio.</p>
          )}
        </div>
        {postUrl && (
          <a
            href={postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 border-t px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Abrir post original
          </a>
        )}
      </div>
    </div>
  )
}

// ─── Tooltip de thumbnail de anúncio (hover) ──────────────────────────────────
// Componente genérico: recebe uma chave de cache e uma função de busca, para
// funcionar tanto com ad_id direto (BA25) quanto resolução por nome (Placar).
// Usa position:fixed calculado no hover para não ser cortado por overflow-hidden
// dos containers ancestrais (cards e tabelas com scroll).
// resolveAdId (opcional) permite mostrar o botão "Ver prévia" mesmo quando o
// cacheKey não é o próprio ad_id (ex.: Placar, que resolve por nome).
const _adThumbCache = new Map<string, string | null>()
const _adThumbInFlight = new Set<string>()

export function AdThumbTooltip({
  label,
  cacheKey,
  fetchThumb,
  className,
  adId,
  resolveAdId,
  token,
}: {
  label: string
  cacheKey: string | undefined
  fetchThumb: () => Promise<string | null>
  className?: string
  adId?: string
  resolveAdId?: () => Promise<string | null>
  token?: string
}) {
  const [thumb, setThumb] = useState<string | null | undefined>(() => cacheKey ? _adThumbCache.get(cacheKey) : undefined)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [resolvedAdId, setResolvedAdId] = useState<string | null | undefined>(adId)
  const [previewOpen, setPreviewOpen] = useState(false)

  function loadThumb() {
    if (!cacheKey || _adThumbCache.has(cacheKey) || _adThumbInFlight.has(cacheKey)) return
    _adThumbInFlight.add(cacheKey)
    fetchThumb()
      .then(url => { _adThumbCache.set(cacheKey, url); setThumb(url) })
      .catch(() => {})
      .finally(() => _adThumbInFlight.delete(cacheKey))
    if (resolveAdId && resolvedAdId === undefined) {
      resolveAdId().then(setResolvedAdId).catch(() => setResolvedAdId(null))
    }
  }

  const canPreview = !!(resolvedAdId && token)

  return (
    <span className="inline-flex items-center gap-1 max-w-full">
      <span
        className={className ?? 'truncate block max-w-[160px]'}
        title={cacheKey ? undefined : label}
        onMouseEnter={e => { setPos({ top: e.currentTarget.getBoundingClientRect().bottom + 4, left: e.currentTarget.getBoundingClientRect().left }); loadThumb() }}
        onMouseLeave={() => setPos(null)}
      >
        {label}
        {pos && cacheKey && (
          <div className="fixed z-50 rounded-md border bg-popover shadow-lg p-2 w-64" style={{ top: pos.top, left: pos.left }}>
            {thumb === undefined ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : thumb ? (
              <img src={thumb} alt={label} className="w-full h-auto rounded" />
            ) : (
              <p className="text-xs text-muted-foreground text-center py-10">Sem thumbnail</p>
            )}
            <p className="text-xs text-center text-muted-foreground mt-1.5 truncate">{label}</p>
          </div>
        )}
      </span>
      {canPreview && (
        <button
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Ver prévia do anúncio"
          onClick={() => setPreviewOpen(true)}
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      )}
      {previewOpen && resolvedAdId && token && (
        <AdPreviewModal adId={resolvedAdId} adName={label} token={token} onClose={() => setPreviewOpen(false)} />
      )}
    </span>
  )
}

// ─── Árvore Campanha → Conjunto → Anúncio (drill-down estrutural) ─────────────
// Portado de TabPerpetuo.tsx (CampaignCard), generalizado para uso em qualquer
// lançamento: sem etapas/vídeo/seguidores do Perpétuo. Métrica principal de
// leads/CPL vem do BigQuery (leadsByContent, fonte de verdade do negócio);
// o resultado que a própria Meta reporta (metaResults/metaCostPerResult)
// aparece como comparação secundária, em cinza.
export interface AdTreeRow {
  adId: string
  adName: string
  spend: number
  metaResults: number
  metaCostPerResult: number
}

export interface AdsetTreeRow {
  adsetId: string
  adsetName: string
  adsetStatus: string
  dailyBudget: number | null
  lifetimeBudget: number | null
  spend: number
  metaResults: number
  metaCostPerResult: number
  ads: AdTreeRow[]
}

export interface CampaignTreeRow {
  campaignId: string
  campaignName: string
  adsets: AdsetTreeRow[]
}

function ctBrl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
}
function ctFmt(v: number) {
  return v.toLocaleString('pt-BR')
}

function BudgetCell({ daily, lifetime }: { daily: number | null; lifetime: number | null }) {
  if (daily != null) return <span>{ctBrl(daily)}<span className="text-muted-foreground text-xs ml-0.5">/dia</span></span>
  if (lifetime != null) return <span>{ctBrl(lifetime)}<span className="text-muted-foreground text-xs ml-0.5"> total</span></span>
  return <span className="text-muted-foreground">—</span>
}

export function CampaignTree({
  campaign,
  leadsByContent,
  token,
}: {
  campaign: CampaignTreeRow
  leadsByContent: Record<string, number> | null
  token: string
}) {
  const [open, setOpen] = useState(false)
  const [openAdsets, setOpenAdsets] = useState<Set<string>>(new Set())

  function toggleAdset(id: string) {
    setOpenAdsets(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const totSpend = campaign.adsets.reduce((s, a) => s + a.spend, 0)
  const totMetaResults = campaign.adsets.reduce((s, a) => s + a.metaResults, 0)
  const totMetaCpr = totMetaResults > 0 ? totSpend / totMetaResults : 0
  const hasActive = campaign.adsets.some(a => a.adsetStatus === 'ACTIVE')

  // leadsByContent é chaveado por linha granular "campanha|||conjunto|||anúncio"
  // (a query BQ exige utm_content preenchido) — os totais de campanha/conjunto
  // são a SOMA de todas as chaves com esse prefixo, não uma chave exata vazia.
  const leadsForAdset = (adsetName: string) => {
    if (!leadsByContent) return null
    const prefixKey = `${campaign.campaignName.toLowerCase().trim()}|||${adsetName.toLowerCase().trim()}|||`
    return Object.entries(leadsByContent)
      .filter(([k]) => k.startsWith(prefixKey))
      .reduce((s, [, v]) => s + v, 0)
  }
  const leadsForAd = (adsetName: string, adName: string) => {
    if (!leadsByContent) return null
    const key = `${campaign.campaignName.toLowerCase().trim()}|||${adsetName.toLowerCase().trim()}|||${adName.toLowerCase().trim()}`
    return leadsByContent[key] ?? 0
  }
  const totLeadsBQ = leadsByContent
    ? campaign.adsets.reduce((s, a) => s + (leadsForAdset(a.adsetName) ?? 0), 0)
    : null

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/40 transition-colors text-left"
      >
        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${hasActive ? 'bg-emerald-500 shadow-[0_0_0_3px_#d1fae5]' : 'bg-muted-foreground/40'}`} />
        <span className="flex-1 font-semibold text-sm truncate">{campaign.campaignName}</span>
        <div className="hidden sm:flex items-center gap-6 shrink-0">
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Investido</p>
            <p className="text-sm font-bold">{ctBrl(totSpend)}</p>
          </div>
          {totLeadsBQ !== null && (
            <>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Leads</p>
                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{ctFmt(totLeadsBQ)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">CPL</p>
                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {totLeadsBQ > 0 ? ctBrl(totSpend / totLeadsBQ) : '—'}
                </p>
              </div>
            </>
          )}
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Resultado Meta</p>
            <p className="text-sm font-bold text-muted-foreground">{ctFmt(totMetaResults)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">CPR Meta</p>
            <p className="text-sm font-bold text-muted-foreground">{totMetaCpr > 0 ? ctBrl(totMetaCpr) : '—'}</p>
          </div>
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="bg-muted/30 border-t border-border divide-y divide-border">
          {campaign.adsets.map(adset => {
            const isPaused = adset.adsetStatus !== 'ACTIVE'
            const adsetOpen = openAdsets.has(adset.adsetId)
            const hasAds = adset.ads.length > 0
            const adsetLeadsBQ = leadsForAdset(adset.adsetName)

            return (
              <div key={adset.adsetId} className={isPaused ? 'opacity-40' : ''}>
                <div
                  className={`flex items-center gap-3 px-5 py-3 ${hasAds ? 'cursor-pointer hover:bg-muted/50' : ''} transition-colors`}
                  onClick={() => hasAds && toggleAdset(adset.adsetId)}
                >
                  <span className={`h-2 w-2 rounded-full shrink-0 ${isPaused ? 'bg-muted-foreground/30' : 'bg-emerald-400'}`} />
                  <span className="flex-1 text-sm font-medium truncate">
                    {adset.adsetName}
                    {isPaused && <span className="ml-2 text-xs font-normal text-muted-foreground">(pausado)</span>}
                  </span>
                  <div className="hidden sm:flex items-center gap-5 text-right shrink-0">
                    <div>
                      <p className="text-[10px] text-muted-foreground">Orçamento</p>
                      <p className="text-xs font-semibold"><BudgetCell daily={adset.dailyBudget} lifetime={adset.lifetimeBudget} /></p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Investido</p>
                      <p className="text-xs font-semibold">{ctBrl(adset.spend)}</p>
                    </div>
                    {adsetLeadsBQ !== null && (
                      <>
                        <div>
                          <p className="text-[10px] text-muted-foreground">Leads</p>
                          <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{ctFmt(adsetLeadsBQ)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">CPL</p>
                          <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                            {adsetLeadsBQ > 0 ? ctBrl(adset.spend / adsetLeadsBQ) : '—'}
                          </p>
                        </div>
                      </>
                    )}
                    <div>
                      <p className="text-[10px] text-muted-foreground">Result. Meta</p>
                      <p className="text-xs font-semibold text-muted-foreground">{ctFmt(adset.metaResults)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">CPR Meta</p>
                      <p className="text-xs font-semibold text-muted-foreground">{adset.metaCostPerResult > 0 ? ctBrl(adset.metaCostPerResult) : '—'}</p>
                    </div>
                  </div>
                  {hasAds && (
                    <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${adsetOpen ? 'rotate-180' : ''}`} />
                  )}
                </div>

                {hasAds && adsetOpen && (
                  <div className="bg-background/60 border-t border-border divide-y divide-border/60">
                    {adset.ads.map((ad, i) => {
                      const isTop = i === 0 && ad.metaResults > 0
                      const maxRes = adset.ads[0]?.metaResults ?? 1
                      const barPct = maxRes > 0 ? (ad.metaResults / maxRes) * 100 : 0
                      const adLeadsBQ = leadsForAd(adset.adsetName, ad.adName)
                      return (
                        <div key={ad.adId} className={`flex items-center gap-3 px-7 py-2.5 ${ad.metaResults === 0 && (adLeadsBQ ?? 0) === 0 ? 'opacity-40' : ''}`}>
                          <span className="w-5 shrink-0 text-sm">
                            {isTop ? <Trophy className="h-3.5 w-3.5 text-amber-500" /> : <span className="opacity-0"><Trophy className="h-3.5 w-3.5" /></span>}
                          </span>
                          <span className="w-40 shrink-0">
                            <AdThumbTooltip
                              label={ad.adName}
                              cacheKey={ad.adId}
                              className="text-xs text-muted-foreground truncate block"
                              fetchThumb={() =>
                                fetch(`/api/meta-creative-thumbs?adIds=${ad.adId}`, { headers: { Authorization: `Bearer ${token}` } })
                                  .then(r => r.ok ? r.json() : null)
                                  .then(data => data?.[ad.adId] ?? null)
                              }
                              adId={ad.adId}
                              token={token}
                            />
                          </span>
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-40">
                            <div className={`h-full rounded-full ${isTop ? 'bg-amber-400' : 'bg-primary/60'}`} style={{ width: `${barPct}%` }} />
                          </div>
                          {adLeadsBQ !== null && (
                            <>
                              <span className="text-xs font-semibold w-16 text-right shrink-0 text-emerald-600 dark:text-emerald-400">
                                {ctFmt(adLeadsBQ)} leads
                              </span>
                              <span className="text-xs text-right shrink-0 w-16 text-emerald-600 dark:text-emerald-400">
                                {adLeadsBQ > 0 ? ctBrl(ad.spend / adLeadsBQ) : '—'}
                              </span>
                            </>
                          )}
                          <span className="text-xs font-semibold w-20 text-right shrink-0 text-muted-foreground">{ctFmt(ad.metaResults)} meta</span>
                          <span className="text-xs text-muted-foreground w-16 text-right shrink-0">
                            {ad.metaResults > 0 ? ctBrl(ad.metaCostPerResult) : '—'}
                          </span>
                          <span className="text-xs text-muted-foreground w-16 text-right shrink-0">{ctBrl(ad.spend)}</span>
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

// ─── Section Header ───────────────────────────────────────────────────────────
interface SectionHeaderProps {
  title: string
  description?: string
}

export function SectionHeader({ title, description }: SectionHeaderProps) {
  return (
    <div className="mb-5">
      <h2 className="text-base font-bold tracking-tight">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      )}
    </div>
  )
}

// ─── Health Banner ────────────────────────────────────────────────────────────
interface HealthBannerProps {
  messages: string[]
}

export function HealthBanner({ messages }: HealthBannerProps) {
  if (!messages.length) return null
  return (
    <div className="mb-5 flex items-start gap-3 rounded-2xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <ul className="list-disc space-y-1 pl-3">
        {messages.map((m, i) => <li key={i}>{m}</li>)}
      </ul>
    </div>
  )
}

// ─── Tab Loading ──────────────────────────────────────────────────────────────
export function TabLoading() {
  return (
    <div className="flex h-72 items-center justify-center">
      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground/50" />
    </div>
  )
}

// ─── Tab Error ────────────────────────────────────────────────────────────────
interface TabErrorProps {
  message: string
  onRetry?: () => void
}

export function TabError({ message, onRetry }: TabErrorProps) {
  return (
    <div className="flex h-72 flex-col items-center justify-center gap-3 text-center px-6">
      <div className="h-12 w-12 rounded-2xl bg-destructive/10 flex items-center justify-center">
        <AlertTriangle className="h-6 w-6 text-destructive" />
      </div>
      <p className="text-sm text-muted-foreground max-w-xs">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          Tentar novamente
        </Button>
      )}
    </div>
  )
}

// ─── Chart Tooltip ────────────────────────────────────────────────────────────
interface ChartTooltipProps {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: string
  formatter?: (value: number) => string
}

export function ChartTooltip({ active, payload, label, formatter }: ChartTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border bg-card px-3 py-2 text-sm shadow-lg">
      {label && <p className="mb-1.5 font-semibold text-xs text-muted-foreground">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}:{' '}
          <span className="font-bold">
            {formatter ? formatter(entry.value) : entry.value}
          </span>
        </p>
      ))}
    </div>
  )
}

// ─── Formatadores ─────────────────────────────────────────────────────────────
export function formatBRL(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

export function formatPercent(value: number, decimals = 1) {
  return `${value.toFixed(decimals)}%`
}

// ─── UtmTable ─────────────────────────────────────────────────────────────────

export function UtmTable({
  title,
  rows,
  total,
  color,
  hint,
  getCpl,
  cplNote,
  getCpv,
  getCpvMeta,
  salesRows,
  totalBuyers,
}: {
  title: string
  rows: { name: string; value: number }[]
  total: number
  color: string
  hint?: string
  getCpl?: (name: string, leads: number) => number | null
  cplNote?: string
  getCpv?: (name: string) => number | null     // CPV cruzado: gasto ÷ vendas com lead
  getCpvMeta?: (name: string) => number | null  // CPV Meta: gasto ÷ compras atribuídas pelo Meta
  salesRows?: UtmSalesAttribution[]
  totalBuyers?: number
}) {
  const [filter, setFilter] = useState('')
  const filtered = filter ? rows.filter(r => r.name.toLowerCase().includes(filter.toLowerCase())) : rows
  const maxVal = Math.max(...rows.map(r => r.value), 1)
  const hasSales = salesRows && salesRows.length > 0

  const salesMap = new Map<string, UtmSalesAttribution>()
  if (salesRows) {
    for (const s of salesRows) salesMap.set(s.name.toLowerCase(), s)
  }

  return (
    <div>
      <SectionHeader title={title} description={hint} />
      {hasSales && totalBuyers != null && (
        <p className="mb-1 text-[10px] text-muted-foreground">
          {totalBuyers} comprador(es) encontrado(s) no período
          {' · '}
          <span title="Em algum momento tiveram essa UTM">Todos</span>
          {' / '}
          <span title="Última UTM registrada antes da compra">Última UTM</span>
          {' / '}
          <span title="UTM de origem do lead na base">Origem</span>
        </p>
      )}
      <div className="mb-2">
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filtrar..."
          className="w-full rounded-md border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Valor</th>
              <th className="px-3 py-2 text-right font-medium">Leads</th>
              <th className="px-3 py-2 text-right font-medium">%</th>
              {getCpl && <th className="px-3 py-2 text-right font-medium">CPL</th>}
              {hasSales && (
                <th className="px-3 py-2 text-right font-medium text-xs" title="Vendas: Qualquer interação / Última UTM antes da compra / UTM de origem">
                  Vendas
                </th>
              )}
              {getCpv && <th className="px-3 py-2 text-right font-medium" title="CPV cruzado: gasto da UTM ÷ vendas com lead atribuído">CPV</th>}
              {getCpvMeta && <th className="px-3 py-2 text-right font-medium" title="CPV Meta: gasto da UTM ÷ compras atribuídas pelo Meta (cobre venda direta)">CPV Meta</th>}
              <th className="px-3 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map(r => {
              const pct = total > 0 ? (r.value / total) * 100 : 0
              const cpl = getCpl ? getCpl(r.name, r.value) : null
              const cpv = getCpv ? getCpv(r.name) : null
              const cpvMeta = getCpvMeta ? getCpvMeta(r.name) : null
              const sales = hasSales ? salesMap.get(r.name.toLowerCase()) : null
              return (
                <tr key={r.name} className="hover:bg-muted/40">
                  <td className="px-3 py-1.5 truncate max-w-[200px] font-medium" title={r.name}>{r.name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.value.toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{pct.toFixed(1)}%</td>
                  {getCpl && (
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {cpl != null
                        ? <span className="font-medium" style={{ color: CHART_COLORS[4] }}>R$ {cpl.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                  )}
                  {hasSales && (
                    <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                      {sales
                        ? (
                          <span className="inline-flex items-center gap-1 text-xs">
                            <span className="font-semibold" style={{ color: CHART_COLORS[0] }} title="Em algum momento tiveram essa UTM">{sales.anyTime}</span>
                            <span className="text-muted-foreground">/</span>
                            <span className="font-semibold" style={{ color: CHART_COLORS[2] }} title="Última UTM antes da compra">{sales.lastBefore}</span>
                            <span className="text-muted-foreground">/</span>
                            <span className="font-semibold" style={{ color: CHART_COLORS[3] }} title="UTM de origem">{sales.origin}</span>
                          </span>
                        )
                        : <span className="text-muted-foreground">— / — / —</span>}
                    </td>
                  )}
                  {getCpv && (
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {cpv != null
                        ? <span className="font-medium" style={{ color: CHART_COLORS[3] }}>R$ {cpv.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                  )}
                  {getCpvMeta && (
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {cpvMeta != null
                        ? <span className="font-medium" style={{ color: CHART_COLORS[0] }}>R$ {cpvMeta.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                  )}
                  <td className="px-3 py-1.5">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(r.value / maxVal) * 100}%`, backgroundColor: color }} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {getCpl && cplNote && (
        <p className="mt-1 text-[10px] text-muted-foreground">{cplNote}</p>
      )}
    </div>
  )
}

// ─── RevenueTable ─────────────────────────────────────────────────────────────

export function RevenueTable({
  rows,
  spendMap,
  leadsMap,
}: {
  rows: BA25ProfileEntry[]
  spendMap?: Record<string, number>
  leadsMap?: Record<string, number>
}) {
  const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const hasSpend = spendMap && Object.keys(spendMap).length > 0

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/60">
          <tr>
            <th className="px-3 py-2 text-left font-medium">UTM</th>
            <th className="px-3 py-2 text-right font-medium">Vendas</th>
            <th className="px-3 py-2 text-right font-medium">Receita</th>
            <th className="px-3 py-2 text-right font-medium">Ticket Médio</th>
            {hasSpend && <th className="px-3 py-2 text-right font-medium">Investido</th>}
            {hasSpend && <th className="px-3 py-2 text-right font-medium">ROAS</th>}
            {hasSpend && leadsMap && <th className="px-3 py-2 text-right font-medium">CPL</th>}
            {hasSpend && <th className="px-3 py-2 text-right font-medium">CPV</th>}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(r => {
            const spend  = spendMap?.[r.name] ?? null
            const leads  = leadsMap?.[r.name] ?? null
            const roas   = spend != null && spend > 0 && r.revenue > 0 ? r.revenue / spend : null
            const cpl    = spend != null && leads != null && leads > 0 ? spend / leads : null
            const cpv    = spend != null && spend > 0 && r.buyers > 0 ? spend / r.buyers : null
            const roasColor = roas == null ? undefined : roas >= 3 ? CHART_COLORS[1] : roas >= 1.5 ? CHART_COLORS[2] : '#c17c74'
            return (
              <tr key={r.name} className="hover:bg-muted/40">
                <td className="px-3 py-1.5 font-medium truncate max-w-[220px]" title={r.name}>{r.name}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.buyers}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: CHART_COLORS[1] }}>
                  R$ {brl(r.revenue)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">R$ {brl(r.avgTicket)}</td>
                {hasSpend && (
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {spend != null ? `R$ ${brl(spend)}` : '—'}
                  </td>
                )}
                {hasSpend && (
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: roasColor }}>
                    {roas != null ? `${roas.toFixed(2)}x` : '—'}
                  </td>
                )}
                {hasSpend && leadsMap && (
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {cpl != null ? `R$ ${brl(cpl)}` : '—'}
                  </td>
                )}
                {hasSpend && (
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {cpv != null ? `R$ ${brl(cpv)}` : '—'}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
