import { useDashboardFetch } from './hooks'
import type { EmailCampaignsData } from './types'
import { KpiCard, SectionHeader, TabLoading, TabError, CHART_COLORS } from './components'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface Props { token: string; enabled: boolean }

export default function TabEmailCampaigns({ token, enabled }: Props) {
  const { data, status, error, refetch } = useDashboardFetch<EmailCampaignsData>(
    '/api/email-campaigns-data',
    token,
    { enabled }
  )

  if (status === 'loading' || status === 'idle') return <TabLoading />
  if (status === 'error') return <TabError message={error ?? 'Erro ao carregar'} onRetry={refetch} />
  if (!data) return null

  const chartData = data.waves.map(w => ({ name: w.label, count: w.count }))
  const totalDisparo = data.waves.reduce((a, w) => a + w.count, 0)

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Inscritos na Base" value={data.totalInscritos.toLocaleString('pt-BR')} color="#d4a853" />
        <KpiCard label="Compradores" value={data.totalCompradores.toLocaleString('pt-BR')} color="#7c9885" />
        <KpiCard label="Total Disparos" value={totalDisparo.toLocaleString('pt-BR')} color="#5b8fb9" />
      </div>

      {/* Gráfico de waves */}
      <div>
        <SectionHeader title="Contatos por Wave de Email" description="Quantos contatos receberam cada onda de disparo" />
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" name="Contatos" radius={[4, 4, 0, 0]}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Tabela de waves */}
      <div>
        <SectionHeader title="Detalhamento por Wave" />
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Wave</th>
                <th className="px-4 py-3 text-left font-medium">Tag</th>
                <th className="px-4 py-3 text-right font-medium">Contatos</th>
                <th className="px-4 py-3 text-right font-medium">% da Base</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.waves.map(wave => (
                <tr key={wave.tag} className="hover:bg-muted/50">
                  <td className="px-4 py-3 font-medium">{wave.label}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{wave.tag}</td>
                  <td className="px-4 py-3 text-right">{wave.count.toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {data.totalInscritos > 0
                      ? `${((wave.count / data.totalInscritos) * 100).toFixed(1)}%`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
