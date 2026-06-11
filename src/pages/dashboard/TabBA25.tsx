import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { LaunchData, GoalsData, RawLaunchResponse, SalesUtmData, UtmSalesAttribution, SurveyBuyersData, BA25ProfileData } from './types'
import {
  SectionHeader, TabLoading, TabError,
  ChartTooltip, CHART_COLORS,
  UtmTable, RevenueTable,
} from './components'
import {
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { RefreshCw, ChevronDown } from 'lucide-react'

interface Props {
  token: string
  enabled: boolean
  // Parâmetros do lançamento (default = BA25, para retrocompatibilidade).
  prefix?: string
  spendFilter?: string
  orFilter?: string
  defaultSince?: string
  defaultUntil?: string
  nome?: string
  productFilter?: string   // filtro LIKE de produto de venda (default BucoApprove)
  surveySheetId?: string   // planilha de pesquisa de boas-vindas
  goalsOverride?: GoalsData | null  // metas vindas do lançamento (substitui /api/goals-data)
}

const FIXED_PREFIX = 'BA25'
const FIXED_SPEND_FILTER = 'BA25'
const FIXED_OR_FILTER = 'instagram,engajamento,lembrete,remarketing'
const FIXED_SINCE = '2026-03-13'
const FIXED_UNTIL = '2026-04-22'


function makeGetCpl(map: Record<string, number> | undefined) {
  if (!map) return undefined
  return (name: string, leads: number): number | null => {
    const spend = map[name]
    if (spend == null || leads === 0) return null
    return Math.round((spend / leads) * 100) / 100
  }
}

function AccordionItem({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyRef = useRef<HTMLDivElement>(null)
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-muted/40 transition-colors"
      >
        {title}
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div
        ref={bodyRef}
        className="overflow-hidden transition-all duration-200"
        style={{ maxHeight: open ? '9999px' : '0px' }}
      >
        <div className="border-t">{children}</div>
      </div>
    </div>
  )
}


// ─── Paleta e helpers para gráficos de pizza ──────────────────────────────────

const PIE_COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#ec4899',
  '#14b8a6', '#8b5cf6', '#f97316', '#06b6d4',
]

function preparePieData(
  rows: UtmSalesAttribution[],
  field: 'lastBefore' | 'origin' | 'anyTime' = 'lastBefore',
) {
  return rows
    .filter(r => r[field] > 0)
    .sort((a, b) => b[field] - a[field])
    .map(r => ({ name: r.name, value: r[field] }))
}

function SalesPieChart({ title, rows, field = 'lastBefore' }: {
  title: string
  rows: UtmSalesAttribution[]
  field?: 'lastBefore' | 'origin' | 'anyTime'
}) {
  const pieData = preparePieData(rows, field)
  const total = pieData.reduce((s, d) => s + d.value, 0)

  return (
    <div className="flex flex-col">
      <p className="text-xs font-semibold text-center mb-0.5">{title}</p>
      <p className="text-[10px] text-center text-muted-foreground mb-1">
        {total > 0 ? `${total} vendas` : 'Sem dados'}
      </p>

      {total === 0 ? (
        <div className="flex-1 flex items-center justify-center h-28 text-xs text-muted-foreground">—</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={130}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={32}
                outerRadius={52}
                paddingAngle={2}
                dataKey="value"
              >
                {pieData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name) => {
                  const v = Number(value ?? 0)
                  return [`${v} (${total > 0 ? ((v / total) * 100).toFixed(1) : 0}%)`, String(name)]
                }}
                contentStyle={{ fontSize: '11px' }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-0.5 mt-1 px-1">
            {pieData.map((d, i) => (
              <div key={d.name} className="flex items-center justify-between gap-1 text-[10px]">
                <div className="flex items-center gap-1 min-w-0">
                  <span
                    className="h-2 w-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                  />
                  <span className="truncate text-muted-foreground" title={d.name}>{d.name}</span>
                </div>
                <span className="tabular-nums font-semibold flex-shrink-0">
                  {d.value}
                  <span className="font-normal text-muted-foreground ml-0.5">
                    ({total > 0 ? ((d.value / total) * 100).toFixed(0) : 0}%)
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function DistributionBarChart({
  title,
  description,
  data,
  color = CHART_COLORS[0],
}: {
  title: string
  description?: string
  data: { label: string; count: number }[]
  color?: string
}) {
  const total = data.reduce((s, d) => s + d.count, 0)
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm font-semibold mb-0.5">{title}</p>
      {description && <p className="text-xs text-muted-foreground mb-3">{description}</p>}
      {total === 0 ? (
        <div className="h-44 flex items-center justify-center text-xs text-muted-foreground">Sem dados</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 44 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              angle={-35}
              textAnchor="end"
              interval={0}
            />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip
              formatter={(value) => [`${value} compradores`, '']}
              labelStyle={{ fontSize: '11px' }}
              contentStyle={{ fontSize: '11px' }}
            />
            <Bar dataKey="count" fill={color} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ─── Pesquisa de boas-vindas ──────────────────────────────────────────────────

function SurveyBar({ data, color }: { data: { name: string; count: number }[]; color: string }) {
  const max   = Math.max(...data.map(d => d.count), 1)
  const total = data.reduce((s, d) => s + d.count, 0)
  return (
    <div className="space-y-2">
      {data.map(d => {
        const pct = total > 0 ? ((d.count / total) * 100) : 0
        return (
          <div key={d.name} className="flex items-center gap-2 text-xs">
            <span
              className="w-44 text-right text-[11px] text-muted-foreground flex-shrink-0 leading-tight"
              title={d.name}
            >
              {d.name}
            </span>
            <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${(d.count / max) * 100}%`, backgroundColor: color }}
              />
            </div>
            <span className="tabular-nums text-[11px] font-semibold flex-shrink-0 w-16 text-right">
              {d.count}
              <span className="font-normal text-muted-foreground ml-0.5">({pct.toFixed(0)}%)</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}


// ─── Drill-down Campanha → Público → Criativo ─────────────────────────────────

interface DrillRow { campaign: string; medium: string; content: string; count: number }

function DrillColumn({
  title,
  items,
  selected,
  onSelect,
  placeholder,
}: {
  title: string
  items: { name: string; count: number }[]
  selected: string | null
  onSelect: (name: string) => void
  placeholder?: string
}) {
  const maxVal = Math.max(...items.map(i => i.count), 1)
  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">{title}</p>
      {items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground py-8 text-center px-2">
          {placeholder ?? '—'}
        </div>
      ) : (
        <div className="space-y-0.5 overflow-y-auto max-h-80 pr-1">
          {items.map(item => {
            const active = selected === item.name
            return (
              <button
                key={item.name}
                onClick={() => onSelect(item.name)}
                title={item.name}
                className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted/70 text-foreground'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="truncate font-medium leading-tight">{item.name}</span>
                  <span className="tabular-nums font-bold flex-shrink-0 text-[11px]">{item.count}</span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: active ? 'rgba(255,255,255,0.25)' : 'hsl(var(--muted))' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(item.count / maxVal) * 100}%`,
                      background: active ? 'rgba(255,255,255,0.7)' : CHART_COLORS[2],
                    }}
                  />
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CampaignDrilldown({ drilldown }: { drilldown: DrillRow[] }) {
  const [selCampaign, setSelCampaign] = useState<string | null>(null)
  const [selMedium,   setSelMedium]   = useState<string | null>(null)

  // Campaigns: se um medium estiver selecionado, filtra por ele
  const campaigns = useMemo(() => {
    const src = selMedium ? drilldown.filter(d => d.medium === selMedium) : drilldown
    const m = new Map<string, number>()
    for (const d of src) m.set(d.campaign, (m.get(d.campaign) ?? 0) + d.count)
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  }, [drilldown, selMedium])

  // Mediums: se uma campaign estiver selecionada, filtra por ela
  const mediums = useMemo(() => {
    const src = selCampaign ? drilldown.filter(d => d.campaign === selCampaign) : drilldown
    const m = new Map<string, number>()
    for (const d of src) m.set(d.medium, (m.get(d.medium) ?? 0) + d.count)
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  }, [drilldown, selCampaign])

  // Contents: filtra por campaign e/ou medium se selecionados
  const contents = useMemo(() => {
    let src = drilldown
    if (selCampaign) src = src.filter(d => d.campaign === selCampaign)
    if (selMedium)   src = src.filter(d => d.medium   === selMedium)
    const m = new Map<string, number>()
    for (const d of src) m.set(d.content, (m.get(d.content) ?? 0) + d.count)
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  }, [drilldown, selCampaign, selMedium])

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b bg-muted/40">
        <p className="text-sm font-semibold">Drill-down: Campanha · Público · Criativo</p>
        <p className="text-xs text-muted-foreground">Última UTM antes da compra · clique em qualquer coluna para cruzar os filtros</p>
      </div>
      <div className="p-4 flex gap-0 divide-x">
        <div className="pr-4 flex-1 min-w-0">
          <DrillColumn
            title="Campanha (utm_campaign)"
            items={campaigns}
            selected={selCampaign}
            onSelect={name => setSelCampaign(prev => prev === name ? null : name)}
          />
        </div>
        <div className="px-4 flex-1 min-w-0">
          <DrillColumn
            title="Público (utm_medium)"
            items={mediums}
            selected={selMedium}
            onSelect={name => setSelMedium(prev => prev === name ? null : name)}
          />
        </div>
        <div className="pl-4 flex-1 min-w-0">
          <DrillColumn
            title="Criativo (utm_content)"
            items={contents}
            selected={null}
            onSelect={() => {}}
          />
        </div>
      </div>
    </div>
  )
}

interface TopAdRow {
  name: string
  leads: number | null
  sales: number | null
  anyTouch: number | null
  spend: number | null
}

function TopAdsBlock({
  byLeads,
  salesByContent,
  spendByContent,
  prefix,
}: {
  byLeads: { name: string; leads: number }[]
  salesByContent: UtmSalesAttribution[] | undefined
  spendByContent: Record<string, number> | undefined
  prefix: string
}) {
  const brl = (v: number) =>
    v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const leadsMap = new Map(byLeads.map(r => [r.name.toLowerCase(), r.leads]))
  const salesLower = new Map((salesByContent ?? []).map(r => [r.name.toLowerCase(), r]))
  const getSpend = (name: string) => spendByContent?.[name] ?? null

  const top5Leads: TopAdRow[] = byLeads.slice(0, 10).map(r => ({
    name: r.name,
    leads: r.leads,
    sales: salesLower.get(r.name.toLowerCase())?.lastBefore ?? null,
    anyTouch: salesLower.get(r.name.toLowerCase())?.anyTime ?? null,
    spend: getSpend(r.name),
  }))

  const top5First: TopAdRow[] = [...(salesByContent ?? [])]
    .filter(r => r.origin > 0)
    .sort((a, b) => b.origin - a.origin)
    .slice(0, 10)
    .map(r => ({
      name: r.name,
      leads: leadsMap.get(r.name.toLowerCase()) ?? null,
      sales: r.origin,
      anyTouch: null,
      spend: getSpend(r.name),
    }))

  const top5Last: TopAdRow[] = [...(salesByContent ?? [])]
    .filter(r => r.lastBefore > 0)
    .sort((a, b) => b.lastBefore - a.lastBefore)
    .slice(0, 10)
    .map(r => ({
      name: r.name,
      leads: leadsMap.get(r.name.toLowerCase()) ?? null,
      sales: r.lastBefore,
      anyTouch: null,
      spend: getSpend(r.name),
    }))

  const top5AnyTouch: TopAdRow[] = [...(salesByContent ?? [])]
    .filter(r => r.anyTime > 0)
    .sort((a, b) => b.anyTime - a.anyTime)
    .slice(0, 10)
    .map(r => ({
      name: r.name,
      leads: leadsMap.get(r.name.toLowerCase()) ?? null,
      sales: r.anyTime,
      anyTouch: null,
      spend: getSpend(r.name),
    }))

  function Table({ title, rows, salesLabel = 'Vendas' }: { title: string; rows: TopAdRow[]; salesLabel?: string }) {
    const hasAnyTouch = rows.some(r => r.anyTouch != null)
    return (
      <div>
        <p className="text-[11px] font-semibold mb-2 text-muted-foreground uppercase tracking-wide">{title}</p>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">Sem dados</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/60">
                <tr>
                  <th className="px-2 py-1.5 text-left text-[10px] font-medium w-6">#</th>
                  <th className="px-2 py-1.5 text-left text-[10px] font-medium">Anúncio</th>
                  <th className="px-2 py-1.5 text-right text-[10px] font-medium">Leads</th>
                  <th className="px-2 py-1.5 text-right text-[10px] font-medium">{salesLabel}</th>
                  {hasAnyTouch && <th className="px-2 py-1.5 text-right text-[10px] font-medium">Any</th>}
                  <th className="px-2 py-1.5 text-right text-[10px] font-medium">Invest.</th>
                  <th className="px-2 py-1.5 text-right text-[10px] font-medium">CPL</th>
                  <th className="px-2 py-1.5 text-right text-[10px] font-medium">CPA</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r, i) => {
                  const cpl = r.spend != null && r.leads != null && r.leads > 0 ? r.spend / r.leads : null
                  const cpa = r.spend != null && r.sales != null && r.sales > 0 ? r.spend / r.sales : null
                  return (
                    <tr key={r.name + i} className="hover:bg-muted/40">
                      <td className="px-2 py-1.5 text-[11px] font-bold text-muted-foreground">{i + 1}°</td>
                      <td className="px-2 py-1.5 font-medium truncate max-w-[160px]" title={r.name}>{r.name}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: CHART_COLORS[1] }}>
                        {r.leads != null ? r.leads.toLocaleString('pt-BR') : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold" style={{ color: CHART_COLORS[0] }}>
                        {r.sales != null ? r.sales.toLocaleString('pt-BR') : '—'}
                      </td>
                      {hasAnyTouch && (
                        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                          {r.anyTouch != null ? r.anyTouch.toLocaleString('pt-BR') : '—'}
                        </td>
                      )}
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                        {r.spend != null ? `R$ ${brl(r.spend)}` : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: CHART_COLORS[4] }}>
                        {cpl != null ? `R$ ${brl(cpl)}` : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                        {cpa != null ? `R$ ${brl(cpa)}` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b bg-muted/40">
        <p className="text-sm font-semibold">Top 10 Anúncios — {prefix} Captura</p>
        <p className="text-xs text-muted-foreground">
          Leads: registros com tag {prefix}-Captura · Vendas: compradores por criativo (last-touch na coluna de leads) · Invest.: Meta Ads spend
        </p>
      </div>
      <div className="p-4 grid gap-6 grid-cols-1 md:grid-cols-2">
        <Table title="Por Leads Capturados" rows={top5Leads} salesLabel="Vendas (last)" />
        <Table title="Por Vendas (First-Touch)" rows={top5First} salesLabel="Vendas" />
        <Table title="Por Vendas (Last-Touch)" rows={top5Last} salesLabel="Vendas" />
        <Table title="Por Participação (Any Touch)" rows={top5AnyTouch} salesLabel="Vendas" />
      </div>
    </div>
  )
}

export default function TabBA25({
  token, enabled,
  prefix = FIXED_PREFIX,
  spendFilter = FIXED_SPEND_FILTER,
  orFilter = FIXED_OR_FILTER,
  defaultSince = FIXED_SINCE,
  defaultUntil = FIXED_UNTIL,
  nome = 'BA25',
  productFilter = '',
  surveySheetId = '',
  goalsOverride,
}: Props) {
  const [since, setSince] = useState(defaultSince)
  const [until, setUntil] = useState(defaultUntil)
  const [data, setData] = useState<LaunchData | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [goals, setGoals] = useState<GoalsData | null>(null)
  const [salesUtmData, setSalesUtmData] = useState<SalesUtmData | null>(null)
  const [surveyData,   setSurveyData]   = useState<SurveyBuyersData | null>(null)
  const [profileData,  setProfileData]  = useState<BA25ProfileData | null>(null)
  const [captureAdLeads, setCaptureAdLeads] = useState<{ name: string; leads: number }[]>([])
  const [interactionStats, setInteractionStats] = useState<{ with: number; without: number } | null>(null)
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null)
  const _cache = useRef(new Map<string, {
    data: LaunchData; salesUtmData: SalesUtmData | null; surveyData: SurveyBuyersData | null
    profileData: BA25ProfileData | null; captureAdLeads: { name: string; leads: number }[]
    interactionStats: { with: number; without: number } | null; fetchedAt: number
  }>())

  const loadGoals = useCallback(async () => {
    // Se o lançamento trouxe as metas (goalsOverride), usa elas; senão busca a
    // planilha legada do BA25 (/api/goals-data).
    if (goalsOverride !== undefined) {
      setGoals(goalsOverride)
      return
    }
    try {
      const res = await fetch('/api/goals-data', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setGoals(await res.json())
    } catch {
      // silencioso — metas são complementares
    }
  }, [token, goalsOverride])

  const load = useCallback(async (force = false) => {
    const cacheKey = `${prefix}_${since}_${until}_${productFilter}`

    if (!force) {
      const cached = _cache.current.get(cacheKey)
      if (cached) {
        setData(cached.data)
        setSalesUtmData(cached.salesUtmData)
        setSurveyData(cached.surveyData)
        setProfileData(cached.profileData)
        setCaptureAdLeads(cached.captureAdLeads)
        setInteractionStats(cached.interactionStats)
        setLastFetchedAt(cached.fetchedAt)
        setStatus('idle')
        return
      }
    }

    setStatus('loading')
    setErrorMsg(null)
    try {
      const headers = { Authorization: `Bearer ${token}` }
      const nc = force ? '&nocache=1' : ''
      const bqUrl = `/api/launch-data?prefix=${encodeURIComponent(prefix)}&since=${since}&until=${until}&broadSearch=true${nc}`
      const metaUrl = `/api/meta-spend?since=${since}&until=${until}&spendFilter=${encodeURIComponent(spendFilter)}&orFilter=${encodeURIComponent(orFilter)}${nc}`

      // params opcionais por lançamento (vazio = default BucoApprove/BA25 no backend)
      const pf = productFilter ? `&productFilter=${encodeURIComponent(productFilter)}` : ''
      const ss = surveySheetId ? `&surveySheetId=${encodeURIComponent(surveySheetId)}` : ''
      const salesUrl  = `/api/launch-sales-utms?since=${since}&until=${until}${pf}${nc}`
      const surveyUrl  = `/api/survey-buyers?since=${since}&until=${until}${pf}${ss}${nc}`
      const profileUrl = `/api/ba25-profile?since=${since}&until=${until}${pf}${ss}${nc}`

      const t0 = Date.now()
      const [bqRes, metaRes, salesRes, surveyRes, profileRes] = await Promise.all([
        fetch(bqUrl, { headers }),
        fetch(metaUrl, { headers }),
        fetch(salesUrl, { headers }),
        fetch(surveyUrl, { headers }),
        fetch(profileUrl, { headers }),
      ])
      console.log(`[BA25] BQ: ${bqRes.status} | Meta: ${metaRes.status} | ${Date.now() - t0}ms`)

      if (!bqRes.ok) {
        const body = await bqRes.json().catch(() => ({}))
        throw new Error(`[launch-data ${bqRes.status}] ${body.detail ?? body.error ?? 'sem detalhe'}`)
      }

      const t1 = Date.now()
      const raw: RawLaunchResponse = await bqRes.json()
      console.log(`[BA25] BQ parse: ${Date.now() - t1}ms | rows: ${raw.rows?.length ?? 0}`)

      // ── Processa dados brutos no frontend ──────────────────────────────────
      const sinceDate = since
      const untilDate = until

      // Agrupa por tag: histórico e período
      const tagAll = new Map<string, Set<string>>()
      const tagPeriod = new Map<string, Set<string>>()
      const emailsAll = new Set<string>()
      const emailsPeriod = new Set<string>()
      const dayEmails = new Map<string, Set<string>>()
      const sourceMap = new Map<string, Set<string>>()
      const campaignMap = new Map<string, Set<string>>()
      const mediumMap = new Map<string, Set<string>>()
      const contentMap = new Map<string, Set<string>>()
      const captureContentMap = new Map<string, Set<string>>()
      const periodInteractionEmails = new Set<string>()

      const inPeriod = (d: string) => d >= sinceDate && d <= untilDate

      for (const row of raw.rows) {
        const email = row.lead_email
        const tag = row.tag_name ?? ''
        const date = row.date?.slice(0, 10) ?? ''
        if (!email) continue

        emailsAll.add(email)
        if (tag) {
          if (!tagAll.has(tag)) tagAll.set(tag, new Set())
          tagAll.get(tag)!.add(email)
        }

        if (date && inPeriod(date)) {
          emailsPeriod.add(email)
          if (tag) {
            if (!tagPeriod.has(tag)) tagPeriod.set(tag, new Set())
            tagPeriod.get(tag)!.add(email)
          }
          // primeiro dia do lead no período
          const prev = dayEmails.get(date)
          if (!prev) dayEmails.set(date, new Set())
          dayEmails.get(date)!.add(email)

          const addUtm = (map: Map<string, Set<string>>, val: string | null) => {
            const k = val ?? ''
            if (!map.has(k)) map.set(k, new Set())
            map.get(k)!.add(email)
          }
          addUtm(sourceMap, row.utm_source)
          addUtm(campaignMap, row.utm_campaign)
          addUtm(mediumMap, row.utm_medium)
          addUtm(contentMap, row.utm_content)

          if (tag.toLowerCase().includes('ba25-captura')) {
            const k = row.utm_content ?? ''
            if (!captureContentMap.has(k)) captureContentMap.set(k, new Set())
            captureContentMap.get(k)!.add(email)
          }

          if (!tag.toLowerCase().includes('venda')) {
            periodInteractionEmails.add(email.toLowerCase())
          }
        }
      }

      const captureAdLeadsArr = [...captureContentMap.entries()]
        .filter(([name]) => name !== '')
        .map(([name, s]) => ({ name, leads: s.size }))
        .sort((a, b) => b.leads - a.leads)

      const mapToArr = (m: Map<string, Set<string>>, label: string) =>
        [...m.entries()]
          .map(([name, s]) => ({ name: name || label, value: s.size }))
          .sort((a, b) => b.value - a.value)

      const byTag = [...tagAll.entries()].map(([tag, s]) => ({
        tag,
        countAll: s.size,
        countPeriod: tagPeriod.get(tag)?.size ?? 0,
      })).sort((a, b) => b.countAll - a.countAll)

      const totalUniqueAll = emailsAll.size
      const totalUnique = emailsPeriod.size
      const sumByTag = byTag.reduce((s, t) => s + t.countAll, 0)
      const overlap = sumByTag - totalUniqueAll

      const leadsByDay = [...dayEmails.entries()]
        .map(([date, s]) => ({ date, count: s.size }))
        .sort((a, b) => a.date.localeCompare(b.date))

      const processed: LaunchData = {
        prefix: raw.prefix,
        byTag,
        totalUniqueAll,
        totalUnique,
        sumByTag,
        overlap,
        leadsByDay,
        bySource: mapToArr(sourceMap, '(direto)'),
        byCampaign: mapToArr(campaignMap, '(sem campanha)'),
        byMedium: mapToArr(mediumMap, '(não informado)'),
        byContent: mapToArr(contentMap, '(não informado)'),
        byTerm: [],
        dateRange: { since, until },
      }
      // ──────────────────────────────────────────────────────────────────────

      let finalData: LaunchData = processed
      if (metaRes.ok) {
        const metaData = await metaRes.json()
        const cpl = totalUnique > 0 && metaData.metaSpend > 0
          ? Math.round((metaData.metaSpend / totalUnique) * 100) / 100
          : null
        finalData = { ...processed, ...metaData, cpl }
      } else {
        const metaBody = await metaRes.json().catch(() => ({}))
        console.warn(`[BA25] Meta falhou ${metaRes.status}:`, metaBody)
      }
      setData(finalData)

      let finalSalesData: SalesUtmData | null = null
      let finalInteractionStats: { with: number; without: number } | null = null
      if (salesRes.ok) {
        const salesData: SalesUtmData = await salesRes.json()
        finalSalesData = salesData
        // Conta por transações (não por comprador único) para bater com total de vendas
        const saleCounts = salesData.buyerSaleCounts ?? []
        const totalSales = salesData.totalSales ?? saleCounts.reduce((s, r) => s + r.count, 0)
        const withCount = saleCounts
          .filter(r => periodInteractionEmails.has(r.email))
          .reduce((s, r) => s + r.count, 0)
        finalInteractionStats = { with: withCount, without: totalSales - withCount }
      } else {
        console.warn(`[BA25] Sales UTMs falhou ${salesRes.status}`)
      }
      setSalesUtmData(finalSalesData)
      setInteractionStats(finalInteractionStats)

      let finalSurveyData: SurveyBuyersData | null = null
      if (surveyRes.ok) {
        finalSurveyData = await surveyRes.json()
      } else {
        console.warn(`[BA25] Survey falhou ${surveyRes.status}`)
      }
      setSurveyData(finalSurveyData)

      let finalProfileData: BA25ProfileData | null = null
      if (profileRes.ok) {
        finalProfileData = await profileRes.json()
      } else {
        console.warn(`[BA25] Profile falhou ${profileRes.status}`)
      }
      setProfileData(finalProfileData)

      setCaptureAdLeads(captureAdLeadsArr)

      const now = Date.now()
      _cache.current.set(cacheKey, {
        data: finalData, salesUtmData: finalSalesData, surveyData: finalSurveyData,
        profileData: finalProfileData, captureAdLeads: captureAdLeadsArr,
        interactionStats: finalInteractionStats, fetchedAt: now,
      })
      setLastFetchedAt(now)
      setStatus('idle')
    } catch (e) {
      setStatus('error')
      setErrorMsg((e as Error).message)
    }
  }, [since, until, token, prefix, spendFilter, orFilter, productFilter, surveySheetId])

  // Reseta a janela de datas quando troca de lançamento (defaults mudam).
  useEffect(() => {
    setSince(defaultSince)
    setUntil(defaultUntil)
  }, [defaultSince, defaultUntil])

  useEffect(() => {
    if (enabled) loadGoals()
  }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  const maxTagCount = data ? Math.max(...data.byTag.map(t => t.countAll), 1) : 1

  return (
    <div className="space-y-6">

      {/* Cabeçalho fixo com controles de data */}
      <div className="rounded-lg border bg-card p-4">
        <SectionHeader
          title={nome}
          description={`Análise completa do lançamento ${nome}. Leads captados via tags ${prefix} e campanhas Meta Ads com filtro ${prefix} + CAPTURA.`}
        />
        <div className="flex flex-wrap items-end gap-3 mt-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">De</label>
            <input
              type="date"
              value={since}
              onChange={e => setSince(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Até</label>
            <input
              type="date"
              value={until}
              onChange={e => setUntil(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            onClick={() => load(false)}
            disabled={status === 'loading'}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${status === 'loading' ? 'animate-spin' : ''}`} />
            {status === 'loading' ? 'Carregando…' : 'Atualizar'}
          </button>
          <button
            onClick={() => load(true)}
            disabled={status === 'loading'}
            className="flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-50 hover:bg-muted/60"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Forçar Atualização
          </button>
          {lastFetchedAt && (
            <span className="text-[11px] text-muted-foreground">
              cache: {new Date(lastFetchedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <div className="flex gap-2 ml-auto text-xs text-muted-foreground items-center">
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono">Prefixo: {prefix}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono">Meta: campanhas {spendFilter}</span>
            <span className="rounded-full bg-muted px-2 py-0.5">Busca ampliada ✓</span>
          </div>
        </div>
      </div>

      {status === 'loading' && <TabLoading />}
      {status === 'error' && <TabError message={errorMsg ?? 'Erro ao carregar'} onRetry={load} />}

      {status === 'idle' && !data && (
        <div className="rounded-lg border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          Selecione o período e clique em <strong>Atualizar</strong> para carregar os dados do lançamento.
        </div>
      )}

      {status === 'idle' && data && (
        <>
          {/* KPIs + Tags + Gráfico */}
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-x-4 px-4 py-2 border-b bg-muted/40">
              <span className="text-sm font-semibold">
                Lançamento: <span style={{ color: CHART_COLORS[1] }}>{nome}</span>
              </span>
              <span className="text-xs text-muted-foreground">{data.dateRange.since} → {data.dateRange.until}</span>
            </div>

            <div className="flex flex-wrap gap-px border-b">
              {[
                { label: 'Total leads', value: data.totalUniqueAll.toLocaleString('pt-BR'), color: CHART_COLORS[1], sub: 'histórico (tags + UTM)' },
                { label: 'No período', value: data.totalUnique.toLocaleString('pt-BR'), color: CHART_COLORS[0], sub: data.dateRange.since + ' → ' + data.dateRange.until },
                { label: 'Soma bruta', value: data.sumByTag.toLocaleString('pt-BR'), color: '#888', sub: 'c/ duplicatas (tags)' },
                { label: 'Sobreposição', value: data.overlap > 0 ? data.overlap.toLocaleString('pt-BR') : '0', color: data.overlap > 0 ? '#c17c74' : '#7c9885', sub: 'em múltiplas tags' },
                ...(interactionStats != null ? [
                  { label: 'Vendas c/ interação', value: interactionStats.with.toLocaleString('pt-BR'), color: CHART_COLORS[1], sub: 'lead captado no período → comprou' },
                  { label: 'Vendas s/ interação', value: interactionStats.without.toLocaleString('pt-BR'), color: CHART_COLORS[3], sub: 'comprou sem lead no período' },
                ] : []),
              ].map(s => (
                <div key={s.label} className="flex-1 min-w-[100px] px-4 py-2">
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  <p className="text-lg font-bold tabular-nums leading-tight" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-[9px] text-muted-foreground truncate">{s.sub}</p>
                </div>
              ))}
            </div>

            <div className="grid lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x">
              {/* Tags */}
              <table className="w-full text-xs">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="px-3 py-1 text-left font-medium">Tag</th>
                    <th className="px-3 py-1 text-right font-medium">Período</th>
                    <th className="px-3 py-1 text-right font-medium">Histórico</th>
                    <th className="px-2 py-1 w-20"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.byTag.map((t, i) => (
                    <tr key={t.tag} className="hover:bg-muted/40">
                      <td className="px-3 py-1 font-medium truncate max-w-[160px]" title={t.tag}>{t.tag}</td>
                      <td className="px-3 py-1 text-right tabular-nums">
                        {t.countPeriod > 0 ? t.countPeriod.toLocaleString('pt-BR') : <span className="text-muted-foreground">0</span>}
                      </td>
                      <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">{t.countAll.toLocaleString('pt-BR')}</td>
                      <td className="px-2 py-1">
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${(t.countAll / maxTagCount) * 100}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data.overlap > 0 && (
                    <tr className="bg-muted/20">
                      <td className="px-3 py-1 text-[10px] text-muted-foreground italic" colSpan={4}>
                        sobreposição −{data.overlap.toLocaleString('pt-BR')} · único período: <strong style={{ color: CHART_COLORS[1] }}>{data.totalUnique.toLocaleString('pt-BR')}</strong>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Gráfico */}
              {data.leadsByDay.length > 0 ? (
                <div className="p-3">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Captação diária</p>
                  <ResponsiveContainer width="100%" height={120}>
                    <LineChart data={data.leadsByDay} margin={{ top: 2, right: 8, left: -24, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={v => v.slice(5)} />
                      <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Line type="monotone" dataKey="count" name="Leads" stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex items-center justify-center p-6 text-xs text-muted-foreground">Sem dados de captação no período</div>
              )}
            </div>
          </div>

          {/* Meta Ads spend */}
          {data.metaSpend !== undefined && (() => {
            const brl2 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            const campaigns = data.metaCampaigns ?? []

            // Gasto Captura: campanhas com ba25 E captura, sem engajamento
            const gastoCaptura = campaigns
              .filter(c => { const n = c.name.toLowerCase(); return n.includes('ba25') && n.includes('captura') && !n.includes('engajamento') })
              .reduce((s, c) => s + c.spend, 0)

            const leadsCaptura = data.byTag.find(t => t.tag === 'BA25-Captura-Tráfego')?.countPeriod ?? 0
            const totalLeads = data.totalUnique

            const cpl  = totalLeads > 0 && gastoCaptura > 0 ? gastoCaptura / totalLeads : null
            const cplc = leadsCaptura > 0 && gastoCaptura > 0 ? gastoCaptura / leadsCaptura : null

            return (
              <div className="rounded-lg border bg-card overflow-hidden">
                <div className="flex flex-wrap gap-px">
                  {[
                    { label: 'Gasto Meta Ads', value: `R$ ${brl2(data.metaSpend)}`, sub: `${campaigns.length} campanha(s)`, color: CHART_COLORS[3] },
                    { label: 'Gasto Captura', value: `R$ ${brl2(gastoCaptura)}`, sub: 'BA25 + Captura, sem Engajamento', color: CHART_COLORS[0] },
                    { label: 'CPL', value: cpl != null ? `R$ ${brl2(cpl)}` : '—', sub: 'gasto captura ÷ total leads', color: CHART_COLORS[4] },
                    { label: 'CPLC', value: cplc != null ? `R$ ${brl2(cplc)}` : '—', sub: 'gasto captura ÷ leads captura', color: CHART_COLORS[2] },
                  ].map(k => (
                    <div key={k.label} className="flex-1 min-w-[140px] px-4 py-3">
                      <p className="text-[10px] text-muted-foreground">{k.label}</p>
                      <p className="text-lg font-bold tabular-nums leading-tight" style={{ color: k.color }}>{k.value}</p>
                      <p className="text-[9px] text-muted-foreground">{k.sub}</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Top 5 Anúncios */}
          {captureAdLeads.length > 0 && (
            <TopAdsBlock
              byLeads={captureAdLeads}
              salesByContent={salesUtmData?.byContent}
              spendByContent={data.spendByUtm?.content}
              prefix={prefix}
            />
          )}

          {/* Metas × Realizado */}
          {goals && (() => {
            // Leads realizados por tag exata (metas de leads)
            function leadsForTag(tag: string) {
              return data!.byTag.find(t => t.tag === tag)?.countPeriod ?? 0
            }
            const leadsTrafico  = leadsForTag('BA25-Captura-Tráfego')
            const leadsOrganico = leadsForTag('BA25-Captura-Orgânico')
            const leadsManychat = leadsForTag('BA25-Captura-Manychat')
            const totalLeadsRealizados = leadsTrafico + leadsOrganico + leadsManychat
            const totalMetaLeads = goals.metaLeadsTrafico + goals.metaLeadsOrganico + goals.metaLeadsManychat

            // Gasto por fase: usa metaCampaigns como fonte única (mesma fonte do KPI)
            function spendFor(predicate: (name: string) => boolean) {
              const campaigns = data!.metaCampaigns
              if (!campaigns?.length) return null
              return campaigns
                .filter(c => predicate(c.name.toLowerCase()))
                .reduce((s, c) => s + c.spend, 0)
            }

            // Leads por tag keyword (coluna "Leads (tag)" da tabela de fases)
            function leadsForKeyword(keyword: string) {
              return data!.byTag
                .filter(t => t.tag.toLowerCase().includes(keyword.toLowerCase()))
                .reduce((s, t) => s + t.countPeriod, 0)
            }

            const fases = [
              {
                label: 'Captura',
                keyword: goals.tagsReferencia.captura,
                orcamento: goals.orcamentoPorFase.captura,
                leads: leadsForKeyword(goals.tagsReferencia.captura),
                spendFn: (k: string) => k.includes('ba25') && k.includes('captura') && !k.includes('engajamento'),
              },
              {
                label: 'Descoberta',
                keyword: goals.tagsReferencia.descoberta,
                orcamento: goals.orcamentoPorFase.descoberta,
                leads: leadsForKeyword(goals.tagsReferencia.descoberta),
                spendFn: (k: string) => k.includes('instagram'),
              },
              {
                label: 'Aquecimento',
                keyword: goals.tagsReferencia.aquecimento,
                orcamento: goals.orcamentoPorFase.aquecimento,
                leads: leadsForKeyword(goals.tagsReferencia.aquecimento),
                spendFn: (k: string) => k.includes('engajamento'),
              },
              {
                label: 'Lembrete',
                keyword: goals.tagsReferencia.lembrete,
                orcamento: goals.orcamentoPorFase.lembrete,
                leads: leadsForKeyword(goals.tagsReferencia.lembrete),
                spendFn: (k: string) => k.includes('lembrete'),
              },
              {
                label: 'Remarketing',
                keyword: goals.tagsReferencia.remarketing,
                orcamento: goals.orcamentoPorFase.remarketing,
                leads: leadsForKeyword(goals.tagsReferencia.remarketing),
                spendFn: (k: string) => k.includes('remarketing'),
              },
            ]

            const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            const pct = (real: number, meta: number) => meta > 0 ? Math.min((real / meta) * 100, 999) : 0

            function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
              const p = Math.min((value / Math.max(max, 1)) * 100, 100)
              return (
                <div className="h-1.5 rounded-full bg-muted overflow-hidden w-full">
                  <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, backgroundColor: color }} />
                </div>
              )
            }

            function StatusBadge({ value, max }: { value: number; max: number }) {
              const p = max > 0 ? (value / max) * 100 : 0
              if (p >= 100) return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Atingido</span>
              if (p >= 70) return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">Em curso</span>
              return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Abaixo</span>
            }

            // Dias restantes até fim da captação (inclusive hoje)
            const parseFinalDate = (s: string) => {
              const [d, m, y] = s.split('/').map(Number)
              return new Date(y, m - 1, d)
            }
            const today = new Date(); today.setHours(0,0,0,0)
            const finalDate = parseFinalDate(goals.finalCaptacao)
            const diasRestantes = Math.max(1, Math.ceil((finalDate.getTime() - today.getTime()) / 86400000) + 1)

            return (
              <div className="space-y-4">
                <SectionHeader
                  title="Metas × Realizado"
                  description={`Planilha de metas: ${goals.inicioCaptacao} → ${goals.finalCaptacao} · ${diasRestantes} dia(s) restante(s)`}
                />

                {/* Leads: metas gerais */}
                <div className="rounded-lg border bg-card overflow-hidden">
                  <div className="px-4 py-2 border-b bg-muted/40">
                    <p className="text-xs font-semibold">Metas de Leads</p>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-xs">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Categoria</th>
                        <th className="px-3 py-2 text-right font-medium">Meta</th>
                        <th className="px-3 py-2 text-right font-medium">Realizado</th>
                        <th className="px-3 py-2 text-right font-medium">%</th>
                        <th className="px-3 py-2 text-right font-medium">Faltam</th>
                        <th className="px-3 py-2 text-right font-medium">Meta/dia</th>
                        <th className="px-3 py-2 w-28"></th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {[
                        { label: 'Total (tráfego + orgânico + manychat)', meta: totalMetaLeads, real: totalLeadsRealizados, color: CHART_COLORS[0] },
                        { label: 'Tráfego pago (Meta Ads)', meta: goals.metaLeadsTrafico, real: leadsTrafico, color: CHART_COLORS[1] },
                        { label: 'Orgânico', meta: goals.metaLeadsOrganico, real: leadsOrganico, color: CHART_COLORS[2] },
                        { label: 'ManyChat', meta: goals.metaLeadsManychat, real: leadsManychat, color: CHART_COLORS[3] },
                      ].map(row => (
                        <tr key={row.label} className="hover:bg-muted/40">
                          <td className="px-3 py-2 font-medium">{row.label}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.meta.toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: row.color }}>{row.real.toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{pct(row.real, row.meta).toFixed(1)}%</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {row.real >= row.meta ? <span className="text-green-600 dark:text-green-400">—</span> : (row.meta - row.real).toLocaleString('pt-BR')}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.real >= row.meta
                              ? <span className="text-green-600 dark:text-green-400">—</span>
                              : <span className="font-medium" style={{ color: row.color }}>{Math.ceil((row.meta - row.real) / diasRestantes).toLocaleString('pt-BR')}/dia</span>}
                          </td>
                          <td className="px-3 py-2"><ProgressBar value={row.real} max={row.meta} color={row.color} /></td>
                          <td className="px-3 py-2"><StatusBadge value={row.real} max={row.meta} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Orçamento por fase */}
                <div className="rounded-lg border bg-card overflow-hidden">
                  <div className="px-4 py-2 border-b bg-muted/40">
                    <p className="text-xs font-semibold">Orçamento por Fase × Gasto Real (Meta Ads)</p>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-xs">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Fase</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Tag/Campanha</th>
                        <th className="px-3 py-2 text-right font-medium">Orçamento</th>
                        <th className="px-3 py-2 text-right font-medium">Investido</th>
                        <th className="px-3 py-2 text-right font-medium">%</th>
                        <th className="px-3 py-2 text-right font-medium">Leads (tag)</th>
                        <th className="px-3 py-2 text-right font-medium">CPL</th>
                        <th className="px-3 py-2 w-24"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {fases.map((fase, i) => {
                        const gasto = spendFor(fase.spendFn) ?? 0
                        const cplFase = gasto > 0 && fase.leads > 0 ? gasto / fase.leads : null
                        return (
                          <tr key={fase.label} className="hover:bg-muted/40">
                            <td className="px-3 py-2 font-medium">{fase.label}</td>
                            <td className="px-3 py-2 text-muted-foreground text-xs font-mono">{fase.keyword}</td>
                            <td className="px-3 py-2 text-right tabular-nums">R$ {brl(fase.orcamento)}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}>
                              {data!.spendByUtm?.campaign ? `R$ ${brl(gasto)}` : '—'}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {data!.spendByUtm?.campaign ? `${pct(gasto, fase.orcamento).toFixed(1)}%` : '—'}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{fase.leads > 0 ? fase.leads.toLocaleString('pt-BR') : <span className="text-muted-foreground">0</span>}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {cplFase != null ? `R$ ${brl(cplFase)}` : '—'}
                            </td>
                            <td className="px-3 py-2">
                              {data!.spendByUtm?.campaign && <ProgressBar value={gasto} max={fase.orcamento} color={CHART_COLORS[i % CHART_COLORS.length]} />}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="border-t-2 bg-muted/30 font-semibold text-xs">
                      <tr>
                        <td className="px-3 py-2" colSpan={2}>Total</td>
                        <td className="px-3 py-2 text-right tabular-nums">R$ {brl(goals.orcamentoTotal)}</td>
                        <td className="px-3 py-2 text-right tabular-nums" style={{ color: CHART_COLORS[0] }}>
                          {data!.metaSpend !== undefined ? `R$ ${brl(data!.metaSpend)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {data!.metaSpend !== undefined ? `${pct(data!.metaSpend, goals.orcamentoTotal).toFixed(1)}%` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{data!.totalUnique.toLocaleString('pt-BR')}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {data!.cpl != null ? `R$ ${brl(data!.cpl)}` : '—'}
                        </td>
                        <td className="px-3 py-2" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )
          })()}

          {/* Distribuição de vendas por UTM (gráficos de pizza) */}
          {salesUtmData && salesUtmData.totalBuyers > 0 && (
            <div className="space-y-3">
              {/* Bloco 1: última UTM antes da compra */}
              <div className="rounded-lg border bg-card overflow-hidden">
                <div className="px-4 py-2 border-b bg-muted/40 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Distribuição de Vendas por UTM — Última UTM antes da compra</p>
                  <p className="text-xs text-muted-foreground">
                    {salesUtmData.totalBuyers} compradores · desde {since}
                  </p>
                </div>
                <div className="p-4 grid grid-cols-2 xl:grid-cols-4 gap-6">
                  <SalesPieChart title="Fonte (utm_source)"     rows={salesUtmData.bySource   ?? []} field="lastBefore" />
                  <SalesPieChart title="Público (utm_medium)"   rows={salesUtmData.byMedium   ?? []} field="lastBefore" />
                  <SalesPieChart title="Campanha"               rows={salesUtmData.byCampaign ?? []} field="lastBefore" />
                  <SalesPieChart title="Criativo (utm_content)" rows={salesUtmData.byContent  ?? []} field="lastBefore" />
                </div>
              </div>

              {/* Bloco 2: primeira UTM do comprador (origem) */}
              <div className="rounded-lg border bg-card overflow-hidden">
                <div className="px-4 py-2 border-b bg-muted/40 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Distribuição de Vendas por UTM — UTM de origem do comprador</p>
                  <p className="text-xs text-muted-foreground">
                    {salesUtmData.totalBuyers} compradores · desde {since}
                  </p>
                </div>
                <div className="p-4 grid grid-cols-2 xl:grid-cols-4 gap-6">
                  <SalesPieChart title="Fonte (utm_source)"     rows={salesUtmData.bySource   ?? []} field="origin" />
                  <SalesPieChart title="Público (utm_medium)"   rows={salesUtmData.byMedium   ?? []} field="origin" />
                  <SalesPieChart title="Campanha"               rows={salesUtmData.byCampaign ?? []} field="origin" />
                  <SalesPieChart title="Criativo (utm_content)" rows={salesUtmData.byContent  ?? []} field="origin" />
                </div>
              </div>

              {/* Distribuições: tempo até compra + registros na base */}
              {((salesUtmData.daysToConvert?.length ?? 0) > 0 || (salesUtmData.tagCountDist?.length ?? 0) > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <DistributionBarChart
                    title="Tempo na base até a compra"
                    description="Dias entre o primeiro registro do lead e a data de compra"
                    data={salesUtmData.daysToConvert ?? []}
                    color={CHART_COLORS[1]}
                  />
                  <DistributionBarChart
                    title="Registros na base por comprador"
                    description="Número de tags distintas que o comprador possui na base"
                    data={salesUtmData.tagCountDist ?? []}
                    color={CHART_COLORS[2]}
                  />
                </div>
              )}

              {/* Drill-down interativo Campanha → Público → Criativo */}
              {(salesUtmData.drilldown?.length ?? 0) > 0 && (
                <CampaignDrilldown drilldown={salesUtmData.drilldown ?? []} />
              )}
            </div>
          )}

          {/* Pesquisa de boas-vindas × Compradores */}
          {surveyData && (
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="px-4 py-2.5 border-b bg-muted/40 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">Perfil dos Compradores — Pesquisa de Boas-Vindas</p>
                  <p className="text-xs text-muted-foreground">
                    {surveyData.surveyMatches > 0
                      ? `${surveyData.surveyMatches} de ${surveyData.totalBuyers} compradores responderam (${surveyData.totalBuyers > 0 ? Math.round((surveyData.surveyMatches / surveyData.totalBuyers) * 100) : 0}%)`
                      : `${surveyData.totalBuyers} comprador(es) · nenhum encontrado na pesquisa`}
                  </p>
                </div>
              </div>
              {surveyData.surveyMatches === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Nenhum comprador encontrado na planilha de pesquisa. Verifique se a planilha está com acesso público e se os e-mails coincidem.
                </div>
              ) : (
                <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {surveyData.byAge.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Qual sua idade?</p>
                      <SurveyBar data={surveyData.byAge} color={CHART_COLORS[0]} />
                    </div>
                  )}
                  {surveyData.byPhase.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Em que fase da sua formação você está?</p>
                      <SurveyBar data={surveyData.byPhase} color={CHART_COLORS[2]} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Receita por UTM + CPV por Fase */}
          {profileData && profileData.totalBuyers > 0 && (() => {
            const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

            // Mapas de spend e leads por UTM (do meta-spend, já disponível em data)
            const spendCampaign = data?.spendByUtm?.campaign ?? {}
            const spendMedium   = data?.spendByUtm?.medium   ?? {}
            const spendContent  = data?.spendByUtm?.content  ?? {}

            // Mapa de leads por UTM (para CPL)
            const leadsFromArr = (arr: { name: string; value: number }[]) =>
              Object.fromEntries(arr.map(r => [r.name, r.value]))
            const leadsCampaign = leadsFromArr(data?.byCampaign ?? [])
            const leadsMedium   = leadsFromArr(data?.byMedium   ?? [])
            const leadsContent  = leadsFromArr(data?.byContent  ?? [])

            // CPV por fase via atribuição proporcional (fase × campanha × spend)
            const campaignBuyersMap: Record<string, number> = {}
            for (const c of profileData.byCampaign) campaignBuyersMap[c.name] = c.buyers

            const phaseSpend: Record<string, number> = {}
            for (const { phase, campaign, buyers } of profileData.phaseXCampaign) {
              const totalFromCampaign = campaignBuyersMap[campaign] ?? 1
              const spend = spendCampaign[campaign] ?? 0
              phaseSpend[phase] = (phaseSpend[phase] ?? 0) + spend * (buyers / totalFromCampaign)
            }

            const totalSpend  = data?.metaSpend ?? 0
            const globalCpv   = profileData.totalBuyers > 0 ? totalSpend / profileData.totalBuyers : null

            return (
              <div className="space-y-3">
                {/* Header */}
                <div className="rounded-lg border bg-card overflow-hidden">
                  <div className="px-4 py-2.5 border-b bg-muted/40 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">Receita por UTM — CPL · ROAS · CPV</p>
                      <p className="text-xs text-muted-foreground">
                        {profileData.totalBuyers} compradores · Receita total: R$ {brl(profileData.totalRevenue)}
                        {globalCpv != null && ` · CPV global: R$ ${brl(globalCpv)}`}
                      </p>
                    </div>
                  </div>
                  <div className="p-4 space-y-5">
                    {profileData.byCampaign.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Por Campanha (utm_campaign)</p>
                        <RevenueTable
                          rows={profileData.byCampaign}
                          spendMap={spendCampaign}
                          leadsMap={leadsCampaign}
                        />
                      </div>
                    )}
                    {profileData.byMedium.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Por Público (utm_medium)</p>
                        <RevenueTable
                          rows={profileData.byMedium}
                          spendMap={spendMedium}
                          leadsMap={leadsMedium}
                        />
                      </div>
                    )}
                    {profileData.byContent.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Por Criativo (utm_content)</p>
                        <RevenueTable
                          rows={profileData.byContent}
                          spendMap={spendContent}
                          leadsMap={leadsContent}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* CPV por fase */}
                {profileData.byPhase.length > 0 && (
                  <div className="rounded-lg border bg-card overflow-hidden">
                    <div className="px-4 py-2.5 border-b bg-muted/40">
                      <p className="text-sm font-semibold">CPV por Fase de Formação</p>
                      <p className="text-xs text-muted-foreground">
                        {profileData.surveyMatches} de {profileData.totalBuyers} compradores responderam a pesquisa
                        {' · '}CPV via atribuição proporcional à campanha de entrada
                      </p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/60">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">Fase de Formação</th>
                            <th className="px-3 py-2 text-right font-medium">Vendas</th>
                            <th className="px-3 py-2 text-right font-medium">%</th>
                            <th className="px-3 py-2 text-right font-medium">Receita</th>
                            <th className="px-3 py-2 text-right font-medium">Ticket Médio</th>
                            {totalSpend > 0 && <th className="px-3 py-2 text-right font-medium">CPV (atrib.)</th>}
                            <th className="px-3 py-2 w-24"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {profileData.byPhase.map(p => {
                            const cpv = phaseSpend[p.name] != null && p.buyers > 0
                              ? phaseSpend[p.name] / p.buyers : null
                            const pct = profileData.surveyMatches > 0 ? (p.buyers / profileData.surveyMatches) * 100 : 0
                            return (
                              <tr key={p.name} className="hover:bg-muted/40">
                                <td className="px-3 py-2 font-medium">{p.name}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{p.buyers}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{pct.toFixed(1)}%</td>
                                <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: CHART_COLORS[1] }}>
                                  R$ {brl(p.revenue)}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">R$ {brl(p.avgTicket)}</td>
                                {totalSpend > 0 && (
                                  <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: CHART_COLORS[0] }}>
                                    {cpv != null ? `R$ ${brl(cpv)}` : '—'}
                                  </td>
                                )}
                                <td className="px-3 py-2">
                                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[2] }} />
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Acordeão: UTMs + Evolução diária + Campanhas */}
          <div className="space-y-2">
            <AccordionItem title="Análise de UTMs">
              <div className="p-4 grid gap-6 lg:grid-cols-2">
                {data.bySource.length > 0 && (
                  <UtmTable
                    title="Fonte (utm_source)"
                    rows={data.bySource}
                    total={data.totalUnique}
                    color={CHART_COLORS[0]}
                    getCpl={makeGetCpl(data.spendByUtm?.source)}
                    cplNote="CPL calculado a partir do gasto real dos anúncios com esse utm_source no período."
                    salesRows={salesUtmData?.bySource}
                    totalBuyers={salesUtmData?.totalBuyers}
                  />
                )}
                {data.byMedium.length > 0 && (
                  <UtmTable
                    title="Público (utm_medium)"
                    rows={data.byMedium}
                    total={data.totalUnique}
                    color={CHART_COLORS[1]}
                    hint="Corresponde ao nome do conjunto de anúncios (adset), ex: Env7d_Visitantes180d."
                    getCpl={makeGetCpl(data.spendByUtm?.medium)}
                    cplNote="CPL calculado a partir do gasto real por conjunto de anúncios (adset) no período."
                    salesRows={salesUtmData?.byMedium}
                    totalBuyers={salesUtmData?.totalBuyers}
                  />
                )}
                {data.byCampaign.length > 0 && (
                  <UtmTable
                    title="Campanha (utm_campaign)"
                    rows={data.byCampaign}
                    total={data.totalUnique}
                    color={CHART_COLORS[2]}
                    getCpl={makeGetCpl(data.spendByUtm?.campaign)}
                    cplNote="CPL calculado a partir do gasto real da campanha no período."
                    salesRows={salesUtmData?.byCampaign}
                    totalBuyers={salesUtmData?.totalBuyers}
                  />
                )}
                {data.byContent.filter(r => r.name !== '(não informado)').length > 0 && (
                  <UtmTable
                    title="Criativo (utm_content)"
                    rows={data.byContent}
                    total={data.totalUnique}
                    color={CHART_COLORS[3]}
                    hint="Corresponde ao nome do anúncio (ad), ex: Ad_Captura_22."
                    getCpl={makeGetCpl(data.spendByUtm?.content)}
                    cplNote="CPL calculado a partir do gasto real por anúncio no período."
                    salesRows={salesUtmData?.byContent}
                    totalBuyers={salesUtmData?.totalBuyers}
                  />
                )}
              </div>
            </AccordionItem>

            <AccordionItem title="Evolução Diária">
            {(data.leadsByDay.length > 0 || (data.dailyMeta?.length ?? 0) > 0) ? (() => {
            const leadsMap = new Map(data.leadsByDay.map(d => [d.date, d.count]))
            const metaMap = new Map((data.dailyMeta ?? []).map(d => [d.date, d]))
            const allDates = [...new Set([...leadsMap.keys(), ...metaMap.keys()])].sort()
            const hasMeta = (data.dailyMeta?.length ?? 0) > 0

            const totLeads = allDates.reduce((s, d) => s + (leadsMap.get(d) ?? 0), 0)
            const totSpend = allDates.reduce((s, d) => s + (metaMap.get(d)?.spend ?? 0), 0)
            const totClicks = allDates.reduce((s, d) => s + (metaMap.get(d)?.linkClicks ?? 0), 0)
            const totPv = allDates.reduce((s, d) => s + (metaMap.get(d)?.pageViews ?? 0), 0)

            return (
              <div className="p-4">
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-xs tabular-nums">
                    <thead className="bg-muted/60 text-[11px]">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-medium">Data</th>
                        {hasMeta && <th className="px-3 py-1.5 text-right font-medium">Investimento</th>}
                        <th className="px-3 py-1.5 text-right font-medium">Leads</th>
                        {hasMeta && <th className="px-3 py-1.5 text-right font-medium">CPL</th>}
                        {hasMeta && <th className="px-3 py-1.5 text-right font-medium">Cliques link</th>}
                        {hasMeta && <th className="px-3 py-1.5 text-right font-medium">Conv. %</th>}
                        {hasMeta && <th className="px-3 py-1.5 text-right font-medium">Page views</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {allDates.map(date => {
                        const leads = leadsMap.get(date) ?? 0
                        const m = metaMap.get(date)
                        const cplDay = m && leads > 0 ? m.spend / leads : null
                        const conv = m && m.linkClicks > 0 ? (leads / m.linkClicks) * 100 : null
                        return (
                          <tr key={date} className="hover:bg-muted/40">
                            <td className="px-3 py-1">{date.slice(5)}</td>
                            {hasMeta && (
                              <td className="px-3 py-1 text-right">
                                {m ? `R$ ${m.spend.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                              </td>
                            )}
                            <td className="px-3 py-1 text-right" style={{ color: leads > 0 ? CHART_COLORS[1] : undefined }}>
                              {leads > 0 ? leads.toLocaleString('pt-BR') : <span className="text-muted-foreground">0</span>}
                            </td>
                            {hasMeta && (
                              <td className="px-3 py-1 text-right text-muted-foreground">
                                {cplDay != null ? `R$ ${cplDay.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                              </td>
                            )}
                            {hasMeta && (
                              <td className="px-3 py-1 text-right">{m ? m.linkClicks.toLocaleString('pt-BR') : '—'}</td>
                            )}
                            {hasMeta && (
                              <td className="px-3 py-1 text-right text-muted-foreground">
                                {conv != null ? `${conv.toFixed(1)}%` : '—'}
                              </td>
                            )}
                            {hasMeta && (
                              <td className="px-3 py-1 text-right">{m ? m.pageViews.toLocaleString('pt-BR') : '—'}</td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="border-t-2 bg-muted/30 font-semibold">
                      <tr>
                        <td className="px-3 py-1.5 text-xs">Total</td>
                        {hasMeta && (
                          <td className="px-3 py-1.5 text-right">
                            R$ {totSpend.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        )}
                        <td className="px-3 py-1.5 text-right" style={{ color: CHART_COLORS[1] }}>
                          {totLeads.toLocaleString('pt-BR')}
                        </td>
                        {hasMeta && (
                          <td className="px-3 py-1.5 text-right text-muted-foreground">
                            {totLeads > 0 ? `R$ ${(totSpend / totLeads).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                          </td>
                        )}
                        {hasMeta && <td className="px-3 py-1.5 text-right">{totClicks.toLocaleString('pt-BR')}</td>}
                        {hasMeta && (
                          <td className="px-3 py-1.5 text-right text-muted-foreground">
                            {totClicks > 0 ? `${((totLeads / totClicks) * 100).toFixed(1)}%` : '—'}
                          </td>
                        )}
                        {hasMeta && <td className="px-3 py-1.5 text-right">{totPv.toLocaleString('pt-BR')}</td>}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )
          })() : <p className="p-4 text-xs text-muted-foreground">Sem dados no período.</p>}
            </AccordionItem>

            <AccordionItem title={`Campanhas Meta Ads (${data.metaCampaigns?.length ?? 0})`}>
              {(data.metaCampaigns?.length ?? 0) > 0 ? (
                <table className="w-full text-xs">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="px-3 py-1 text-left font-medium">Campanha</th>
                      <th className="px-3 py-1 text-right font-medium">Gasto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.metaCampaigns!.map(c => (
                      <tr key={c.name + c.spend} className="hover:bg-muted/40">
                        <td className="px-3 py-1">{c.name}</td>
                        <td className="px-3 py-1 text-right tabular-nums">
                          R$ {c.spend.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="p-4 text-xs text-muted-foreground">Sem campanhas.</p>}
            </AccordionItem>
          </div>
        </>

      )}

      {/* Tabela diagnóstico de emails de compradores */}
      {salesUtmData?.buyerSaleCounts && salesUtmData.buyerSaleCounts.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-muted/40">
            <p className="text-sm font-semibold">Emails de Compradores</p>
            <p className="text-xs text-muted-foreground">
              {salesUtmData.buyerSaleCounts.length} emails únicos · {salesUtmData.totalSales ?? salesUtmData.buyerSaleCounts.reduce((s, r) => s + r.count, 0)} transações · emails com <code>(Nx)</code> aparecem mais de uma vez
            </p>
          </div>
          <div className="p-4">
            <textarea
              readOnly
              className="w-full rounded-md border bg-muted/30 px-3 py-2 text-xs font-mono h-48 resize-y focus:outline-none"
              value={[...salesUtmData.buyerSaleCounts]
                .sort((a, b) => b.count - a.count || a.email.localeCompare(b.email))
                .map(r => r.count > 1 ? `${r.email}  (${r.count}x)` : r.email)
                .join('\n')}
            />
          </div>
        </div>
      )}

    </div>
  )
}
