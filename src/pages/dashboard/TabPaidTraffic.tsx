import { useState, useEffect } from 'react'
import { useDashboardFetch } from './hooks'
import type { MetaAdsData } from './types'
import {
  KpiCard, SectionHeader, TabLoading, TabError, HealthBanner,
  formatBRL, formatPercent, ChartTooltip, CHART_COLORS,
} from './components'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

interface Props { token: string; enabled: boolean }

const PERIOD_OPTIONS = [
  { label: '7 dias', value: 7 },
  { label: '14 dias', value: 14 },
  { label: '30 dias', value: 30 },
  { label: '60 dias', value: 60 },
]

const GROUP_LABELS: Record<string, string> = {
  captacao: 'Captação',
  vendaDireta: 'Venda Direta',
  boosts: 'Posts Impulsionados',
}

export default function TabPaidTraffic({ token, enabled }: Props) {
  const [days, setDays] = useState(30)
  const url = `/api/meta-ads-data?days=${days}`

  const { data, status, error, refetch } = useDashboardFetch<MetaAdsData>(
    url,
    token,
    { enabled, refreshInterval: 10 * 60 * 1000 }
  )

  // Re-fetcher quando o período muda (após o primeiro carregamento)
  useEffect(() => {
    if (enabled) refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days])

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

  // Todas as campanhas ordenadas por gasto
  const allCampaigns = [
    ...data.captacao.campaigns.map(c => ({ ...c, group: 'captacao' })),
    ...data.vendaDireta.campaigns.map(c => ({ ...c, group: 'vendaDireta' })),
    ...data.boosts.campaigns.map(c => ({ ...c, group: 'boosts' })),
  ].sort((a, b) => b.spend - a.spend)

  return (
    <div className="space-y-6">
      {alerts.length > 0 && <HealthBanner messages={alerts} />}

      {/* Seletor de período */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Período:</span>
        {PERIOD_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setDays(opt.value)}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
              days === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {data.dateRange.start} → {data.dateRange.end}
        </span>
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
          <SectionHeader title="Todas as campanhas" description="Ordenadas por gasto" />
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Campanha</th>
                  <th className="px-3 py-2 text-left font-medium">Grupo</th>
                  <th className="px-3 py-2 text-right font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Gasto</th>
                  <th className="px-3 py-2 text-right font-medium">Impressões</th>
                  <th className="px-3 py-2 text-right font-medium">Cliques</th>
                  <th className="px-3 py-2 text-right font-medium">CTR</th>
                  <th className="px-3 py-2 text-right font-medium">CPC</th>
                  <th className="px-3 py-2 text-right font-medium">Leads</th>
                  <th className="px-3 py-2 text-right font-medium">CPL</th>
                  <th className="px-3 py-2 text-right font-medium">Compras</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {allCampaigns.map(c => (
                  <tr key={c.id} className="hover:bg-muted/50">
                    <td className="max-w-[200px] truncate px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{GROUP_LABELS[c.group]}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        c.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{formatBRL(c.spend)}</td>
                    <td className="px-3 py-2 text-right">{c.impressions.toLocaleString('pt-BR')}</td>
                    <td className="px-3 py-2 text-right">{c.clicks.toLocaleString('pt-BR')}</td>
                    <td className="px-3 py-2 text-right">{formatPercent(c.ctr)}</td>
                    <td className="px-3 py-2 text-right">{formatBRL(c.cpc)}</td>
                    <td className="px-3 py-2 text-right">{c.leads}</td>
                    <td className="px-3 py-2 text-right">{c.leads > 0 ? formatBRL(c.spend / c.leads) : '—'}</td>
                    <td className="px-3 py-2 text-right">{c.purchases}</td>
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
