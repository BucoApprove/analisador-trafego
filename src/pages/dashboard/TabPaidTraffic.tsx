import { useDashboardFetch } from './hooks'
import type { MetaAdsData } from './types'
import { KpiCard, SectionHeader, TabLoading, TabError, formatBRL, formatPercent, ChartTooltip, CHART_COLORS } from './components'
import { HealthBanner } from './components'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface Props { token: string; enabled: boolean }

export default function TabPaidTraffic({ token, enabled }: Props) {
  const { data, status, error, refetch } = useDashboardFetch<MetaAdsData>(
    '/api/meta-ads-data',
    token,
    { enabled, refreshInterval: 10 * 60 * 1000 }
  )

  if (status === 'loading' || status === 'idle') return <TabLoading />
  if (status === 'error') return <TabError message={error ?? 'Erro ao carregar'} onRetry={refetch} />
  if (!data) return null

  const alerts: string[] = []
  if (data.totalSpend === 0) alerts.push('Sem gastos registrados no período — verifique o token do Meta.')

  const groupsChart = [
    { name: 'Captação MC', spend: data.captacao.spend, leads: data.captacao.leads, cpl: data.captacao.cpl },
    { name: 'Venda Direta', spend: data.vendaDireta.spend, leads: data.vendaDireta.leads, cpl: data.vendaDireta.cpl },
    { name: 'Boosts', spend: data.boosts.spend, leads: data.boosts.leads, cpl: data.boosts.cpl },
  ]

  return (
    <div className="space-y-6">
      {alerts.length > 0 && <HealthBanner messages={alerts} />}

      {/* KPIs globais */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Gasto Total" value={formatBRL(data.totalSpend)} color="#d4a853" />
        <KpiCard label="Total Leads" value={data.totalLeads.toLocaleString('pt-BR')} color="#7c9885" />
        <KpiCard label="Total Compras" value={data.totalPurchases.toLocaleString('pt-BR')} color="#5b8fb9" />
        <KpiCard
          label="CPL Médio"
          value={data.totalLeads > 0 ? formatBRL(data.totalSpend / data.totalLeads) : '—'}
          color="#9b7cc1"
        />
      </div>

      {/* Comparativo por grupo */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionHeader title="Gasto por Grupo" />
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
          <SectionHeader title="Leads por Grupo" />
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

      {/* Detalhe por grupo */}
      {(['captacao', 'vendaDireta', 'boosts'] as const).map((key, i) => {
        const group = data[key]
        const labels = ['Captação Masterclass', 'Venda Direta', 'Posts Impulsionados']
        return (
          <div key={key}>
            <SectionHeader title={labels[i]} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Gasto" value={formatBRL(group.spend)} color={CHART_COLORS[i]} />
              <KpiCard label="Leads" value={group.leads.toLocaleString('pt-BR')} color={CHART_COLORS[i]} />
              <KpiCard label="CPL" value={group.leads > 0 ? formatBRL(group.cpl) : '—'} color={CHART_COLORS[i]} />
              <KpiCard label="CTR" value={formatPercent(group.ctr)} color={CHART_COLORS[i]} />
            </div>

            {/* Tabela de campanhas do grupo */}
            {group.campaigns.length > 0 && (
              <div className="mt-3 overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Campanha</th>
                      <th className="px-3 py-2 text-right font-medium">Gasto</th>
                      <th className="px-3 py-2 text-right font-medium">Leads</th>
                      <th className="px-3 py-2 text-right font-medium">CPL</th>
                      <th className="px-3 py-2 text-right font-medium">CTR</th>
                      <th className="px-3 py-2 text-right font-medium">CPC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {group.campaigns.map(c => (
                      <tr key={c.id} className="hover:bg-muted/50">
                        <td className="px-3 py-2 max-w-xs truncate">{c.name}</td>
                        <td className="px-3 py-2 text-right">{formatBRL(c.spend)}</td>
                        <td className="px-3 py-2 text-right">{c.leads}</td>
                        <td className="px-3 py-2 text-right">{c.leads > 0 ? formatBRL(c.spend / c.leads) : '—'}</td>
                        <td className="px-3 py-2 text-right">{formatPercent(c.ctr)}</td>
                        <td className="px-3 py-2 text-right">{formatBRL(c.cpc)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
