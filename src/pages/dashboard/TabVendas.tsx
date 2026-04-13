import { useState, useCallback } from 'react'
import { useDashboardFetch } from './hooks'
import type { VendasData } from './types'
import { KpiCard, SectionHeader, TabLoading, TabError, formatBRL } from './components'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Download, X } from 'lucide-react'

interface Props { token: string; enabled: boolean }

function fmtDate(val: string | null): string {
  if (!val) return '—'
  try { return new Date(val).toLocaleDateString('pt-BR') } catch { return val }
}

function fmtBRL(val: number | null): string {
  if (val == null) return '—'
  return formatBRL(val)
}

export default function TabVendas({ token, enabled }: Props) {
  const [statuses, setStatuses] = useState<string[]>([])
  const [products, setProducts] = useState<string[]>([])
  const [states, setStates] = useState<string[]>([])
  const [paymentMethods, setPaymentMethods] = useState<string[]>([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [cursor, setCursor] = useState<string>('0')
  const [exportLoading, setExportLoading] = useState(false)

  function buildUrl(offset: string, exportMode = false) {
    const p = new URLSearchParams()
    statuses.forEach(s => p.append('status', s))
    products.forEach(s => p.append('product', s))
    states.forEach(s => p.append('state', s))
    paymentMethods.forEach(s => p.append('paymentMethod', s))
    if (dateFrom) p.set('dateFrom', dateFrom)
    if (dateTo) p.set('dateTo', dateTo)
    p.set('offset', offset)
    if (exportMode) p.set('export', '1')
    return `/api/vendas-data?${p.toString()}`
  }

  const url = buildUrl(cursor)
  const { data, status, error, refetch } = useDashboardFetch<VendasData>(url, token, { enabled })

  // Options are fetched once for the filter dropdowns
  const optionsUrl = '/api/vendas-data?mode=options'
  const { data: opts } = useDashboardFetch<{ statuses: string[]; products: string[]; states: string[]; paymentMethods: string[] }>(
    optionsUrl, token, { enabled }
  )

  const hasFilters = statuses.length > 0 || products.length > 0 || states.length > 0 || paymentMethods.length > 0 || dateFrom || dateTo

  function clearFilters() {
    setStatuses([]); setProducts([]); setStates([]); setPaymentMethods([])
    setDateFrom(''); setDateTo(''); setCursor('0')
  }

  const handleApply = useCallback(() => { setCursor('0') }, [])

  async function handleExport() {
    setExportLoading(true)
    try {
      const res = await fetch(buildUrl('0', true), { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`Erro ${res.status}`)
      const json: VendasData = await res.json()
      const headers = ['Data Pedido', 'Data Aprovação', 'Nome', 'Email', 'Telefone', 'Cidade', 'Estado', 'Produto', 'Valor Produto', 'Valor Pago', 'Status', 'Método Pagamento', 'Parcelas']
      const rows = json.vendas.map(v => [
        fmtDate(v.dataPedido), fmtDate(v.dataAprovacao), v.nomeComprador, v.emailComprador,
        v.telefone ?? '', v.cidade ?? '', v.estado ?? '', v.produto,
        v.valorProduto?.toFixed(2) ?? '', v.valorPago?.toFixed(2) ?? '',
        v.status, v.metodoPagamento ?? '', v.parcelas ?? '',
      ])
      const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = 'vendas.csv'
      link.click()
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setExportLoading(false)
    }
  }

  function MultiSelect({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <div className="max-h-32 overflow-y-auto rounded border p-1 space-y-0.5">
          {options.map(opt => (
            <label key={opt} className="flex cursor-pointer items-center gap-2 rounded px-2 py-0.5 text-sm hover:bg-muted">
              <input
                type="checkbox"
                checked={value.includes(opt)}
                onChange={e => onChange(e.target.checked ? [...value, opt] : value.filter(v => v !== opt))}
                className="h-3 w-3"
              />
              <span className="truncate">{opt}</span>
            </label>
          ))}
        </div>
        {value.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {value.map(v => (
              <Badge key={v} variant="secondary" className="text-xs gap-1">
                {v}
                <X className="h-2.5 w-2.5 cursor-pointer" onClick={() => onChange(value.filter(x => x !== v))} />
              </Badge>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (status === 'idle' || status === 'loading') return <TabLoading />
  if (status === 'error') return <TabError message={error ?? 'Erro ao carregar'} onRetry={refetch} />
  if (!data) return null

  const { metrics, filters } = data
  const avail = opts ?? filters

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <div className="rounded-lg border p-4">
        <div className="mb-3 flex items-center justify-between">
          <SectionHeader title="Filtros" />
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="mr-1 h-3 w-3" /> Limpar
            </Button>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MultiSelect label="Status" options={avail.statuses} value={statuses} onChange={setStatuses} />
          <MultiSelect label="Produto" options={avail.products} value={products} onChange={setProducts} />
          <MultiSelect label="Estado" options={avail.states} value={states} onChange={setStates} />
          <MultiSelect label="Método de Pagamento" options={avail.paymentMethods} value={paymentMethods} onChange={setPaymentMethods} />
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Data início</p>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 text-xs w-36" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Data fim</p>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 text-xs w-36" />
          </div>
          <Button size="sm" onClick={handleApply}>Aplicar filtros</Button>
        </div>
      </div>

      {/* Métricas */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Transações" value={metrics.total.toLocaleString('pt-BR')} />
        <KpiCard label="Compradores únicos" value={metrics.uniqueBuyers.toLocaleString('pt-BR')} />
        <KpiCard label="Receita total" value={formatBRL(metrics.revenue)} color="#37B24D" />
        <KpiCard label="Produtos distintos" value={metrics.distinctProducts.toLocaleString('pt-BR')} />
      </div>

      {/* Tabela */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {`${data.total.toLocaleString('pt-BR')} transações`}
          </p>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exportLoading}>
            <Download className="mr-2 h-4 w-4" />
            {exportLoading ? 'Exportando...' : 'Exportar CSV'}
          </Button>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                {['Data Pedido', 'Nome', 'Email', 'Estado', 'Produto', 'Valor Pago', 'Status', 'Método'].map(h => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.vendas.map((v, i) => (
                <tr key={v.txnId || i} className="hover:bg-muted/50">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{fmtDate(v.dataPedido)}</td>
                  <td className="px-3 py-2 font-medium max-w-[160px] truncate">{v.nomeComprador}</td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[180px] truncate">{v.emailComprador}</td>
                  <td className="px-3 py-2 text-muted-foreground">{v.estado ?? '—'}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate">{v.produto}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{fmtBRL(v.valorPago)}</td>
                  <td className="px-3 py-2">
                    <Badge variant={v.status === 'COMPLETO' ? 'default' : 'secondary'} className="text-xs">
                      {v.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{v.metodoPagamento ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        <div className="flex justify-between items-center pt-1">
          <Button
            variant="outline" size="sm"
            disabled={cursor === '0'}
            onClick={() => setCursor(String(Math.max(0, parseInt(cursor) - 50)))}
          >
            ← Anterior
          </Button>
          <span className="text-xs text-muted-foreground">
            {parseInt(cursor) + 1}–{Math.min(parseInt(cursor) + 50, data.total)} de {data.total.toLocaleString('pt-BR')}
          </span>
          {data.nextCursor ? (
            <Button variant="outline" size="sm" onClick={() => setCursor(data.nextCursor!)}>
              Próximo →
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Próximo →</Button>
          )}
        </div>
      </div>
    </div>
  )
}
