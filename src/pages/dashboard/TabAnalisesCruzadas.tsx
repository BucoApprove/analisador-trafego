import { useState, useEffect, useMemo } from 'react'
import type { CrossAnalysisData, BehaviorTagResult, UtmAttributionData, UtmAttrRow, FunnelOverviewData } from './types'
import { KpiCard, SectionHeader, CHART_COLORS } from './components'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Play, X } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts'

interface Props { token: string; enabled: boolean }

function fmtDate(val: string | null): string {
  if (!val) return '—'
  try { return new Date(val).toLocaleDateString('pt-BR') } catch { return val }
}

function HBar({ data, nameKey, valueKey, color }: { data: Record<string, number | string>[]; nameKey: string; valueKey: string; color?: string }) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground">Sem dados.</p>
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 28 + 60)}>
      <BarChart layout="vertical" data={data} margin={{ left: 8, right: 60 }}>
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey={nameKey} width={180} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey={valueKey} fill={color ?? CHART_COLORS[0]} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function DonutChart({ data }: { data: { name: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80}>
          {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => (v as number).toLocaleString('pt-BR')} />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  )
}

function ProductSelect({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()))
  return (
    <div className="space-y-1 relative">
      <p className="text-sm font-medium">{label}</p>
      <input
        className="w-full rounded border px-2 py-1.5 text-sm"
        placeholder="Buscar produto..."
        value={value || search}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={e => { setSearch(e.target.value); onChange('') }}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full rounded border bg-background shadow-md max-h-52 overflow-y-auto">
          {filtered.map(p => (
            <div
              key={p}
              className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-muted ${value === p ? 'bg-muted font-medium' : ''}`}
              onMouseDown={() => { onChange(p); setSearch(''); setOpen(false) }}
            >{p}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusSelect({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1 min-h-[28px]">
        {value.map(s => (
          <Badge key={s} variant="secondary" className="gap-1 text-xs">
            {s}
            <X className="h-3 w-3 cursor-pointer" onClick={() => onChange(value.filter(v => v !== s))} />
          </Badge>
        ))}
      </div>
      <div className="max-h-36 overflow-y-auto rounded border p-1 space-y-0.5">
        {options.map(s => (
          <label key={s} className="flex cursor-pointer items-center gap-2 rounded px-2 py-0.5 text-xs hover:bg-muted">
            <input
              type="checkbox"
              checked={value.includes(s)}
              onChange={e => onChange(e.target.checked ? [...value, s] : value.filter(v => v !== s))}
              className="h-3 w-3"
            />
            <span>{s}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

function defaultSince(): string {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().split('T')[0]
}
function defaultUntil(): string {
  return new Date().toISOString().split('T')[0]
}

export default function TabAnalisesCruzadas({ token, enabled }: Props) {
  const [products, setProducts] = useState<string[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [selectedProduct, setSelectedProduct] = useState('')
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([])
  const [since, setSince] = useState(defaultSince)
  const [until, setUntil] = useState(defaultUntil)
  const [result, setResult] = useState<CrossAnalysisData | null>(null)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadingOpts, setLoadingOpts] = useState(false)
  const [activeSubTab, setActiveSubTab] = useState('overview')

  // Behavior-by-tag state
  const [selectedTag, setSelectedTag] = useState('')
  const [tagResult, setTagResult] = useState<BehaviorTagResult | null>(null)
  const [tagRunning, setTagRunning] = useState(false)
  const [tagError, setTagError] = useState<string | null>(null)

  // UTM funnel dim selector (legacy)
  const [utmDim, setUtmDim] = useState<'utm_content' | 'utm_campaign' | 'utm_medium'>('utm_content')

  // UTM attribution (new)
  const [utmAttr, setUtmAttr] = useState<UtmAttributionData | null>(null)
  const [utmAttrRunning, setUtmAttrRunning] = useState(false)
  const [utmAttrError, setUtmAttrError] = useState<string | null>(null)
  const [utmAttrDim, setUtmAttrDim] = useState<'byContent' | 'byCampaign' | 'byMedium'>('byCampaign')
  type SortKey = 'leads' | 'anyTime' | 'lastBefore' | 'origin'
  const [utmAttrSort, setUtmAttrSort] = useState<SortKey>('leads')
  const [utmAttrDesc, setUtmAttrDesc] = useState(true)

  // Funnel overview
  const [funnelOverview, setFunnelOverview] = useState<FunnelOverviewData | null>(null)
  const [funnelRunning, setFunnelRunning] = useState(false)
  const [funnelError, setFunnelError] = useState<string | null>(null)

  // Load product/status options once when tab becomes active
  useEffect(() => {
    if (!enabled || loaded) return
    setLoaded(true)
    setLoadingOpts(true)
    fetch('/api/cruzamento', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : r.text().then(t => Promise.reject(new Error(`${r.status}: ${t}`))))
      .then(d => { setProducts(d.products ?? []); setStatuses(d.statuses ?? []) })
      .catch(e => { setLoadError((e as Error).message); setLoaded(false) })
      .finally(() => setLoadingOpts(false))
  }, [enabled, token])

  async function handleRun() {
    if (!selectedProduct) return
    setRunning(true); setRunError(null); setResult(null)
    try {
      const res = await fetch('/api/cross-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: 'all', product: selectedProduct, statuses: selectedStatuses, since, until }),
      })
      if (res.status === 401) { sessionStorage.removeItem('dashboard-token'); window.location.reload(); return }
      if (!res.ok) throw new Error(`Erro ${res.status}: ${await res.text()}`)
      const data: CrossAnalysisData = await res.json()
      setResult(data)
      if (data.availableTags.length > 0) setSelectedTag(data.availableTags[0])
    } catch (e) {
      setRunError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  async function handleRunTag() {
    if (!selectedTag) return
    setTagRunning(true); setTagError(null); setTagResult(null)
    try {
      const res = await fetch('/api/cross-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: 'behavior-tag', tag: selectedTag, statuses: selectedStatuses, since, until }),
      })
      if (!res.ok) throw new Error(`Erro ${res.status}`)
      setTagResult(await res.json())
    } catch (e) {
      setTagError((e as Error).message)
    } finally {
      setTagRunning(false)
    }
  }

  async function handleRunUtmAttr() {
    if (!selectedProduct) return
    setUtmAttrRunning(true); setUtmAttrError(null); setUtmAttr(null)
    try {
      const res = await fetch('/api/cross-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: 'utm-attribution', product: selectedProduct, statuses: selectedStatuses, since, until }),
      })
      if (!res.ok) throw new Error(`Erro ${res.status}: ${await res.text()}`)
      setUtmAttr(await res.json())
    } catch (e) {
      setUtmAttrError((e as Error).message)
    } finally {
      setUtmAttrRunning(false)
    }
  }

  async function handleRunFunnel() {
    setFunnelRunning(true); setFunnelError(null); setFunnelOverview(null)
    try {
      const res = await fetch('/api/cross-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: 'funnel-overview', statuses: selectedStatuses, since, until }),
      })
      if (res.status === 401) { sessionStorage.removeItem('dashboard-token'); window.location.reload(); return }
      if (!res.ok) throw new Error(`Erro ${res.status}: ${await res.text()}`)
      setFunnelOverview(await res.json())
    } catch (e) {
      setFunnelError((e as Error).message)
    } finally {
      setFunnelRunning(false)
    }
  }

  if (!enabled) return null

  return (
    <div className="space-y-6">
      {/* Config */}
      <div className="rounded-lg border p-4 space-y-4">
        <SectionHeader title="Análises Cruzadas" description="Cruza dados de leads com vendas para revelar padrões de comportamento." />
        {loadingOpts && <p className="text-sm text-muted-foreground animate-pulse">Carregando produtos e status...</p>}
        {loadError && <p className="text-sm text-destructive">Erro ao carregar produtos: {loadError}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Período */}
          <div className="space-y-1">
            <p className="text-sm font-medium">Período</p>
            <div className="flex gap-2 items-center">
              <input type="date" value={since} onChange={e => setSince(e.target.value)} className="border rounded px-2 py-1 text-sm bg-background" />
              <span className="text-muted-foreground text-sm">até</span>
              <input type="date" value={until} onChange={e => setUntil(e.target.value)} className="border rounded px-2 py-1 text-sm bg-background" />
            </div>
          </div>
          {/* Produto */}
          <ProductSelect
            label="Produto de referência"
            options={products}
            value={selectedProduct}
            onChange={setSelectedProduct}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Status */}
          <div className="space-y-1">
            <p className="text-sm font-medium">Status das vendas</p>
            <StatusSelect options={statuses} value={selectedStatuses} onChange={setSelectedStatuses} />
            <p className="text-xs text-muted-foreground">Vazio = todos</p>
          </div>
          <div className="flex items-end">
            <Button type="button" onClick={handleRun} disabled={running || !selectedProduct}>
              {running ? <><span className="mr-2 animate-spin">⟳</span>Analisando...</> : <><Play className="mr-2 h-4 w-4" />Rodar análises</>}
            </Button>
          </div>
        </div>
        {runError && <p className="text-sm text-destructive">{runError}</p>}
      </div>

      {/* Resultados */}
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList className="flex h-auto flex-wrap gap-1 bg-muted p-1">
          {[
            { id: 'overview', label: '📊 Visão Geral' },
            { id: 'ltc', label: '⏱ Lead→Compra' },
            { id: 'tags', label: '🏷 Tags/Comprador' },
            { id: 'utm3', label: '📣 utm_content' },
            { id: 'entry', label: '🚪 Primeira entrada' },
            { id: 'funnel', label: '📡 Funil UTM' },
            { id: 'buyer-tags', label: '🔖 Tags compradores' },
            { id: 'utm-attr', label: '🎯 UTM Compradores' },
          ].map(t => (
            <TabsTrigger key={t.id} value={t.id} className="text-xs sm:text-sm">{t.label}</TabsTrigger>
          ))}
        </TabsList>

        {/* 📊 Visão Geral */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <FunnelOverviewPanel
            token={token}
            statuses={selectedStatuses}
            since={since}
            until={until}
            data={funnelOverview}
            running={funnelRunning}
            error={funnelError}
            onRun={handleRunFunnel}
          />
        </TabsContent>

        {result && (<>

          {/* ⏱ Lead → Compra */}
          <TabsContent value="ltc" className="space-y-6 mt-4">
            <Tabs defaultValue="detail">
              <TabsList>
                <TabsTrigger value="detail">Por produto selecionado</TabsTrigger>
                <TabsTrigger value="all">Todos os produtos</TabsTrigger>
              </TabsList>
              <TabsContent value="detail" className="mt-4 space-y-4">
                {result.leadToCompra.count === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum lead encontrado que comprou este produto.</p>
                ) : (
                  <>
                    <div className="grid gap-4 sm:grid-cols-4">
                      <KpiCard label="Leads que compraram" value={result.leadToCompra.count.toLocaleString('pt-BR')} />
                      <KpiCard label="Média (dias)" value={result.leadToCompra.media != null ? `${result.leadToCompra.media}` : '—'} />
                      <KpiCard label="Mediana (dias)" value={result.leadToCompra.mediana != null ? `${result.leadToCompra.mediana}` : '—'} color={CHART_COLORS[1]} />
                      <KpiCard label="Mínimo / Máximo" value={result.leadToCompra.min != null ? `${result.leadToCompra.min} / ${result.leadToCompra.max}` : '—'} />
                    </div>
                    {result.leadToCompra.rows.length > 0 && (
                      <div className="overflow-x-auto rounded border">
                        <table className="w-full text-sm">
                          <thead className="bg-muted"><tr>{['Nome', 'Email', 'Entrada na base', 'Data compra', 'Dias'].map(h => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
                          <tbody className="divide-y">
                            {result.leadToCompra.rows.slice(0, 100).map((r, i) => (
                              <tr key={i} className="hover:bg-muted/50">
                                <td className="px-3 py-2 max-w-[160px] truncate">{r.nome}</td>
                                <td className="px-3 py-2 text-muted-foreground max-w-[180px] truncate">{r.email}</td>
                                <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(r.dataLead)}</td>
                                <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(r.dataCompra)}</td>
                                <td className="px-3 py-2 text-center font-medium">{r.dias} dias</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </TabsContent>
              <TabsContent value="all" className="mt-4">
                {result.allProductsLTC.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem dados suficientes.</p>
                ) : (
                  <>
                    <p className="mb-3 text-sm text-muted-foreground">{result.allProductsLTC.length} produtos — ordenado por mediana crescente.</p>
                    <HBar
                      data={result.allProductsLTC.map(r => ({ name: r.produto, value: r.mediana }))}
                      nameKey="name" valueKey="value" color={CHART_COLORS[0]}
                    />
                    <div className="overflow-x-auto rounded border mt-4">
                      <table className="w-full text-sm">
                        <thead className="bg-muted"><tr>{['Produto', 'Leads q. compraram', 'Mediana', 'Mínimo', 'Máximo', 'Média'].map(h => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
                        <tbody className="divide-y">
                          {result.allProductsLTC.map((r, i) => (
                            <tr key={i} className="hover:bg-muted/50">
                              <td className="px-3 py-2 max-w-[200px] truncate">{r.produto}</td>
                              <td className="px-3 py-2 text-center">{r.leadsQueCompraram}</td>
                              <td className="px-3 py-2 text-center font-medium">{r.mediana} dias</td>
                              <td className="px-3 py-2 text-center">{r.minimo} dias</td>
                              <td className="px-3 py-2 text-center">{r.maximo} dias</td>
                              <td className="px-3 py-2 text-center">{r.media} dias</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* 🏷 Tags por comprador */}
          <TabsContent value="tags" className="space-y-4 mt-4">
            {result.avgTags.count === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum comprador encontrado na base de leads.</p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <KpiCard label="Compradores na base" value={result.avgTags.count.toLocaleString('pt-BR')} />
                  <KpiCard label="Média de tags" value={result.avgTags.media.toString()} color={CHART_COLORS[1]} />
                  <KpiCard label="Máximo de tags" value={result.avgTags.max.toString()} />
                </div>
                <p className="text-sm text-muted-foreground">Distribuição de quantidade de tags por comprador:</p>
                <HBar
                  data={result.avgTags.distribution.map(d => ({
                    name: (d as typeof d & { label?: string }).label ?? String(d.tags === 99 ? '6+' : d.tags),
                    value: d.count,
                  }))}
                  nameKey="name" valueKey="value" color={CHART_COLORS[2]}
                />
              </>
            )}
          </TabsContent>

          {/* 📣 utm_content */}
          <TabsContent value="utm3" className="space-y-4 mt-4">
            {result.utmContent.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum dado de utm_content encontrado.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{result.utmContent.length} valores distintos de utm_content.</p>
                <HBar
                  data={result.utmContent.slice(0, 30).map(r => ({ name: r.utmContent, value: r.leadsUnicos }))}
                  nameKey="name" valueKey="value" color={CHART_COLORS[0]}
                />
                <div className="overflow-x-auto rounded border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted"><tr><th className="px-3 py-2 text-left font-medium">utm_content</th><th className="px-3 py-2 text-right font-medium">Leads únicos</th></tr></thead>
                    <tbody className="divide-y">
                      {result.utmContent.map((r, i) => (
                        <tr key={i} className="hover:bg-muted/50">
                          <td className="px-3 py-2 font-mono text-xs">{r.utmContent}</td>
                          <td className="px-3 py-2 text-right">{r.leadsUnicos.toLocaleString('pt-BR')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </TabsContent>

          {/* 🚪 Primeira entrada */}
          <TabsContent value="entry" className="space-y-6 mt-4">
            <Tabs defaultValue="by-tag">
              <TabsList>
                <TabsTrigger value="by-tag">Por primeira tag</TabsTrigger>
                <TabsTrigger value="by-form">Por formulário</TabsTrigger>
                <TabsTrigger value="behavior-tag">Comportamento por tag</TabsTrigger>
              </TabsList>

              <TabsContent value="by-tag" className="mt-4">
                {result.firstEntry.byTag.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem dados de tag.</p>
                ) : (
                  <HBar
                    data={result.firstEntry.byTag.slice(0, 20).map(r => ({ name: r.category, value: r.compradores }))}
                    nameKey="name" valueKey="value" color={CHART_COLORS[1]}
                  />
                )}
              </TabsContent>

              <TabsContent value="by-form" className="mt-4">
                {result.firstEntry.byForm.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem dados de formulário.</p>
                ) : (
                  <HBar
                    data={result.firstEntry.byForm.slice(0, 20).map(r => ({ name: r.category, value: r.compradores }))}
                    nameKey="name" valueKey="value" color={CHART_COLORS[3]}
                  />
                )}
              </TabsContent>

              <TabsContent value="behavior-tag" className="mt-4 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Para cada tag, mostra o que os leads compraram <strong>antes</strong> e <strong>depois</strong> de receber essa tag.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <p className="text-xs font-medium">Tag de referência</p>
                    <input
                      className="rounded border px-2 py-1.5 text-sm w-56"
                      list="tag-list"
                      value={selectedTag}
                      onChange={e => { setSelectedTag(e.target.value); setTagResult(null) }}
                    />
                    <datalist id="tag-list">
                      {result.availableTags.map(t => <option key={t} value={t} />)}
                    </datalist>
                  </div>
                  <Button type="button" size="sm" onClick={handleRunTag} disabled={tagRunning || !selectedTag}>
                    {tagRunning ? '⟳ Analisando...' : 'Analisar tag'}
                  </Button>
                </div>
                {tagError && <p className="text-sm text-destructive">{tagError}</p>}
                {tagResult && (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-4">
                      <KpiCard label="Leads com esta tag" value={tagResult.count.toLocaleString('pt-BR')} />
                      <KpiCard label="Compraram antes" value={tagResult.soAntes.toString()} />
                      <KpiCard label="Compraram depois" value={tagResult.soDepois.toString()} color={CHART_COLORS[2]} />
                      <KpiCard label="Média depois" value={tagResult.mediaDepois.toString()} sub={`vs ${tagResult.mediaAntes} antes`} />
                    </div>
                    <div className="grid gap-6 sm:grid-cols-2">
                      <div>
                        <DonutChart data={[
                          { name: 'Só antes', value: tagResult.soAntes },
                          { name: 'Só depois', value: tagResult.soDepois },
                          { name: 'Antes e depois', value: tagResult.ambos },
                          { name: 'Não comprou', value: tagResult.nenhum },
                        ].filter(d => d.value > 0)} />
                      </div>
                      <div>
                        <p className="mb-2 text-sm font-medium">Produtos antes/depois</p>
                        <div className="overflow-x-auto rounded border">
                          <table className="w-full text-sm">
                            <thead className="bg-muted"><tr><th className="px-3 py-2 text-left font-medium">Produto</th><th className="px-3 py-2 text-center font-medium">Antes</th><th className="px-3 py-2 text-center font-medium">Depois</th></tr></thead>
                            <tbody className="divide-y">
                              {tagResult.products.slice(0, 15).map((p, i) => (
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
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* 📡 Funil UTM */}
          <TabsContent value="funnel" className="space-y-4 mt-4">
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium">Dimensão:</p>
              {(['utm_content', 'utm_campaign', 'utm_medium'] as const).map(dim => (
                <Button key={dim} size="sm" variant={utmDim === dim ? 'default' : 'outline'} onClick={() => setUtmDim(dim)}>
                  {dim.replace('utm_', '')}
                </Button>
              ))}
            </div>
            {result.utmFunnel[utmDim]?.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados para {utmDim}.</p>
            ) : (
              <>
                <div className="overflow-x-auto rounded border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">{utmDim}</th>
                        <th className="px-3 py-2 text-right font-medium">Leads</th>
                        <th className="px-3 py-2 text-right font-medium">Compradores</th>
                        <th className="px-3 py-2 text-right font-medium">Taxa conv.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(result.utmFunnel[utmDim] ?? []).map((r, i) => (
                        <tr key={i} className="hover:bg-muted/50">
                          <td className="px-3 py-2 font-mono text-xs max-w-[220px] truncate">{r.utm}</td>
                          <td className="px-3 py-2 text-right">{r.leads.toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2 text-right font-medium">{r.compradores.toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2 text-right"><Badge variant="outline">{r.taxaConversao}%</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <HBar
                  data={(result.utmFunnel[utmDim] ?? []).slice(0, 20).map(r => ({
                    name: r.utm, leads: r.leads, compradores: r.compradores,
                  })).map(r => ({ name: r.name, Leads: r.leads, Compradores: r.compradores }))}
                  nameKey="name" valueKey="Leads" color={CHART_COLORS[0]}
                />
              </>
            )}
          </TabsContent>

          {/* 🔖 Tags dos compradores */}
          <TabsContent value="buyer-tags" className="space-y-4 mt-4">
            {result.buyerTags.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum comprador encontrado na base de leads.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Tags mais frequentes entre compradores de <strong>{selectedProduct}</strong> (% = proporção dos compradores identificados na base de leads).
                </p>
                <HBar
                  data={result.buyerTags.slice(0, 30).map(r => ({ name: r.tag, value: r.compradores }))}
                  nameKey="name" valueKey="value" color={CHART_COLORS[4]}
                />
                <div className="overflow-x-auto rounded border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted"><tr><th className="px-3 py-2 text-left font-medium">Tag</th><th className="px-3 py-2 text-right font-medium">Compradores</th><th className="px-3 py-2 text-right font-medium">%</th></tr></thead>
                    <tbody className="divide-y">
                      {result.buyerTags.map((r, i) => (
                        <tr key={i} className="hover:bg-muted/50">
                          <td className="px-3 py-2">{r.tag}</td>
                          <td className="px-3 py-2 text-right">{r.compradores.toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2 text-right"><Badge variant="outline">{r.pct}%</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </TabsContent>

          {/* 🎯 UTM Compradores */}
          <TabsContent value="utm-attr" className="space-y-4 mt-4">
            <UtmAttrPanel
              token={token}
              product={selectedProduct}
              statuses={selectedStatuses}
              since={since}
              until={until}
              data={utmAttr}
              running={utmAttrRunning}
              error={utmAttrError}
              dim={utmAttrDim}
              sortKey={utmAttrSort}
              sortDesc={utmAttrDesc}
              onRun={handleRunUtmAttr}
              onDim={setUtmAttrDim}
              onSort={(k) => { if (utmAttrSort === k) setUtmAttrDesc(d => !d); else { setUtmAttrSort(k); setUtmAttrDesc(true) } }}
            />
          </TabsContent>
        </>)}
      </Tabs>
    </div>
  )
}

// ─── Funnel Overview panel ────────────────────────────────────────────────────

type OverviewRow = { name: string; leads: number; anyTime: number; lastBefore: number; origin: number }

function TopTable({
  title, rows, valueKey, color,
}: {
  title: string
  rows: OverviewRow[]
  valueKey: 'leads' | 'anyTime' | 'lastBefore' | 'origin'
  color: string
}) {
  const sorted = [...rows].sort((a, b) => b[valueKey] - a[valueKey]).slice(0, 10)
  const max = Math.max(...sorted.map(r => r[valueKey]), 1)

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b bg-muted/40">
        <p className="text-sm font-semibold">{title}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-2 py-1.5 text-center font-medium w-6">#</th>
              <th className="px-3 py-1.5 text-left font-medium">Anúncio</th>
              <th className="px-3 py-1.5 text-right font-medium">Leads</th>
              <th className="px-3 py-1.5 text-right font-medium">Vendas</th>
              <th className="px-3 py-1.5 w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sorted.map((r, i) => {
              const val = r[valueKey]
              return (
                <tr key={r.name} className="hover:bg-muted/40">
                  <td className="px-2 py-1.5 text-center text-muted-foreground">{i + 1}°</td>
                  <td className="px-3 py-1.5 truncate max-w-[200px] font-medium" title={r.name}>{r.name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {r.leads > 0 ? r.leads.toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: val > 0 ? color : undefined }}>
                    {val > 0 ? val : '—'}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(val / max) * 100}%`, backgroundColor: color }} />
                    </div>
                  </td>
                </tr>
              )
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-3 text-center text-muted-foreground">Sem dados.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FunnelOverviewPanel({
  data, running, error, onRun,
}: {
  token: string; statuses: string[]; since: string; until: string
  data: FunnelOverviewData | null; running: boolean; error: string | null
  onRun: () => void
}) {
  // Mescla leads do período com atribuição de vendas por utm_content
  const contentRows: OverviewRow[] = useMemo(() => {
    if (!data) return []
    const leadsMap = new Map(data.leadsByContent.map(r => [r.name, r.leads]))
    const attrMap = new Map(data.byContent.map(r => [r.name, r]))
    const allNames = new Set([...leadsMap.keys(), ...attrMap.keys()])
    return [...allNames].map(name => ({
      name,
      leads:      leadsMap.get(name) ?? 0,
      anyTime:    attrMap.get(name)?.anyTime    ?? 0,
      lastBefore: attrMap.get(name)?.lastBefore ?? 0,
      origin:     attrMap.get(name)?.origin     ?? 0,
    }))
  }, [data])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          Top 10 anúncios (utm_content) por tipo de atribuição — toda a conta, sem filtro de produto.
        </p>
        <Button type="button" size="sm" onClick={onRun} disabled={running}>
          {running ? <><span className="mr-1 animate-spin">⟳</span>Buscando...</> : <><span className="mr-1">▶</span>Buscar Visão Geral</>}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!data && !running && (
        <p className="text-sm text-muted-foreground">Clique em "Buscar Visão Geral" para carregar os dados.</p>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <KpiCard label="Total compradores no período" value={data.totalBuyers.toLocaleString('pt-BR')} />
          </div>

          {/* 4 quadrantes — igual BA25 */}
          <div>
            <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
              Top 10 Anúncios — utm_content
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              Leads = captados no período · Vendas variam por quadrante
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              <TopTable
                title="Por Leads Capturados"
                rows={contentRows}
                valueKey="leads"
                color={CHART_COLORS[0]}
              />
              <TopTable
                title="Por Vendas (Last-touch)"
                rows={contentRows}
                valueKey="lastBefore"
                color={CHART_COLORS[2]}
              />
              <TopTable
                title="Por Vendas (First-touch / Origem)"
                rows={contentRows}
                valueKey="origin"
                color={CHART_COLORS[1]}
              />
              <TopTable
                title="Por Participação (Any-touch)"
                rows={contentRows}
                valueKey="anyTime"
                color={CHART_COLORS[3]}
              />
            </div>
          </div>

          {/* Cobertura por produto */}
          {data.byProduct.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Cobertura por produto</p>
              <p className="text-xs text-muted-foreground">
                Compradores identificados na base de leads vs. sem rastreio.
              </p>
              <div className="overflow-x-auto rounded border">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Produto</th>
                      <th className="px-3 py-2 text-right font-medium">Total vendas</th>
                      <th className="px-3 py-2 text-right font-medium">Com lead</th>
                      <th className="px-3 py-2 text-right font-medium">Sem lead</th>
                      <th className="px-3 py-2 text-right font-medium">% sem rastreio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.byProduct.map((r, i) => {
                      const pctSem = r.totalVendas > 0 ? ((r.vendasSemLead / r.totalVendas) * 100).toFixed(0) : '0'
                      return (
                        <tr key={i} className="hover:bg-muted/50">
                          <td className="px-3 py-2 max-w-[240px] truncate font-medium" title={r.produto}>{r.produto}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.totalVendas.toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2 text-right tabular-nums" style={{ color: CHART_COLORS[1] }}>{r.vendasComLead.toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.vendasSemLead.toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2 text-right">
                            <Badge variant={Number(pctSem) > 50 ? 'destructive' : 'outline'}>{pctSem}%</Badge>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── UTM Compradores panel ────────────────────────────────────────────────────

type SortKey = 'leads' | 'anyTime' | 'lastBefore' | 'origin'

function UtmAttrPanel({
  product, data, running, error, dim, sortKey, sortDesc,
  onRun, onDim, onSort,
}: {
  token: string; product: string; statuses: string[]; since: string; until: string
  data: UtmAttributionData | null; running: boolean; error: string | null
  dim: 'byContent' | 'byCampaign' | 'byMedium'
  sortKey: SortKey; sortDesc: boolean
  onRun: () => void; onDim: (d: 'byContent' | 'byCampaign' | 'byMedium') => void
  onSort: (k: SortKey) => void
}) {
  const DIMS = [
    { key: 'byCampaign' as const, label: 'Campanha' },
    { key: 'byMedium'   as const, label: 'Público (medium)' },
    { key: 'byContent'  as const, label: 'Criativo (content)' },
  ]

  const rows: UtmAttrRow[] = useMemo(() => {
    const raw = data?.[dim] ?? []
    return [...raw].sort((a, b) => {
      const diff = (a[sortKey] as number) - (b[sortKey] as number)
      return sortDesc ? -diff : diff
    })
  }, [data, dim, sortKey, sortDesc])

  function SortTh({ label, k }: { label: string; k: SortKey }) {
    const active = sortKey === k
    return (
      <th
        className="px-3 py-2 text-right font-medium cursor-pointer select-none hover:bg-muted/70"
        onClick={() => onSort(k)}
      >
        {label} {active ? (sortDesc ? '▼' : '▲') : ''}
      </th>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          {DIMS.map(d => (
            <Button key={d.key} type="button" size="sm" variant={dim === d.key ? 'default' : 'outline'} onClick={() => onDim(d.key)}>
              {d.label}
            </Button>
          ))}
        </div>
        <Button type="button" size="sm" onClick={onRun} disabled={running || !product}>
          {running ? <><span className="mr-1 animate-spin">⟳</span>Buscando...</> : <><Play className="mr-1 h-3 w-3" />Buscar UTMs</>}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!data && !running && (
        <p className="text-sm text-muted-foreground">Clique em "Buscar UTMs" para carregar a atribuição de compradores.</p>
      )}

      {data && (
        <>
          <p className="text-sm font-medium">
            Total compradores no período: <strong>{data.totalBuyers.toLocaleString('pt-BR')}</strong>
            {' · '}
            <span className="text-muted-foreground text-xs">
              linha "(sem UTM)" = compradores sem nenhum registro na base de leads
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            <strong>Any-touch</strong> = comprador tinha este UTM em algum momento · <strong>Last</strong> = último UTM antes da compra · <strong>Origin</strong> = primeiro UTM do comprador
          </p>
          <div className="overflow-x-auto rounded border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">UTM</th>
                  <SortTh label="Leads" k="leads" />
                  <SortTh label="Any-touch" k="anyTime" />
                  <SortTh label="Last touch" k="lastBefore" />
                  <SortTh label="Origin" k="origin" />
                  <th className="px-3 py-2 text-right font-medium">Conv. (last)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r, i) => {
                  const taxa = r.leads > 0 ? ((r.lastBefore / r.leads) * 100).toFixed(1) : '—'
                  return (
                    <tr key={i} className="hover:bg-muted/50">
                      <td className="px-3 py-2 font-mono text-xs max-w-[240px] truncate" title={r.utm}>{r.utm}</td>
                      <td className="px-3 py-2 text-right">{r.leads.toLocaleString('pt-BR')}</td>
                      <td className="px-3 py-2 text-right">{r.anyTime > 0 ? r.anyTime : '—'}</td>
                      <td className="px-3 py-2 text-right font-medium">{r.lastBefore > 0 ? r.lastBefore : '—'}</td>
                      <td className="px-3 py-2 text-right">{r.origin > 0 ? r.origin : '—'}</td>
                      <td className="px-3 py-2 text-right"><Badge variant={r.lastBefore > 0 ? 'default' : 'outline'}>{taxa}%</Badge></td>
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">Sem dados.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Última tag antes da compra */}
          {data.lastTagDist.length > 0 && (
            <div className="space-y-2 pt-2">
              <p className="text-sm font-medium">Última tag do comprador antes da compra</p>
              <p className="text-xs text-muted-foreground">Último registro de tag encontrado para cada comprador, anterior à data da venda.</p>
              <div className="overflow-x-auto rounded border">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Tag</th>
                      <th className="px-3 py-2 text-right font-medium">Compradores</th>
                      <th className="px-3 py-2 text-right font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.lastTagDist.map((r, i) => {
                      const pct = data.totalBuyers > 0 ? ((r.compradores / data.totalBuyers) * 100).toFixed(1) : '—'
                      return (
                        <tr key={i} className="hover:bg-muted/50">
                          <td className="px-3 py-2 font-mono text-xs">{r.tag}</td>
                          <td className="px-3 py-2 text-right font-medium">{r.compradores.toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2 text-right"><Badge variant="outline">{pct}%</Badge></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
