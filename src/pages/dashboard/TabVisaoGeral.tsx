import { useDashboardFetch } from './hooks'
import type { DashboardData, MetaAdsData } from './types'
import {
  KpiCard, SectionHeader, TabLoading, TabError,
  formatBRL, formatPercent, ChartTooltip, CHART_COLORS,
} from './components'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

interface Props { token: string; enabled: boolean }

export default function TabVisaoGeral({ token, enabled }: Props) {
  const meta = useDashboardFetch<MetaAdsData>(
    '/api/meta-ads-data?days=30',
    token,
    { enabled, refreshInterval: 10 * 60 * 1000 }
  )
  const bq = useDashboardFetch<DashboardData>(
    '/api/dashboard-data',
    token,
    { enabled, refreshInterval: 10 * 60 * 1000 }
  )

  // Aguarda pelo menos o BQ (Meta pode estar indisponível se token não configurado)
  const loading = bq.status === 'idle' || bq.status === 'loading'
  const error = bq.status === 'error'

  if (loading) return <TabLoading />
  if (error) return <TabError message={bq.error ?? 'Erro ao carregar'} onRetry={bq.refetch} />
  if (!bq.data) return null

  const d = bq.data
  const m = meta.data

  // Dados para gráfico de gasto por grupo
  const groupsChart = m
    ? [
        { name: 'Captação', spend: m.captacao.spend, leads: m.captacao.leads, cpl: m.captacao.cpl },
        { name: 'Venda Direta', spend: m.vendaDireta.spend, leads: m.vendaDireta.leads, cpl: m.vendaDireta.cpl },
        { name: 'Boosts', spend: m.boosts.spend, leads: m.boosts.leads, cpl: m.boosts.cpl },
      ]
    : []

  // Top 5 campanhas por gasto
  const allCampaigns = m
    ? [
        ...m.captacao.campaigns,
        ...m.vendaDireta.campaigns,
        ...m.boosts.campaigns,
      ].sort((a, b) => b.spend - a.spend).slice(0, 5)
    : []

  const cpl = m && m.totalLeads > 0 ? m.totalSpend / m.totalLeads : null

  return (
    <div className="space-y-6">

      {/* KPIs Meta */}
      {m && (
        <div>
          <SectionHeader title="Meta Ads — últimos 30 dias" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard label="Investimento" value={formatBRL(m.totalSpend)} color={CHART_COLORS[0]} />
            <KpiCard label="CPL" value={cpl != null ? formatBRL(cpl) : '—'} color={CHART_COLORS[0]} />
            <KpiCard label="Leads (Meta)" value={m.totalLeads.toLocaleString('pt-BR')} color={CHART_COLORS[1]} />
            <KpiCard label="Compras (pixel)" value={m.totalPurchases.toLocaleString('pt-BR')} color={CHART_COLORS[2]} />
            <KpiCard
              label="Período"
              value={`${m.dateRange.start} → ${m.dateRange.end}`}
              color="#888"
            />
          </div>
        </div>
      )}

      {/* KPIs BQ */}
      <div>
        <SectionHeader title="Base de dados — geral" />
        <div className="grid gap-4 sm:grid-cols-3">
          <KpiCard
            label="Inscritos"
            value={d.inscritos.toLocaleString('pt-BR')}
            color={CHART_COLORS[1]}
          />
          <KpiCard
            label="Compradores"
            value={d.compradores.toLocaleString('pt-BR')}
            color={CHART_COLORS[2]}
          />
          <KpiCard
            label="Conversão"
            value={formatPercent(d.conversao)}
            color={CHART_COLORS[4]}
          />
        </div>
      </div>

      {/* Gráficos */}
      <div className="grid gap-6 lg:grid-cols-2">

        {/* Inscritos por dia */}
        <div>
          <SectionHeader title="Inscritos por dia" />
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={d.inscritosPorDia.slice(-30)}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                tickFormatter={v => v.slice(5)}
              />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} />
              <Line
                type="monotone"
                dataKey="count"
                name="Inscritos"
                stroke={CHART_COLORS[1]}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Gasto por grupo */}
        {m && groupsChart.some(g => g.spend > 0) && (
          <div>
            <SectionHeader title="Gasto por grupo (Meta)" />
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={groupsChart}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip content={<ChartTooltip formatter={formatBRL} />} />
                <Bar dataKey="spend" name="Gasto" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Top campanhas */}
      {allCampaigns.length > 0 && (
        <div>
          <SectionHeader title="Top 5 campanhas por gasto" />
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Campanha</th>
                  <th className="px-3 py-2 text-right font-medium">Gasto</th>
                  <th className="px-3 py-2 text-right font-medium">Leads</th>
                  <th className="px-3 py-2 text-right font-medium">CPL</th>
                  <th className="px-3 py-2 text-right font-medium">CTR</th>
                  <th className="px-3 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {allCampaigns.map(c => (
                  <tr key={c.id} className="hover:bg-muted/50">
                    <td className="max-w-xs truncate px-3 py-2">{c.name}</td>
                    <td className="px-3 py-2 text-right">{formatBRL(c.spend)}</td>
                    <td className="px-3 py-2 text-right">{c.leads}</td>
                    <td className="px-3 py-2 text-right">
                      {c.leads > 0 ? formatBRL(c.spend / c.leads) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">{formatPercent(c.ctr)}</td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          c.status === 'ACTIVE'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Inscritos por fonte */}
      {d.inscritosPorFonte.length > 0 && (
        <div>
          <SectionHeader title="Inscritos por fonte de tráfego" />
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Fonte</th>
                  <th className="px-3 py-2 text-right font-medium">Inscritos</th>
                  <th className="px-3 py-2 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {d.inscritosPorFonte.map(f => (
                  <tr key={f.name} className="hover:bg-muted/50">
                    <td className="px-3 py-2">{f.name || '(sem utm_source)'}</td>
                    <td className="px-3 py-2 text-right">{f.value.toLocaleString('pt-BR')}</td>
                    <td className="px-3 py-2 text-right">
                      {d.inscritos > 0 ? formatPercent((f.value / d.inscritos) * 100) : '—'}
                    </td>
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
