import { useState, useEffect } from 'react'
import type { CruzamentoData } from './types'
import { KpiCard, SectionHeader, TabLoading, CHART_COLORS } from './components'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { X, Play, ChevronDown, ChevronUp } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts'

interface Props { token: string; enabled: boolean }

function fmtDate(val: string | null): string {
  if (!val) return '—'
  try { return new Date(val).toLocaleDateString('pt-BR') } catch { return val }
}

export default function TabCruzamento({ token, enabled }: Props) {
  const [products, setProducts] = useState<string[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [groupA, setGroupA] = useState<string[]>([])
  const [productB, setProductB] = useState('')
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([])
  const [result, setResult] = useState<CruzamentoData | null>(null)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [showOnlyA, setShowOnlyA] = useState(false)
  const [showBFirst, setShowBFirst] = useState(false)
  const [loadingOpts, setLoadingOpts] = useState(false)

  useEffect(() => {
    if (!enabled || products.length > 0) return
    setLoadingOpts(true)
    fetch('/api/cruzamento', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setProducts(d.products ?? []); setStatuses(d.statuses ?? []) })
      .catch(() => {})
      .finally(() => setLoadingOpts(false))
  }, [enabled, token, products.length])

  async function handleRun() {
    if (groupA.length === 0 || !productB) return
    setRunning(true); setRunError(null)
    try {
      const res = await fetch('/api/cruzamento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ groupA, productB, statuses: selectedStatuses }),
      })
      if (res.status === 401) { sessionStorage.removeItem('dashboard-token'); window.location.reload(); return }
      if (!res.ok) throw new Error(`Erro ${res.status}: ${await res.text()}`)
      setResult(await res.json())
    } catch (e) {
      setRunError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  function MultiSelect({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
    const [search, setSearch] = useState('')
    const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()))
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">{label}</p>
        <input
          className="w-full rounded border px-2 py-1 text-xs"
          placeholder="Buscar..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="max-h-40 overflow-y-auto rounded border p-1 space-y-0.5">
          {filtered.map(opt => (
            <label key={opt} className="flex cursor-pointer items-center gap-2 rounded px-2 py-0.5 text-xs hover:bg-muted">
              <input
                type="checkbox"
                checked={value.includes(opt)}
                onChange={e => onChange(e.target.checked ? [...value, opt] : value.filter(v => v !== opt))}
                className="h-3 w-3"
              />
              <span className="truncate">{opt}</span>
            </label>
          ))}
          {filtered.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">Nenhum resultado</p>}
        </div>
        {value.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {value.map(v => (
              <Badge key={v} variant="secondary" className="text-xs gap-1 max-w-[160px] truncate">
                {v}
                <X className="h-2.5 w-2.5 cursor-pointer shrink-0" onClick={() => onChange(value.filter(x => x !== v))} />
              </Badge>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (!enabled) return null

  const sum = result?.summary

  // Funil: total A → conversões A→B
  const funnelData = sum
    ? [
        { name: 'Compradores Grupo A', value: sum.totalGrupoA, fill: CHART_COLORS[0] },
        { name: `Convertidos A→B`, value: sum.compraramAmbos, fill: CHART_COLORS[2] },
      ]
    : []

  // Sequência
  const seqData = sum
    ? [
        { name: 'A primeiro', value: sum.compraramAmbos },
        { name: 'B primeiro', value: sum.bPrimeiro },
        { name: 'Mesma data', value: sum.mesmaDia },
      ].filter(d => d.value > 0)
    : []

  return (
    <div className="space-y-6">
      {/* Config */}
      <div className="rounded-lg border p-4 space-y-4">
        <SectionHeader title="Cruzamento de Produtos" description="Quem comprou o Grupo A e também comprou o Produto B?" />

        {loadingOpts ? (
          <TabLoading />
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <MultiSelect
              label="Grupo A — produto(s) de origem"
              options={products}
              value={groupA}
              onChange={setGroupA}
            />

            <div className="space-y-1">
              <p className="text-sm font-medium">Produto B — destino</p>
              <input
                className="w-full rounded border px-2 py-1 text-xs"
                placeholder="Buscar produto B..."
                list="product-b-list"
                value={productB}
                onChange={e => setProductB(e.target.value)}
              />
              <datalist id="product-b-list">
                {products.map(p => <option key={p} value={p} />)}
              </datalist>
              {productB && (
                <Badge variant="outline" className="text-xs gap-1">
                  {productB}
                  <X className="h-2.5 w-2.5 cursor-pointer" onClick={() => setProductB('')} />
                </Badge>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">Status das vendas</p>
              <div className="max-h-40 overflow-y-auto rounded border p-1 space-y-0.5">
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
              <p className="text-xs text-muted-foreground">Vazio = todos os status</p>
            </div>
          </div>
        )}

        <Button
          onClick={handleRun}
          disabled={running || groupA.length === 0 || !productB}
        >
          {running ? <><span className="mr-2 h-4 w-4 animate-spin">⟳</span>Analisando...</> : <><Play className="mr-2 h-4 w-4" />Analisar</>}
        </Button>
        {runError && <p className="text-sm text-destructive">{runError}</p>}
      </div>

      {/* Resultados */}
      {result && sum && (
        <div className="space-y-6">
          {/* Alerta B→A */}
          {sum.bPrimeiro > 0 && (
            <div className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
              <strong>{sum.bPrimeiro}</strong> comprador(es) adquiriram o Produto B <strong>antes</strong> do Grupo A — desconsiderados do funil A→B.
            </div>
          )}

          {/* KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard label="Compradores Grupo A" value={sum.totalGrupoA.toLocaleString('pt-BR')} />
            <KpiCard label="Compradores Produto B" value={sum.totalProdutoB.toLocaleString('pt-BR')} />
            <KpiCard label="Convertidos A→B" value={sum.compraramAmbos.toLocaleString('pt-BR')} color={CHART_COLORS[2]} />
            <KpiCard label="Taxa de conversão A→B" value={`${sum.taxaConversao}%`} color={CHART_COLORS[2]} />
            <KpiCard
              label="Mediana entre compras"
              value={sum.mediaDiasAtoB != null ? `${Math.round(sum.mediaDiasAtoB)} dias` : '—'}
            />
          </div>

          {/* Gráficos */}
          {sum.compraramAmbos > 0 && (
            <div className="grid gap-6 sm:grid-cols-2">
              {/* Funil */}
              <div className="rounded-lg border p-4">
                <p className="mb-3 text-sm font-semibold">Funil de Conversão</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart layout="vertical" data={funnelData} margin={{ left: 10, right: 40 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => (v as number).toLocaleString('pt-BR')} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {funnelData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Sequência */}
              <div className="rounded-lg border p-4">
                <p className="mb-3 text-sm font-semibold">Sequência de Compra</p>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={seqData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70}>
                      {seqData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => (v as number).toLocaleString('pt-BR')} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Tabela de convertidos A→B */}
          {result.intersection.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Convertidos A→B ({result.intersection.length.toLocaleString('pt-BR')})</p>
                <Button variant="outline" size="sm" onClick={() => {
                  const headers = ['Nome', 'Email', 'Produto A', 'Data A', 'Data B', 'Dias entre', 'Sequência']
                  const rows = result.intersection.map(r => [r.nome, r.email, r.produtoA, fmtDate(r.dataA), fmtDate(r.dataB), r.diasEntre ?? '', r.sequencia])
                  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
                  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
                  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'cruzamento.csv'; link.click()
                }}>
                  ⬇ Exportar CSV
                </Button>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>{['Nome', 'Email', 'Produto A', 'Data A', 'Data B', 'Dias entre'].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {result.intersection.map((r, i) => (
                      <tr key={i} className="hover:bg-muted/50">
                        <td className="px-3 py-2 font-medium max-w-[160px] truncate">{r.nome}</td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[180px] truncate">{r.email}</td>
                        <td className="px-3 py-2 max-w-[180px] truncate">{r.produtoA}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtDate(r.dataA)}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtDate(r.dataB)}</td>
                        <td className="px-3 py-2 text-center">{r.diasEntre != null ? `${r.diasEntre} dias` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Expandíveis */}
          <div className="space-y-2">
            <button
              className="flex w-full items-center justify-between rounded-lg border px-4 py-2 text-sm hover:bg-muted"
              onClick={() => setShowBFirst(v => !v)}
            >
              <span>Compraram Produto B antes do Grupo A (desconsiderados do funil) — {result.bFirst.length}</span>
              {showBFirst ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showBFirst && result.bFirst.length > 0 && (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted"><tr>{['Nome', 'Email', 'Produto A', 'Data A', 'Data B'].map(h => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
                  <tbody className="divide-y">
                    {result.bFirst.map((r, i) => (
                      <tr key={i} className="hover:bg-muted/50">
                        <td className="px-3 py-2 font-medium max-w-[160px] truncate">{r.nome}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.email}</td>
                        <td className="px-3 py-2 max-w-[180px] truncate">{r.produtoA}</td>
                        <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.dataA)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.dataB)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <button
              className="flex w-full items-center justify-between rounded-lg border px-4 py-2 text-sm hover:bg-muted"
              onClick={() => setShowOnlyA(v => !v)}
            >
              <span>Só compraram Grupo A (não foram para B) — {result.onlyACount.toLocaleString('pt-BR')}</span>
              {showOnlyA ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showOnlyA && (
              <p className="px-4 py-2 text-sm text-muted-foreground">
                {result.onlyACount.toLocaleString('pt-BR')} compradores do Grupo A não adquiriram o Produto B no período analisado.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
