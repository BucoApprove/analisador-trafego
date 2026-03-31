import { useState, useCallback } from 'react'
import { useDashboardFetch } from './hooks'
import type { MetaAdsData } from './types'
import {
  KpiCard, SectionHeader, TabLoading, TabError, HealthBanner,
  formatBRL, formatPercent, ChartTooltip, CHART_COLORS,
} from './components'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

interface Props { token: string; enabled: boolean }

const GROUP_LABELS: Record<string, string> = {
  captacao: 'Captação',
  vendaDireta: 'Venda Direta',
  boosts: 'Posts Impulsionados',
}

function todayStr() { return new Date().toISOString().split('T')[0] }
function daysAgoStr(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString().split('T')[0]
}

const PRESETS = [
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '60d', days: 60 },
  { label: '90d', days: 90 },
]

type SortKey = 'name' | 'group' | 'status' | 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'leads' | 'cpl' | 'purchases'
type SortDir = 'asc' | 'desc'

export default function TabPaidTraffic({ token, enabled }: Props) {
  const [since, setSince] = useState(() => daysAgoStr(30))
  const [until, setUntil] = useState(todayStr)
  const [pendingSince, setPendingSince] = useState(() => daysAgoStr(30))
  const [pendingUntil, setPendingUntil] = useState(todayStr)
  const [nameFilter, setNameFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('spend')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const url = `/api/meta-ads-data?since=${since}&until=${until}`
  const { data, status, error, refetch } = useDashboardFetch<MetaAdsData>(
    url, token, { enabled, refreshInterval: 10 * 60 * 1000 }
  )

  const applyDates = useCallback(() => {
    setSince(pendingSince)
    setUntil(pendingUntil)
  }, [pendingSince, pendingUntil])

  const applyPreset = (days: number) => {
    const s = daysAgoStr(days)
    const u = todayStr()
    setPendingSince(s); setPendingUntil(u)
    setSince(s); setUntil(u)
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  if (status === 'loading' || status === 'idle') return <TabLoading />
  if (status === 'error') return <TabError message={error ?? 'Erro ao carregar'} onRetry={refetch} />
  if (!data) return null

  const alerts: string[] = []
  if (data.totalSpend === 0) alerts.push('Sem gastos registrados no período — verifique o token do Meta.')

  const groupsChart = [
    { name: 'Captação', spend: data.captacao.spend, leads: data.captacao.leads },
    { name: 'Venda Direta', spend: data.vendaDireta.spend, leads: data.vendaDireta.leads },
    { name: 'Boosts', spend: data.boosts.spend, leads: data.boosts.leads },
  ]

  const allCampaigns = [
    ...data.captacao.campaigns.map(c => ({ ...c, group: 'captacao' })),
    ...data.vendaDireta.campaigns.map(c => ({ ...c, group: 'vendaDireta' })),
    ...data.boosts.campaigns.map(c => ({ ...c, group: 'boosts' })),
  ]

  // Filtro por nome
  const filtered = nameFilter.trim()
    ? allCampaigns.filter(c => c.name.toLowerCase().includes(nameFilter.trim().toLowerCase()))
    : allCampaigns

  // Ordenação
  const sorted = [...filtered].sort((a, b) => {
    let va: number | string, vb: number | string
    switch (sortKey) {
      case 'name':    va = a.name; vb = b.name; break
      case 'group':   va = a.group; vb = b.group; break
      case 'status':  va = a.status; vb = b.status; break
      case 'spend':   va = a.spend; vb = b.spend; break
      case 'impressions': va = a.impressions; vb = b.impressions; break
      case 'clicks':  va = a.clicks; vb = b.clicks; break
      case 'ctr':     va = a.ctr; vb = b.ctr; break
      case 'cpc':     va = a.cpc; vb = b.cpc; break
      case 'leads':   va = a.leads; vb = b.leads; break
      case 'cpl':     va = a.leads > 0 ? a.spend / a.leads : 0; vb = b.leads > 0 ? b.spend / b.leads : 0; break
      case 'purchases': va = a.purchases; vb = b.purchases; break
      default:        va = 0; vb = 0
    }
    if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va)
    return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number)
  })

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 text-muted-foreground/50" />
    return sortDir === 'asc'
      ? <ChevronUp className="inline h-3 w-3 ml-0.5" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5" />
  }

  function Th({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) {
    return (
      <th
        className={`px-3 py-2 font-medium cursor-pointer select-none hover:bg-muted/80 whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
        onClick={() => toggleSort(k)}
      >
        {children}<SortIcon k={k} />
      </th>
    )
  }

  return (
    <div className="space-y-6">
      {alerts.length > 0 && <HealthBanner messages={alerts} />}

      {/* Seletor de período */}
      <div className="rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          {/* Presets rápidos */}
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Atalhos</p>
            <div className="flex gap-1">
              {PRESETS.map(p => (
                <button
                  key={p.days}
                  onClick={() => applyPreset(p.days)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    since === daysAgoStr(p.days) && until === todayStr()
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date pickers */}
          <div>
            <p className="mb-1 text-xs text-muted-foreground">De</p>
            <input
              type="date"
              value={pendingSince}
              onChange={e => setPendingSince(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Até</p>
            <input
              type="date"
              value={pendingUntil}
              onChange={e => setPendingUntil(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            onClick={applyDates}
            disabled={pendingSince === since && pendingUntil === until}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-40"
          >
            Buscar
          </button>
          <span className="ml-auto self-end text-xs text-muted-foreground pb-1">
            {data.dateRange.start} → {data.dateRange.end}
          </span>
        </div>
      </div>

      {/* KPIs globais */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Gasto Total" value={formatBRL(data.totalSpend)} color={CHART_COLORS[0]} />
        <KpiCard label="CPL Médio" value={data.totalLeads > 0 ? formatBRL(data.totalSpend / data.totalLeads) : '—'} color={CHART_COLORS[4]} />
        <KpiCard label="Leads (pixel)" value={data.totalLeads.toLocaleString('pt-BR')} color={CHART_COLORS[1]} />
        <KpiCard label="Compras (pixel)" value={data.totalPurchases.toLocaleString('pt-BR')} color={CHART_COLORS[2]} />
      </div>

      {/* Gráficos comparativos */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionHeader title="Gasto por grupo" />
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={groupsChart}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTooltip formatter={formatBRL} />} />
              <Bar dataKey="spend" name="Gasto" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <SectionHeader title="Leads por grupo" />
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={groupsChart}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="leads" name="Leads" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* KPIs por grupo */}
      {(['captacao', 'vendaDireta', 'boosts'] as const).map((key, i) => {
        const g = data[key]
        if (g.spend === 0 && g.campaigns.length === 0) return null
        return (
          <div key={key}>
            <SectionHeader title={GROUP_LABELS[key]} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <KpiCard label="Gasto" value={formatBRL(g.spend)} color={CHART_COLORS[i]} />
              <KpiCard label="Leads" value={g.leads.toLocaleString('pt-BR')} color={CHART_COLORS[i]} />
              <KpiCard label="CPL" value={g.leads > 0 ? formatBRL(g.cpl) : '—'} color={CHART_COLORS[i]} />
              <KpiCard label="CTR" value={formatPercent(g.ctr)} color={CHART_COLORS[i]} />
              <KpiCard label="Frequência" value={g.frequency > 0 ? g.frequency.toFixed(1) : '—'} color={CHART_COLORS[i]} />
            </div>
          </div>
        )
      })}

      {/* Tabela completa de campanhas */}
      {allCampaigns.length > 0 && (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <SectionHeader title="Todas as campanhas" />
            <div className="ml-auto">
              <input
                type="text"
                placeholder="Filtrar por nome…"
                value={nameFilter}
                onChange={e => setNameFilter(e.target.value)}
                className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring w-56"
              />
            </div>
          </div>
          {nameFilter && (
            <p className="mb-2 text-xs text-muted-foreground">
              {sorted.length} de {allCampaigns.length} campanha(s)
            </p>
          )}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs">
                <tr>
                  <Th k="name">Campanha</Th>
                  <Th k="group">Grupo</Th>
                  <Th k="status">Status</Th>
                  <Th k="spend" right>Gasto</Th>
                  <Th k="impressions" right>Impressões</Th>
                  <Th k="clicks" right>Cliques</Th>
                  <Th k="ctr" right>CTR</Th>
                  <Th k="cpc" right>CPC</Th>
                  <Th k="leads" right>Leads</Th>
                  <Th k="cpl" right>CPL</Th>
                  <Th k="purchases" right>Compras</Th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sorted.map(c => (
                  <tr key={c.id} className="hover:bg-muted/50">
                    <td className="max-w-[200px] truncate px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{GROUP_LABELS[c.group]}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        c.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatBRL(c.spend)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.impressions.toLocaleString('pt-BR')}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.clicks.toLocaleString('pt-BR')}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatPercent(c.ctr)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatBRL(c.cpc)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.leads}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.leads > 0 ? formatBRL(c.spend / c.leads) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.purchases}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
