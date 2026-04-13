import { useState } from 'react'
import { useDashboardFetch } from './hooks'
import type { LeadsData, LeadsUTMData, LeadsBehaviorData } from './types'
import { TabLoading, TabError, CHART_COLORS } from './components'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Search, ChevronDown, ChevronUp } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'

interface Props { token: string; enabled: boolean }

export default function TabLeads({ token, enabled }: Props) {
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [cursor, setCursor] = useState<string | undefined>(undefined)

  // UTM charts
  const [activeUtmDim, setActiveUtmDim] = useState<'utmSource' | 'utmCampaign' | 'utmMedium' | 'utmContent'>('utmSource')
  const [showUtm, setShowUtm] = useState(false)

  // Behavior analysis
  const [showBehavior, setShowBehavior] = useState(false)
  const [behaviorData, setBehaviorData] = useState<LeadsBehaviorData | null>(null)
  const [behaviorLoading, setBehaviorLoading] = useState(false)
  const [behaviorError, setBehaviorError] = useState<string | null>(null)

  const urlParams = new URLSearchParams({
    ...(search ? { query: search } : {}),
    ...(tagFilter ? { tag: tagFilter } : {}),
    ...(cursor ? { cursor } : {}),
  })
  const url = `/api/leads-data?${urlParams.toString()}`

  const { data, status, error, refetch } = useDashboardFetch<LeadsData>(url, token, { enabled })

  // UTM data — loads when UTM panel is opened
  const utmUrlParams = new URLSearchParams({
    type: 'utm',
    ...(search ? { query: search } : {}),
    ...(tagFilter ? { tag: tagFilter } : {}),
  })
  const utmUrl = `/api/leads-analysis?${utmUrlParams.toString()}`
  const { data: utmData, status: utmStatus } = useDashboardFetch<LeadsUTMData>(
    utmUrl, token, { enabled: enabled && showUtm }
  )

  async function loadBehavior() {
    setBehaviorLoading(true); setBehaviorError(null)
    const bParams = new URLSearchParams({
      type: 'behavior',
      ...(search ? { query: search } : {}),
      ...(tagFilter ? { tag: tagFilter } : {}),
    })
    try {
      const res = await fetch(`/api/leads-analysis?${bParams.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) throw new Error(`Erro ${res.status}`)
      setBehaviorData(await res.json())
    } catch (e) {
      setBehaviorError((e as Error).message)
    } finally {
      setBehaviorLoading(false)
    }
  }

  if (status === 'loading' || status === 'idle') return <TabLoading />
  if (status === 'error') return <TabError message={error ?? 'Erro ao carregar'} onRetry={refetch} />
  if (!data) return null

  const UTM_DIMS = [
    { key: 'utmSource' as const, label: 'utm_source' },
    { key: 'utmCampaign' as const, label: 'utm_campaign' },
    { key: 'utmMedium' as const, label: 'utm_medium' },
    { key: 'utmContent' as const, label: 'utm_content' },
  ]

  const utmChartData = utmData?.[activeUtmDim]?.slice(0, 20) ?? []

  const behaviorPieData = behaviorData
    ? [
        { name: 'Só antes', value: behaviorData.soAntes },
        { name: 'Só depois', value: behaviorData.soDepois },
        { name: 'Antes e depois', value: behaviorData.ambos },
        { name: 'Não comprou', value: behaviorData.nenhum },
      ].filter(d => d.value > 0)
    : []

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, email..."
            value={search}
            onChange={e => { setSearch(e.target.value); setCursor(undefined) }}
            className="pl-9"
          />
        </div>
        <Input
          placeholder="Filtrar por tag..."
          value={tagFilter}
          onChange={e => { setTagFilter(e.target.value); setCursor(undefined) }}
          className="w-44"
        />
        <span className="text-sm text-muted-foreground whitespace-nowrap">{data.total.toLocaleString('pt-BR')} leads</span>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Nome</th>
              <th className="px-4 py-3 text-left font-medium">Email</th>
              <th className="px-4 py-3 text-left font-medium">Telefone</th>
              <th className="px-4 py-3 text-left font-medium">Fonte</th>
              <th className="px-4 py-3 text-left font-medium">Data</th>
              <th className="px-4 py-3 text-left font-medium">Tags</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.leads.map(lead => (
              <tr key={lead.id} className="hover:bg-muted/50">
                <td className="px-4 py-3 font-medium">{lead.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{lead.email}</td>
                <td className="px-4 py-3 text-muted-foreground">{lead.phone ?? '—'}</td>
                <td className="px-4 py-3">{lead.utmSource ?? lead.source ?? '—'}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {lead.dateAdded ? new Date(lead.dateAdded).toLocaleDateString('pt-BR') : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {lead.tags.slice(0, 3).map(tag => (
                      <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                    ))}
                    {lead.tags.length > 3 && (
                      <Badge variant="outline" className="text-xs">+{lead.tags.length - 3}</Badge>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {data.nextCursor && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setCursor(data.nextCursor)}>
            Carregar mais
          </Button>
        </div>
      )}

      {/* ── Análise UTM ────────────────────────────────────────────────────── */}
      <div className="rounded-lg border">
        <button
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted"
          onClick={() => setShowUtm(v => !v)}
        >
          <span>📊 Distribuição por UTM</span>
          {showUtm ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showUtm && (
          <div className="border-t p-4 space-y-4">
            <div className="flex flex-wrap gap-2">
              {UTM_DIMS.map(d => (
                <Button
                  key={d.key}
                  size="sm"
                  variant={activeUtmDim === d.key ? 'default' : 'outline'}
                  onClick={() => setActiveUtmDim(d.key)}
                >
                  {d.label}
                </Button>
              ))}
            </div>
            {utmStatus === 'loading' || utmStatus === 'idle' ? (
              <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">Carregando...</div>
            ) : utmChartData.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados para esta dimensão com o filtro atual.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(200, utmChartData.length * 28 + 60)}>
                <BarChart layout="vertical" data={utmChartData} margin={{ left: 8, right: 60 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="value" width={180} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => `${v.toLocaleString('pt-BR')} leads`} />
                  <Bar dataKey="count" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>

      {/* ── Comportamento antes/depois ─────────────────────────────────────── */}
      <div className="rounded-lg border">
        <button
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted"
          onClick={() => setShowBehavior(v => !v)}
        >
          <span>🔄 Comportamento de compra antes/depois da entrada</span>
          {showBehavior ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showBehavior && (
          <div className="border-t p-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Para cada lead no filtro atual, compara o que compraram <strong>antes</strong> e <strong>depois</strong> de sua primeira aparição com esses critérios.
            </p>
            <Button size="sm" onClick={loadBehavior} disabled={behaviorLoading}>
              {behaviorLoading ? '⟳ Analisando...' : 'Iniciar análise'}
            </Button>
            {behaviorError && <p className="text-sm text-destructive">{behaviorError}</p>}
            {behaviorData && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="rounded border p-3 text-center"><p className="text-2xl font-bold">{behaviorData.total.toLocaleString('pt-BR')}</p><p className="text-xs text-muted-foreground">Leads no filtro</p></div>
                  <div className="rounded border p-3 text-center"><p className="text-2xl font-bold">{behaviorData.soAntes.toLocaleString('pt-BR')}</p><p className="text-xs text-muted-foreground">Compraram antes</p></div>
                  <div className="rounded border p-3 text-center"><p className="text-2xl font-bold">{behaviorData.soDepois.toLocaleString('pt-BR')}</p><p className="text-xs text-muted-foreground">Compraram depois</p></div>
                  <div className="rounded border p-3 text-center">
                    <p className="text-2xl font-bold">{behaviorData.mediaDepois.toLocaleString('pt-BR')}</p>
                    <p className="text-xs text-muted-foreground">Média compras depois</p>
                    <p className="text-xs text-muted-foreground">(vs {behaviorData.mediaAntes} antes)</p>
                  </div>
                </div>
                <div className="grid gap-6 sm:grid-cols-2">
                  <div>
                    <p className="mb-2 text-sm font-medium">Distribuição de comportamento</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={behaviorPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70}>
                          {behaviorPieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => v.toLocaleString('pt-BR')} />
                        <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium">Top produtos (antes / depois)</p>
                    <div className="overflow-x-auto rounded border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted"><tr><th className="px-3 py-2 text-left font-medium">Produto</th><th className="px-3 py-2 text-center font-medium">Antes</th><th className="px-3 py-2 text-center font-medium">Depois</th></tr></thead>
                        <tbody className="divide-y">
                          {behaviorData.products.slice(0, 10).map((p, i) => (
                            <tr key={i} className="hover:bg-muted/50">
                              <td className="px-3 py-2 max-w-[180px] truncate">{p.product}</td>
                              <td className="px-3 py-2 text-center">{p.antes}</td>
                              <td className="px-3 py-2 text-center font-medium">{p.depois}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
