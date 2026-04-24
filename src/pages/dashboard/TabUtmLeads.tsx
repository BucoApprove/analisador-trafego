import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { SectionHeader, TabLoading, CHART_COLORS } from './components'
import { Button } from '@/components/ui/button'
import { Play, Search, RefreshCw, ChevronDown } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid,
} from 'recharts'

interface Props { token: string; enabled: boolean }

// ─── Types ────────────────────────────────────────────────────────────────────

interface UtmDist {
  name: string
  count: number
  pct: number
}

interface DimGroup {
  bySource:   UtmDist[]
  byCampaign: UtmDist[]
  byMedium:   UtmDist[]
  byContent:  UtmDist[]
}

interface DistributionData extends DimGroup {
  totalLeads: number
  since: string
  until: string
}

interface CrossoverData {
  matchedLeads: number
  utmField: string
  utmValue: string
  crossMode: string
  since: string | null
  until: string | null
  anyBefore: DimGroup
  lastBefore: DimGroup
}

interface UtmSalesAttribution {
  name: string
  anyTime: number
  lastBefore: number
  origin: number
}

interface SalesData {
  totalBuyers: number
  since: string
  until: string
  bySource:     UtmSalesAttribution[]
  byMedium:     UtmSalesAttribution[]
  byCampaign:   UtmSalesAttribution[]
  byContent:    UtmSalesAttribution[]
  daysToConvert: { label: string; count: number }[]
  tagCountDist:  { label: string; count: number }[]
  drilldown:     { source: string; campaign: string; medium: string; content: string; count: number }[]
}

type DimKey = 'source' | 'campaign' | 'medium' | 'content'
type AttrMode = 'anyTime' | 'lastBefore' | 'origin'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function lastWeekStr() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().split('T')[0]
}

function firstOfMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

const DIM_LABELS: Record<DimKey, string> = {
  source:   'utm_source',
  campaign: 'utm_campaign',
  medium:   'utm_medium',
  content:  'utm_content',
}

const PIE_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#8b5cf6', '#f97316', '#06b6d4']

// ─── UTM Horizontal Bar Chart ─────────────────────────────────────────────────

function UtmBarChart({ data, color }: { data: UtmDist[]; color: string }) {
  const [showAll, setShowAll] = useState(false)
  const display = showAll ? data : data.slice(0, 10)

  if (display.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">Sem dados</p>
  }

  return (
    <div className="space-y-2">
      <ResponsiveContainer width="100%" height={Math.max(140, display.length * 26)}>
        <BarChart layout="vertical" data={display} margin={{ left: 8, right: 50 }}>
          <XAxis type="number" tick={{ fontSize: 10 }} />
          <YAxis
            type="category"
            dataKey="name"
            width={150}
            tick={{ fontSize: 10 }}
            tickFormatter={(v: string) => v.length > 24 ? v.slice(0, 24) + '…' : v}
          />
          <Tooltip
            formatter={(v, _name, props: any) => [
              `${Number(v).toLocaleString('pt-BR')} leads (${props.payload?.pct ?? 0}%)`,
              'Leads',
            ]}
          />
          <Bar dataKey="count" fill={color} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
      {data.length > 10 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="text-xs text-primary hover:underline"
        >
          {showAll ? 'Ver menos' : `Ver todos (${data.length})`}
        </button>
      )}
    </div>
  )
}

// ─── Dim Charts Grid (leads) ──────────────────────────────────────────────────

function DimChartsGrid({ dims, suffix = '' }: { dims: DimGroup; suffix?: string }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="rounded-lg border p-4 space-y-3">
        <p className="text-sm font-semibold">utm_source{suffix}</p>
        <UtmBarChart data={dims.bySource} color={CHART_COLORS[0]} />
      </div>
      <div className="rounded-lg border p-4 space-y-3">
        <p className="text-sm font-semibold">utm_campaign{suffix}</p>
        <UtmBarChart data={dims.byCampaign} color={CHART_COLORS[1]} />
      </div>
      <div className="rounded-lg border p-4 space-y-3">
        <p className="text-sm font-semibold">utm_medium{suffix}</p>
        <UtmBarChart data={dims.byMedium} color={CHART_COLORS[2]} />
      </div>
      <div className="rounded-lg border p-4 space-y-3">
        <p className="text-sm font-semibold">utm_content{suffix}</p>
        <UtmBarChart data={dims.byContent} color={CHART_COLORS[3]} />
      </div>
    </div>
  )
}

// ─── UTM Value Picker ────────────────────────────────────────────────────────

function UtmValuePicker({ options, value, onChange }: {
  options: UtmDist[]
  value: string
  onChange: (v: string) => void
}) {
  const [filter, setFilter] = useState('')
  const filtered = filter
    ? options.filter(o => o.name.toLowerCase().includes(filter.toLowerCase()))
    : options

  useEffect(() => {
    if (value === '') setFilter('')
  }, [value])

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">Valor da UTM</p>
      <input
        className="w-full max-w-sm rounded border px-2 py-1.5 text-sm"
        placeholder={options.length > 0 ? `Filtrar ${options.length} valores…` : 'Ex: BA25-VENDAS'}
        value={filter}
        onChange={e => { setFilter(e.target.value); onChange(e.target.value) }}
      />
      {options.length > 0 && (
        <div className="max-w-sm max-h-48 overflow-y-auto rounded border bg-background divide-y text-sm">
          {filtered.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Nenhum valor encontrado</p>
          )}
          {filtered.map(o => (
            <button
              key={o.name}
              type="button"
              onClick={() => { onChange(o.name); setFilter(o.name) }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center justify-between gap-2 ${
                value === o.name ? 'bg-primary/10 font-medium text-primary' : ''
              }`}
            >
              <span className="truncate">{o.name}</span>
              <span className="shrink-0 text-muted-foreground">{o.count.toLocaleString('pt-BR')}</span>
            </button>
          ))}
        </div>
      )}
      {options.length === 0 && (
        <p className="text-xs text-muted-foreground">Busque na seção acima para listar os valores disponíveis.</p>
      )}
    </div>
  )
}

// ─── Sales: gráfico de barras para distribuições ──────────────────────────────

function SalesDistBarChart({
  title,
  description,
  data,
  color,
}: {
  title: string
  description?: string
  data: { label: string; count: number }[]
  color: string
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
            <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
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

// ─── Sales: pizza de atribuição ───────────────────────────────────────────────

function SalesPieChart({
  title,
  rows,
  field,
}: {
  title: string
  rows: UtmSalesAttribution[]
  field: AttrMode
}) {
  const top = rows.slice(0, 7)
  const othersCount = rows.slice(7).reduce((s, r) => s + r[field], 0)
  const pieData = [
    ...top.map(r => ({ name: r.name, value: r[field] })),
    ...(othersCount > 0 ? [{ name: '(outros)', value: othersCount }] : []),
  ].filter(d => d.value > 0)
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
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={32} outerRadius={52} paddingAngle={2} dataKey="value">
                {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
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
                  <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
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

// ─── Sales: blocos de UTMs dos compradores (barras horizontais) ───────────────

function SalesUtmBarChart({ rows, field, color }: {
  rows: UtmSalesAttribution[]
  field: AttrMode
  color: string
}) {
  const [showAll, setShowAll] = useState(false)
  const data = rows.map(r => ({ name: r.name, count: r[field] })).filter(r => r.count > 0)
  const display = showAll ? data : data.slice(0, 10)

  if (display.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">Sem dados</p>
  }

  return (
    <div className="space-y-2">
      <ResponsiveContainer width="100%" height={Math.max(140, display.length * 26)}>
        <BarChart layout="vertical" data={display} margin={{ left: 8, right: 50 }}>
          <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={160}
            tick={{ fontSize: 10 }}
            tickFormatter={(v: string) => v.length > 26 ? v.slice(0, 26) + '…' : v}
          />
          <Tooltip
            formatter={(v) => [`${Number(v).toLocaleString('pt-BR')} compradores`, '']}
            contentStyle={{ fontSize: '11px' }}
          />
          <Bar dataKey="count" fill={color} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
      {data.length > 10 && (
        <button onClick={() => setShowAll(v => !v)} className="text-xs text-primary hover:underline">
          {showAll ? 'Ver menos' : `Ver todos (${data.length})`}
        </button>
      )}
    </div>
  )
}

// ─── Sales: accordion wrapper ─────────────────────────────────────────────────

function AccordionItem({ title, children, defaultOpen = false }: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
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
        className="overflow-hidden transition-all duration-200"
        style={{ maxHeight: open ? '9999px' : '0px' }}
      >
        <div className="border-t">{children}</div>
      </div>
    </div>
  )
}

// ─── Sales: drill-down Source → Campanha → Público → Criativo ────────────────

interface DrillRow { source: string; campaign: string; medium: string; content: string; count: number }

function DrillColumn({
  title,
  items,
  selected,
  onSelect,
  placeholder,
  color,
}: {
  title: string
  items: { name: string; count: number }[]
  selected: string | null
  onSelect: (name: string) => void
  placeholder?: string
  color: string
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
                  active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/70 text-foreground'
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
                      background: active ? 'rgba(255,255,255,0.7)' : color,
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

function SalesDrilldown({ drilldown }: { drilldown: DrillRow[] }) {
  const [selSource,   setSelSource]   = useState<string | null>(null)
  const [selCampaign, setSelCampaign] = useState<string | null>(null)
  const [selMedium,   setSelMedium]   = useState<string | null>(null)

  const filter = useCallback((rows: DrillRow[]) => {
    let r = rows
    if (selSource)   r = r.filter(d => d.source   === selSource)
    if (selCampaign) r = r.filter(d => d.campaign === selCampaign)
    if (selMedium)   r = r.filter(d => d.medium   === selMedium)
    return r
  }, [selSource, selCampaign, selMedium])

  const aggregate = (rows: DrillRow[], key: keyof DrillRow) => {
    const m = new Map<string, number>()
    for (const d of rows) m.set(d[key] as string, (m.get(d[key] as string) ?? 0) + d.count)
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  }

  const sources = useMemo(() => {
    const base = selMedium ? drilldown.filter(d => d.medium === selMedium) : drilldown
    const base2 = selCampaign ? base.filter(d => d.campaign === selCampaign) : base
    return aggregate(base2, 'source')
  }, [drilldown, selMedium, selCampaign])

  const campaigns = useMemo(() => {
    const base = selSource ? drilldown.filter(d => d.source === selSource) : drilldown
    const base2 = selMedium ? base.filter(d => d.medium === selMedium) : base
    return aggregate(base2, 'campaign')
  }, [drilldown, selSource, selMedium])

  const mediums = useMemo(() => {
    const base = selSource ? drilldown.filter(d => d.source === selSource) : drilldown
    const base2 = selCampaign ? base.filter(d => d.campaign === selCampaign) : base
    return aggregate(base2, 'medium')
  }, [drilldown, selSource, selCampaign])

  const contents = useMemo(() => aggregate(filter(drilldown), 'content'), [drilldown, filter])

  const toggle = <T extends string>(prev: T | null, next: T) => prev === next ? null : next

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b bg-muted/40">
        <p className="text-sm font-semibold">Drill-down: Fonte · Campanha · Público · Criativo</p>
        <p className="text-xs text-muted-foreground">Última UTM antes da compra · clique para cruzar filtros</p>
      </div>
      <div className="p-4 flex gap-0 divide-x overflow-x-auto">
        <div className="pr-4 flex-1 min-w-[160px]">
          <DrillColumn
            title="Fonte (utm_source)"
            items={sources}
            selected={selSource}
            onSelect={name => setSelSource(toggle(selSource, name))}
            color={CHART_COLORS[0]}
          />
        </div>
        <div className="px-4 flex-1 min-w-[160px]">
          <DrillColumn
            title="Campanha"
            items={campaigns}
            selected={selCampaign}
            onSelect={name => setSelCampaign(toggle(selCampaign, name))}
            color={CHART_COLORS[1]}
          />
        </div>
        <div className="px-4 flex-1 min-w-[160px]">
          <DrillColumn
            title="Público (utm_medium)"
            items={mediums}
            selected={selMedium}
            onSelect={name => setSelMedium(toggle(selMedium, name))}
            color={CHART_COLORS[2]}
          />
        </div>
        <div className="pl-4 flex-1 min-w-[160px]">
          <DrillColumn
            title="Criativo (utm_content)"
            items={contents}
            selected={null}
            onSelect={() => {}}
            color={CHART_COLORS[3]}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Sales: top ads convertidos ───────────────────────────────────────────────

function TopAdsTable({ rows, field }: { rows: UtmSalesAttribution[]; field: AttrMode }) {
  const sorted = [...rows].sort((a, b) => b[field] - a[field]).filter(r => r[field] > 0)
  const total = sorted.reduce((s, r) => s + r[field], 0)
  if (sorted.length === 0) return <p className="py-4 text-center text-xs text-muted-foreground">Sem dados</p>
  const maxVal = sorted[0][field]

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/60">
          <tr>
            <th className="px-3 py-2 text-left font-medium">utm_content (criativo)</th>
            <th className="px-3 py-2 text-right font-medium w-20">Vendas</th>
            <th className="px-3 py-2 text-right font-medium w-16">%</th>
            <th className="px-3 py-2 w-28"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sorted.map((r, i) => {
            const pct = total > 0 ? (r[field] / total) * 100 : 0
            return (
              <tr key={r.name} className="hover:bg-muted/40">
                <td className="px-3 py-1.5 font-medium truncate max-w-[280px]" title={r.name}>
                  <span className="text-muted-foreground mr-2 tabular-nums">{i + 1}.</span>
                  {r.name}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: CHART_COLORS[1] }}>
                  {r[field].toLocaleString('pt-BR')}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{pct.toFixed(1)}%</td>
                <td className="px-3 py-1.5">
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(r[field] / maxVal) * 100}%`, backgroundColor: CHART_COLORS[3] }}
                    />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Cache sessionStorage ─────────────────────────────────────────────────────

const CACHE_PREFIX = 'utm-leads-sales:'

interface CacheEntry { data: SalesData; ts: number }

function cacheKey(since: string, until: string, product: string) {
  return `${CACHE_PREFIX}${since}|${until}|${product.trim().toLowerCase()}`
}

function readCache(key: string): CacheEntry | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as CacheEntry) : null
  } catch { return null }
}

function writeCache(key: string, data: SalesData) {
  try { sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })) } catch { /* quota */ }
}

function formatTs(ts: number) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ─── Seção de Análise de Vendas ───────────────────────────────────────────────

const ATTR_LABELS: Record<AttrMode, string> = {
  anyTime:    'Qualquer interação',
  lastBefore: 'Última UTM antes',
  origin:     'UTM de origem',
}

function SalesSection({ token }: { token: string }) {
  const [since, setSince] = useState(firstOfMonthStr)
  const [until, setUntil] = useState(todayStr)
  const [productFilter, setProductFilter] = useState('buco approve')
  const [data, setData] = useState<SalesData | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attrMode, setAttrMode] = useState<AttrMode>('lastBefore')
  const initialLoadDone = useRef(false)

  // Carrega do cache ao montar (parâmetros iniciais)
  useEffect(() => {
    if (initialLoadDone.current) return
    initialLoadDone.current = true
    const key = cacheKey(since, until, productFilter)
    const cached = readCache(key)
    if (cached) {
      setData(cached.data)
      setLastUpdated(cached.ts)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetch_ = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ since, until, productFilter: productFilter.trim() })
      const res = await fetch(`/api/launch-sales-utms?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) { sessionStorage.removeItem('dashboard-token'); window.location.reload(); return }
      if (!res.ok) throw new Error(`Erro ${res.status}: ${await res.text()}`)
      const json: SalesData = await res.json()
      const key = cacheKey(since, until, productFilter)
      writeCache(key, json)
      setData(json)
      setLastUpdated(Date.now())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [since, until, productFilter, token])

  return (
    <div className="rounded-lg border p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <SectionHeader
          title="Análise de Vendas"
          description="Compradores do período cruzados com a base de leads — UTMs, tempo até compra e ads que mais converteram."
        />
        {lastUpdated && (
          <span className="text-[11px] text-muted-foreground whitespace-nowrap mt-0.5">
            Atualizado às {formatTs(lastUpdated)}
          </span>
        )}
      </div>

      {/* Controles */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Produto</label>
          <input
            className="rounded border px-2 py-1.5 text-sm w-44"
            value={productFilter}
            onChange={e => setProductFilter(e.target.value)}
            placeholder="ex: buco approve"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">De</label>
          <input type="date" className="rounded border px-2 py-1.5 text-sm" value={since} onChange={e => setSince(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Até</label>
          <input type="date" className="rounded border px-2 py-1.5 text-sm" value={until} onChange={e => setUntil(e.target.value)} />
        </div>
        <Button onClick={fetch_} disabled={loading}>
          {loading
            ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Buscando…</>
            : data
              ? <><RefreshCw className="mr-2 h-4 w-4" />Atualizar</>
              : <><Search className="mr-2 h-4 w-4" />Buscar</>
          }
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && <TabLoading />}

      {data && !loading && (
        <div className="space-y-5">

          {/* KPI */}
          <div className="flex flex-wrap gap-px rounded-lg border overflow-hidden">
            <div className="flex-1 min-w-[120px] px-4 py-3">
              <p className="text-[10px] text-muted-foreground">Vendas (compradores únicos)</p>
              <p className="text-2xl font-bold tabular-nums" style={{ color: CHART_COLORS[1] }}>
                {data.totalBuyers.toLocaleString('pt-BR')}
              </p>
              <p className="text-[9px] text-muted-foreground">{data.since} → {data.until}</p>
            </div>
            <div className="flex-1 min-w-[120px] px-4 py-3">
              <p className="text-[10px] text-muted-foreground">Produto (filtro)</p>
              <p className="text-sm font-semibold font-mono mt-1">{productFilter}</p>
            </div>
          </div>

          {data.totalBuyers === 0 && (
            <p className="text-center text-sm text-muted-foreground py-4">
              Nenhum comprador encontrado no período para o produto informado.
            </p>
          )}

          {data.totalBuyers > 0 && (
            <>
              {/* Toggle de atribuição */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground font-medium">Modo de atribuição:</span>
                {(Object.keys(ATTR_LABELS) as AttrMode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => setAttrMode(m)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      attrMode === m
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    {ATTR_LABELS[m]}
                  </button>
                ))}
              </div>

              {/* Distribuições */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <SalesDistBarChart
                  title="Tempo na base até a compra"
                  description="Dias entre o primeiro registro do lead e a data de compra"
                  data={data.daysToConvert}
                  color={CHART_COLORS[1]}
                />
                <SalesDistBarChart
                  title="Tags por comprador (registros na base)"
                  description="Número de tags distintas que o comprador possui na base de leads"
                  data={data.tagCountDist}
                  color={CHART_COLORS[2]}
                />
              </div>

              {/* UTMs dos compradores — pizza por dimensão */}
              <AccordionItem title="Distribuição de Vendas por UTM (gráficos de pizza)" defaultOpen>
                <div className="p-4 space-y-1">
                  <p className="text-xs text-muted-foreground mb-4">
                    Atribuição: <strong>{ATTR_LABELS[attrMode]}</strong>
                  </p>
                  <div className="grid grid-cols-2 xl:grid-cols-4 gap-6">
                    <SalesPieChart title="Fonte (utm_source)"     rows={data.bySource}   field={attrMode} />
                    <SalesPieChart title="Público (utm_medium)"   rows={data.byMedium}   field={attrMode} />
                    <SalesPieChart title="Campanha"               rows={data.byCampaign} field={attrMode} />
                    <SalesPieChart title="Criativo (utm_content)" rows={data.byContent}  field={attrMode} />
                  </div>
                </div>
              </AccordionItem>

              {/* UTMs dos compradores — barras por dimensão */}
              <AccordionItem title="UTMs dos Compradores — todos os valores por dimensão" defaultOpen>
                <div className="p-4 space-y-1">
                  <p className="text-xs text-muted-foreground mb-4">
                    Atribuição: <strong>{ATTR_LABELS[attrMode]}</strong> · cada bloco mostra os valores mais comuns entre os compradores
                  </p>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="rounded-lg border p-4 space-y-3">
                      <p className="text-sm font-semibold">utm_source</p>
                      <SalesUtmBarChart rows={data.bySource} field={attrMode} color={CHART_COLORS[0]} />
                    </div>
                    <div className="rounded-lg border p-4 space-y-3">
                      <p className="text-sm font-semibold">utm_campaign</p>
                      <SalesUtmBarChart rows={data.byCampaign} field={attrMode} color={CHART_COLORS[1]} />
                    </div>
                    <div className="rounded-lg border p-4 space-y-3">
                      <p className="text-sm font-semibold">utm_medium</p>
                      <SalesUtmBarChart rows={data.byMedium} field={attrMode} color={CHART_COLORS[2]} />
                    </div>
                    <div className="rounded-lg border p-4 space-y-3">
                      <p className="text-sm font-semibold">utm_content</p>
                      <SalesUtmBarChart rows={data.byContent} field={attrMode} color={CHART_COLORS[3]} />
                    </div>
                  </div>
                </div>
              </AccordionItem>

              {/* Top ads convertidos */}
              <AccordionItem title="Ads que Mais Converteram (utm_content)" defaultOpen>
                <div className="p-4 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Atribuição: <strong>{ATTR_LABELS[attrMode]}</strong>
                  </p>
                  <TopAdsTable rows={data.byContent} field={attrMode} />
                </div>
              </AccordionItem>

              {/* Drill-down */}
              {data.drilldown.length > 0 && (
                <SalesDrilldown drilldown={data.drilldown} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export default function TabUtmLeads({ token, enabled }: Props) {
  // Distribution state
  const [since, setSince] = useState(lastWeekStr)
  const [until, setUntil] = useState(todayStr)
  const [distData, setDistData]   = useState<DistributionData | null>(null)
  const [distLoading, setDistLoading] = useState(false)
  const [distError, setDistError] = useState<string | null>(null)

  // Crossover state
  const [utmField, setUtmField]   = useState<DimKey>('campaign')
  const [utmValue, setUtmValue]   = useState('')
  const [crossMode, setCrossMode] = useState<'period' | 'open'>('period')
  const [crossData, setCrossData] = useState<CrossoverData | null>(null)
  const [crossLoading, setCrossLoading] = useState(false)
  const [crossError, setCrossError]     = useState<string | null>(null)
  const [attrMode, setAttrMode]         = useState<'last' | 'any'>('last')

  const fetchDistribution = useCallback(async () => {
    setDistLoading(true)
    setDistError(null)
    try {
      const params = new URLSearchParams({ since, until })
      const res = await fetch(`/api/utm-leads-analysis?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) { sessionStorage.removeItem('dashboard-token'); window.location.reload(); return }
      if (!res.ok) throw new Error(`Erro ${res.status}: ${await res.text()}`)
      setDistData(await res.json())
    } catch (e) {
      setDistError((e as Error).message)
    } finally {
      setDistLoading(false)
    }
  }, [since, until, token])

  const fetchCrossover = useCallback(async () => {
    if (!utmValue.trim()) return
    setCrossLoading(true)
    setCrossError(null)
    try {
      const params = new URLSearchParams({
        since, until,
        utmField,
        utmValue: utmValue.trim(),
        crossMode,
      })
      const res = await fetch(`/api/utm-leads-analysis?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) { sessionStorage.removeItem('dashboard-token'); window.location.reload(); return }
      if (!res.ok) throw new Error(`Erro ${res.status}: ${await res.text()}`)
      setCrossData(await res.json())
    } catch (e) {
      setCrossError((e as Error).message)
    } finally {
      setCrossLoading(false)
    }
  }, [since, until, utmField, utmValue, crossMode, token])

  if (!enabled) return null

  const dimOptions: UtmDist[] =
    distData
      ? utmField === 'source'   ? distData.bySource
        : utmField === 'campaign' ? distData.byCampaign
        : utmField === 'medium'   ? distData.byMedium
        : distData.byContent
      : []

  const crossDims = crossData
    ? (attrMode === 'last' ? crossData.lastBefore : crossData.anyBefore)
    : null

  return (
    <div className="space-y-6">

      {/* ── Seção 1: Análise de Vendas ───────────────────────────────────── */}
      <SalesSection token={token} />

      {/* ── Seção 2: Distribuição de Leads por UTM ───────────────────────── */}
      <div className="rounded-lg border p-5 space-y-4">
        <SectionHeader
          title="Distribuição de Leads por UTM"
          description="Leads únicos com UTMs registradas no período. Use este painel para entender as maiores fontes."
        />

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">De</label>
            <input
              type="date"
              className="rounded border px-2 py-1.5 text-sm"
              value={since}
              onChange={e => setSince(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Até</label>
            <input
              type="date"
              className="rounded border px-2 py-1.5 text-sm"
              value={until}
              onChange={e => setUntil(e.target.value)}
            />
          </div>
          <Button onClick={fetchDistribution} disabled={distLoading}>
            {distLoading
              ? <><span className="mr-2 inline-block h-4 w-4 animate-spin">⟳</span>Buscando…</>
              : <><Search className="mr-2 h-4 w-4" />Buscar</>
            }
          </Button>
        </div>

        {distError && <p className="text-sm text-destructive">{distError}</p>}
        {distLoading && <TabLoading />}

        {distData && !distLoading && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-4 py-3">
              <span className="text-2xl font-bold" style={{ color: CHART_COLORS[0] }}>
                {distData.totalLeads.toLocaleString('pt-BR')}
              </span>
              <span className="text-sm text-muted-foreground">leads únicos com UTMs no período</span>
            </div>
            <DimChartsGrid dims={distData} />
          </div>
        )}
      </div>

      {/* ── Seção 3: Cruzamento de UTMs ──────────────────────────────────── */}
      <div className="rounded-lg border p-5 space-y-5">
        <SectionHeader
          title="Cruzamento de UTMs"
          description="Selecione uma UTM para ver quais UTMs os leads tinham antes de adquiri-la."
        />

        <div className="space-y-2">
          <p className="text-sm font-medium">Dimensão da UTM analisada</p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(DIM_LABELS) as DimKey[]).map(f => (
              <button
                key={f}
                onClick={() => { setUtmField(f); setUtmValue('') }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  utmField === f
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:bg-muted'
                }`}
              >
                {DIM_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        <UtmValuePicker
          options={dimOptions}
          value={utmValue}
          onChange={setUtmValue}
        />

        <div className="space-y-2">
          <p className="text-sm font-medium">Escopo de busca</p>
          <div className="space-y-2.5">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="radio" name="crossMode" value="period" checked={crossMode === 'period'} onChange={() => setCrossMode('period')} className="mt-0.5" />
              <div>
                <span className="text-sm font-medium">Data do período</span>
                <p className="text-xs text-muted-foreground">
                  Considera leads que tiveram algum evento UTM no período selecionado acima.
                  Dentre esses, vê quais tinham a UTM analisada e busca os UTMs anteriores a ela.
                </p>
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="radio" name="crossMode" value="open" checked={crossMode === 'open'} onChange={() => setCrossMode('open')} className="mt-0.5" />
              <div>
                <span className="text-sm font-medium">Data em aberto</span>
                <p className="text-xs text-muted-foreground">
                  Busca todos os leads que têm a UTM analisada (sem filtro de data).
                  Mostra todas as UTMs que registraram antes da data de aquisição dessa UTM.
                </p>
              </div>
            </label>
          </div>
        </div>

        <Button onClick={fetchCrossover} disabled={crossLoading || !utmValue.trim()}>
          {crossLoading
            ? <><span className="mr-2 inline-block h-4 w-4 animate-spin">⟳</span>Analisando…</>
            : <><Play className="mr-2 h-4 w-4" />Analisar Cruzamento</>
          }
        </Button>

        {crossError && <p className="text-sm text-destructive">{crossError}</p>}
        {crossLoading && <TabLoading />}

        {crossData && !crossLoading && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/50 px-4 py-3">
              <span className="text-2xl font-bold" style={{ color: CHART_COLORS[2] }}>
                {crossData.matchedLeads.toLocaleString('pt-BR')}
              </span>
              <span className="text-sm text-muted-foreground">
                leads com UTMs anteriores à{' '}
                <code className="rounded bg-muted px-1 text-xs">
                  {DIM_LABELS[utmField as DimKey]}={crossData.utmValue}
                </code>
              </span>
              {crossData.matchedLeads === 0 && (
                <p className="w-full text-xs text-muted-foreground">
                  Nenhum lead encontrado com essa combinação. Verifique o valor da UTM ou tente o modo "Data em aberto".
                </p>
              )}
            </div>

            {crossData.matchedLeads > 0 && (
              <>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAttrMode('last')}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      attrMode === 'last'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    Última UTM antes
                  </button>
                  <button
                    onClick={() => setAttrMode('any')}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      attrMode === 'any'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    Qualquer UTM antes
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {attrMode === 'last'
                      ? '— último registro de UTM de cada lead imediatamente antes da UTM analisada'
                      : '— todos os leads que em algum momento tiveram cada UTM antes da analisada'}
                  </span>
                </div>

                {crossDims && (
                  <DimChartsGrid dims={crossDims} suffix=" (antes)" />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
