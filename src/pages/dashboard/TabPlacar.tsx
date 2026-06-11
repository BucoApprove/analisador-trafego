import { useState, useCallback, useEffect } from 'react'
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props { token: string; enabled: boolean }
type Categoria = 'core' | 'porta' | 'low'

interface Oferta { code: string; vendas: number; liquido: number }
interface Produto {
  nome: string
  categoria: Categoria
  vendas: number
  liquido: number
  meta: number | null
  ofertas?: Oferta[]
}
interface PlacarResp {
  month: string
  produtos: Produto[]
  totalLiquido: number
  totalVendas: number
  totalMeta: number
  porCategoria: Record<Categoria, number>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function currentMonthStr() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
}

function daysInfo(month: string) {
  const [y, m] = month.split('-').map(Number)
  const today = new Date()
  const lastDay = new Date(y, m, 0).getDate()
  const isCurrent = today.getFullYear() === y && today.getMonth() + 1 === m
  const dayOfMonth = isCurrent ? today.getDate() : lastDay
  const diasRestantes = Math.max(lastDay - dayOfMonth + 1, 1)
  return { lastDay, dayOfMonth, diasRestantes, isCurrent }
}

const CAT_LABEL: Record<Categoria, string> = {
  core: 'Produtos core',
  porta: 'Portas de entrada',
  low: 'Low ticket',
}
const CAT_ORDER: Categoria[] = ['core', 'porta', 'low']

// ─── Linha de produto (com drill-down de ofertas) ────────────────────────────

function ProdutoRow({ p, stripe }: { p: Produto; stripe: boolean }) {
  const [open, setOpen] = useState(false)
  const pct = p.meta && p.meta > 0 ? (p.liquido / p.meta) * 100 : null
  const hasOfertas = (p.ofertas?.length ?? 0) > 1
  return (
    <>
      <tr className={`border-b ${stripe ? 'bg-muted/20' : ''}`}>
        <td className="px-4 py-2.5 font-medium">
          <span className="inline-flex items-center gap-1.5">
            {hasOfertas && (
              <button onClick={() => setOpen(o => !o)} className="text-muted-foreground hover:text-foreground">
                {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            )}
            {p.nome}
          </span>
        </td>
        <td className="px-4 py-2.5 text-right">{p.vendas}</td>
        <td className="px-4 py-2.5 text-right font-semibold">{fmtBRL(p.liquido)}</td>
        <td className="px-4 py-2.5 text-right text-muted-foreground">{p.meta && p.meta > 0 ? fmtBRL(p.meta) : '—'}</td>
        <td className="px-4 py-2.5 text-right">
          {pct !== null ? (
            <span className={pct >= 100 ? 'text-green-600 font-semibold' : pct >= 70 ? 'text-yellow-600' : 'text-red-600'}>
              {pct.toFixed(0)}%
            </span>
          ) : '—'}
        </td>
      </tr>
      {open && p.ofertas?.map(o => (
        <tr key={o.code} className="border-b bg-muted/5 text-xs text-muted-foreground">
          <td className="pl-10 py-1.5 italic">oferta {o.code}</td>
          <td className="px-4 py-1.5 text-right">{o.vendas}</td>
          <td className="px-4 py-1.5 text-right">{fmtBRL(o.liquido)}</td>
          <td colSpan={2} />
        </tr>
      ))}
    </>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function TabPlacar({ token, enabled }: Props) {
  const [month, setMonth] = useState(currentMonthStr)
  const [data, setData] = useState<PlacarResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (m: string) => {
    setLoading(true)
    setError('')
    try {
      const r = await fetch(`/api/placar?month=${m}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.detail ?? j.error ?? `placar: ${r.status}`)
      }
      setData(await r.json())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { if (enabled) load(month) }, [enabled, month, load])

  const { dayOfMonth, lastDay, diasRestantes } = daysInfo(month)
  const totalLiquido = data?.totalLiquido ?? 0
  const totalMeta = data?.totalMeta ?? 0
  const pctMeta = totalMeta > 0 ? (totalLiquido / totalMeta) * 100 : null
  const pctRitmo = (dayOfMonth / lastDay) * 100  // % do mês decorrido
  const abaixoDoRitmo = pctMeta !== null && pctMeta < pctRitmo

  const monthOptions: string[] = []
  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    monthOptions.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const produtos = data?.produtos ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">Placar do Negócio 🎯</h2>
          <p className="text-xs text-muted-foreground">Faturamento líquido (comissão Hotmart) por produto · {month}</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={month} onChange={e => setMonth(e.target.value)} className="text-sm border rounded px-2 py-1.5 bg-background">
            {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button onClick={() => load(month)} disabled={loading} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border bg-background hover:bg-muted transition-colors disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-xs text-blue-800">
        ⚙️ Aba em construção (fase 1: vendas + faturamento líquido). Gasto Meta, ROAS, leads e alertas chegam nas próximas fases.
      </div>

      {error && <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      {/* Hero */}
      {data && (
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs text-muted-foreground mb-1">Faturamento líquido do mês</p>
          <div className="flex items-end gap-4 flex-wrap">
            <p className="text-3xl font-bold">{fmtBRL(totalLiquido)}</p>
            {pctMeta !== null && (
              <p className={`text-sm font-medium mb-1 ${pctMeta >= 100 ? 'text-green-600' : abaixoDoRitmo ? 'text-red-600' : 'text-yellow-600'}`}>
                {pctMeta.toFixed(0)}% da meta {totalMeta > 0 && `(${fmtBRL(totalMeta)})`}
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Dia {dayOfMonth}/{lastDay} · {diasRestantes} dias restantes
            {pctMeta !== null && ` · ritmo do mês: ${pctRitmo.toFixed(0)}%`}
            {abaixoDoRitmo && <span className="text-red-600 font-medium"> · ⚠️ abaixo do ritmo</span>}
          </p>
        </div>
      )}

      {/* KPIs */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Líquido core',  value: fmtBRL(data.porCategoria.core) },
            { label: 'Portas (Imersão/Quiz)', value: fmtBRL(data.porCategoria.porta) },
            { label: 'Low ticket',    value: fmtBRL(data.porCategoria.low) },
            { label: 'Vendas',        value: String(data.totalVendas) },
          ].map(c => (
            <div key={c.label} className="rounded-lg border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">{c.label}</p>
              <p className="text-xl font-bold">{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabela por categoria */}
      {produtos.length > 0 && (
        <div className="space-y-5">
          {CAT_ORDER.map(cat => {
            const rows = produtos.filter(p => p.categoria === cat)
            if (rows.length === 0) return null
            return (
              <div key={cat} className="rounded-lg border bg-card overflow-hidden">
                <div className="px-4 py-2 bg-muted/50 border-b text-sm font-semibold">{CAT_LABEL[cat]}</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left px-4 py-2 font-medium">Produto</th>
                      <th className="text-right px-4 py-2 font-medium">Vendas</th>
                      <th className="text-right px-4 py-2 font-medium">Líquido</th>
                      <th className="text-right px-4 py-2 font-medium">Meta</th>
                      <th className="text-right px-4 py-2 font-medium">% Meta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p, i) => <ProdutoRow key={p.nome} p={p} stripe={i % 2 !== 0} />)}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}

      {loading && !data && (
        <div className="flex justify-center py-12 text-muted-foreground text-sm">Carregando...</div>
      )}
    </div>
  )
}
