import { useState, useEffect } from 'react'
import type { CrossAnalysisData, BehaviorTagResult } from './types'
import { KpiCard, SectionHeader, CHART_COLORS } from './components'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Play } from 'lucide-react'
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

export default function TabAnalisesCruzadas({ token, enabled }: Props) {
  const [products, setProducts] = useState<string[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [selectedProduct, setSelectedProduct] = useState('')
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([])
  const [result, setResult] = useState<CrossAnalysisData | null>(null)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [activeSubTab, setActiveSubTab] = useState('ltc')

  // Behavior-by-tag state
  const [selectedTag, setSelectedTag] = useState('')
  const [tagResult, setTagResult] = useState<BehaviorTagResult | null>(null)
  const [tagRunning, setTagRunning] = useState(false)
  const [tagError, setTagError] = useState<string | null>(null)

  // UTM funnel dim selector
  const [utmDim, setUtmDim] = useState<'utm_content' | 'utm_campaign' | 'utm_medium'>('utm_content')

  // Load product/status options once
  useEffect(() => {
    if (!enabled || products.length > 0) return
    fetch('/api/cruzamento', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setProducts(d.products ?? []); setStatuses(d.statuses ?? []) })
      .catch(() => {})
  }, [enabled, token, products.length])

  async function handleRun() {
    if (!selectedProduct) return
    setRunning(true); setRunError(null); setResult(null)
    try {
      const res = await fetch('/api/cross-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: 'all', product: selectedProduct, statuses: selectedStatuses }),
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
        body: JSON.stringify({ type: 'behavior-tag', tag: selectedTag, statuses: selectedStatuses }),
      })
      if (!res.ok) throw new Error(`Erro ${res.status}`)
      setTagResult(await res.json())
    } catch (e) {
      setTagError((e as Error).message)
    } finally {
      setTagRunning(false)
    }
  }

  if (!enabled) return null

  return (
    <div className="space-y-6">
      {/* Config */}
      <div className="rounded-lg border p-4 space-y-4">
        <SectionHeader title="Análises Cruzadas" description="Cruza dados de leads com vendas para revelar padrões de comportamento." />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">Produto de referência</p>
            <input
              className="w-full rounded border px-2 py-1.5 text-sm"
              placeholder="Buscar produto..."
              list="an-product-list"
              value={selectedProduct}
              onChange={e => setSelectedProduct(e.target.value)}
            />
            <datalist id="an-product-list">
              {products.map(p => <option key={p} value={p} />)}
            </datalist>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Status das vendas</p>
            <div className="max-h-32 overflow-y-auto rounded border p-1 space-y-0.5">
              {statuses.map(s => (
                <label key={s} className="flex cursor-pointer items-center gap-2 rounded px-2 py-0.5 text-xs hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={selectedStatuses.includes(s)}
                    onChange={e => setSelectedStatuses(e.target.checked ? [...selectedStatuses, s] : selectedStatuses.filter(v => v !== s))}
                    className="h-3 w-3"
                  />
                  <span>{s}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Vazio = todos</p>
          </div>
          <div className="flex items-end">
            <Button onClick={handleRun} disabled={running || !selectedProduct}>
              {running ? <><span className="mr-2 animate-spin">⟳</span>Analisando...</> : <><Play className="mr-2 h-4 w-4" />Rodar análises</>}
            </Button>
          </div>
        </div>
        {runError && <p className="text-sm text-destructive">{runError}</p>}
      </div>

      {/* Resultados */}
      {result && (
        <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
          <TabsList className="flex h-auto flex-wrap gap-1 bg-muted p-1">
            {[
              { id: 'ltc', label: '⏱ Lead→Compra' },
              { id: 'tags', label: '🏷 Tags/Comprador' },
              { id: 'utm3', label: '📣 utm_content' },
              { id: 'entry', label: '🚪 Primeira entrada' },
              { id: 'funnel', label: '📡 Funil UTM' },
              { id: 'buyer-tags', label: '🔖 Tags compradores' },
            ].map(t => (
              <TabsTrigger key={t.id} value={t.id} className="text-xs sm:text-sm">{t.label}</TabsTrigger>
            ))}
          </TabsList>

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
                  <Button size="sm" onClick={handleRunTag} disabled={tagRunning || !selectedTag}>
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
        </Tabs>
      )}
    </div>
  )
}
