import { useState, useCallback, useEffect } from 'react'
import { SectionHeader, TabLoading, CHART_COLORS } from './components'
import { Button } from '@/components/ui/button'
import { Play, Search } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
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

type DimKey = 'source' | 'campaign' | 'medium' | 'content'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function lastWeekStr() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().split('T')[0]
}

const DIM_LABELS: Record<DimKey, string> = {
  source:   'utm_source',
  campaign: 'utm_campaign',
  medium:   'utm_medium',
  content:  'utm_content',
}

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

// ─── Dim Charts Grid ─────────────────────────────────────────────────────────

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

  // Quando o valor externo é resetado (troca de dimensão), limpa o filtro
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

  // Populate datalist from distribution results for the selected dimension
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

      {/* ── Seção 1: Distribuição de Leads por UTM ───────────────────────── */}
      <div className="rounded-lg border p-5 space-y-4">
        <SectionHeader
          title="Distribuição de Leads por UTM"
          description="Leads únicos com UTMs registradas no período. Use este painel para entender as maiores fontes."
        />

        {/* Filtro de período */}
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
            {/* KPI */}
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

      {/* ── Seção 2: Cruzamento de UTMs ──────────────────────────────────── */}
      <div className="rounded-lg border p-5 space-y-5">
        <SectionHeader
          title="Cruzamento de UTMs"
          description="Selecione uma UTM para ver quais UTMs os leads tinham antes de adquiri-la."
        />

        {/* Dimensão */}
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

        {/* Valor da UTM */}
        <UtmValuePicker
          options={dimOptions}
          value={utmValue}
          onChange={setUtmValue}
        />

        {/* Escopo */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Escopo de busca</p>
          <div className="space-y-2.5">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="radio"
                name="crossMode"
                value="period"
                checked={crossMode === 'period'}
                onChange={() => setCrossMode('period')}
                className="mt-0.5"
              />
              <div>
                <span className="text-sm font-medium">Data do período</span>
                <p className="text-xs text-muted-foreground">
                  Considera leads que tiveram algum evento UTM no período selecionado acima.
                  Dentre esses, vê quais tinham a UTM analisada e busca os UTMs anteriores a ela.
                </p>
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="radio"
                name="crossMode"
                value="open"
                checked={crossMode === 'open'}
                onChange={() => setCrossMode('open')}
                className="mt-0.5"
              />
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

        <Button
          onClick={fetchCrossover}
          disabled={crossLoading || !utmValue.trim()}
        >
          {crossLoading
            ? <><span className="mr-2 inline-block h-4 w-4 animate-spin">⟳</span>Analisando…</>
            : <><Play className="mr-2 h-4 w-4" />Analisar Cruzamento</>
          }
        </Button>

        {crossError && <p className="text-sm text-destructive">{crossError}</p>}
        {crossLoading && <TabLoading />}

        {crossData && !crossLoading && (
          <div className="space-y-4">
            {/* KPI */}
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
                {/* Toggle: última vs qualquer */}
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
