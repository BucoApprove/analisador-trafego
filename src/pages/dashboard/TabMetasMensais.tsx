import { useState, useCallback, useEffect } from 'react'
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'

function ExpandableRow({ children, stripe, sources }: {
  children: React.ReactNode
  stripe: boolean
  sources: HotmartProduct[]
}) {
  const [open, setOpen] = useState(false)
  const cols = 7
  return (
    <>
      <tr
        className={`border-b ${stripe ? 'bg-muted/20' : ''} ${sources.length > 0 ? 'cursor-pointer hover:bg-muted/30' : ''}`}
        onClick={() => sources.length > 0 && setOpen(o => !o)}
      >
        {children}
        <td className="pr-2 text-right">
          {sources.length > 0 && (
            open ? <ChevronUp className="h-3 w-3 inline text-muted-foreground" />
                 : <ChevronDown className="h-3 w-3 inline text-muted-foreground" />
          )}
        </td>
      </tr>
      {open && sources.map(p => (
        <tr key={p.id} className="border-b bg-muted/5 text-xs text-muted-foreground">
          <td className="pl-8 py-1.5 italic">{p.name}</td>
          <td />
          <td className="px-4 py-1.5 text-right">{fmtBRL(p.total)}</td>
          <td colSpan={cols - 3} className="px-4 py-1.5 text-right">{p.count} venda{p.count !== 1 ? 's' : ''}</td>
        </tr>
      ))}
    </>
  )
}

interface Props { token: string; enabled: boolean }

interface GoalItem { name: string; meta: number }
interface MonthlyGoalsResp {
  month: string
  goals: GoalItem[]
  totalMeta: number
  configured: boolean
}

interface HotmartProduct { id: number; name: string; total: number; count: number }
interface HotmartResp {
  month: string
  products: HotmartProduct[]
  grandTotal: number
  totalTransactions: number
}

// Manual mapping: planilha name → keywords
// Prefix "=" for exact match (case-insensitive), plain string for substring match
const PRODUCT_MAP: Record<string, string[]> = {
  'Buco Approve':   ['=bucoapprove'],
  'Renovação BA':   ['renovação ba', 'renovacao ba', '=renovação buco approve', 'renovação buco'],
  'Mentoria':       ['mentoria'],
  'Planejamento':   ['planejamento'],
  'Pós Pato':       ['pós pato', 'pos pato'],
  'Pós Anato':      ['pós anato', 'pos anato'],
  'Low tickets':    ['low ticket'],
  'Outros':         [],
}

function matchHotmart(hotmartName: string): string | null {
  const lower = hotmartName.toLowerCase().trim()
  for (const [planilhaName, keywords] of Object.entries(PRODUCT_MAP)) {
    if (planilhaName === 'Outros') continue
    for (const k of keywords) {
      if (k.startsWith('=')) {
        if (lower === k.slice(1)) return planilhaName
      } else {
        if (lower.includes(k)) return planilhaName
      }
    }
  }
  return null
}

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function currentMonthStr() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
}

function daysLeftInMonth(month: string) {
  const [y, m] = month.split('-').map(Number)
  const today = new Date()
  const lastDay = new Date(y, m, 0).getDate()
  const todayDay = today.getFullYear() === y && today.getMonth() + 1 === m
    ? today.getDate()
    : lastDay
  return Math.max(lastDay - todayDay + 1, 1)
}

export default function TabMetasMensais({ token, enabled }: Props) {
  const [month, setMonth] = useState(currentMonthStr)
  const [goalsData, setGoalsData] = useState<MonthlyGoalsResp | null>(null)
  const [hotmartData, setHotmartData] = useState<HotmartResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showUnmapped, setShowUnmapped] = useState(false)

  const headers = { Authorization: `Bearer ${token}` }

  const load = useCallback(async (m: string) => {
    setLoading(true)
    setError('')
    try {
      const [gr, hr] = await Promise.all([
        fetch(`/api/monthly-goals?month=${m}`, { headers }),
        fetch(`/api/hotmart-sales?month=${m}`, { headers }),
      ])
      if (!gr.ok) throw new Error(`monthly-goals: ${gr.status}`)
      if (!hr.ok) throw new Error(`hotmart-sales: ${hr.status}`)
      const [gd, hd]: [MonthlyGoalsResp, HotmartResp] = await Promise.all([gr.json(), hr.json()])
      setGoalsData(gd)
      setHotmartData(hd)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (enabled) load(month)
  }, [enabled, month, load])

  // Build faturado map from Hotmart → planilha names
  const faturadoMap: Record<string, number> = {}
  const sourcesMap: Record<string, HotmartProduct[]> = {}
  const unmappedProducts: HotmartProduct[] = []

  if (hotmartData) {
    for (const p of hotmartData.products) {
      const planilhaName = matchHotmart(p.name)
      if (planilhaName) {
        faturadoMap[planilhaName] = (faturadoMap[planilhaName] ?? 0) + p.total
        sourcesMap[planilhaName] = [...(sourcesMap[planilhaName] ?? []), p]
      } else {
        unmappedProducts.push(p)
        faturadoMap['Outros'] = (faturadoMap['Outros'] ?? 0) + p.total
        sourcesMap['Outros'] = [...(sourcesMap['Outros'] ?? []), p]
      }
    }
  }

  const goals = goalsData?.goals ?? []
  const diasRestantes = daysLeftInMonth(month)
  const totalMeta = goals.reduce((s, g) => s + g.meta, 0)
  const totalFaturado = Object.values(faturadoMap).reduce((s, v) => s + v, 0)
  const totalRestante = totalMeta - totalFaturado

  // Month options: current month + previous 5
  const monthOptions: string[] = []
  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    monthOptions.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">Metas Mensais</h2>
          <p className="text-xs text-muted-foreground">Faturamento Hotmart vs. metas da planilha</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="text-sm border rounded px-2 py-1.5 bg-background"
          >
            {monthOptions.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button
            onClick={() => load(month)}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border bg-background hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!goalsData?.configured && goalsData && (
        <div className="rounded-md bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800">
          Planilha de metas não configurada para {month}. Configure <code>GOALS_SHEET_GIDS</code> no Vercel.
        </div>
      )}

      {/* Summary KPI cards */}
      {(goalsData || hotmartData) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Meta Total', value: fmtBRL(totalMeta), sub: null },
            { label: 'Faturado', value: fmtBRL(totalFaturado), sub: `${hotmartData?.totalTransactions ?? 0} vendas` },
            { label: 'Restante', value: fmtBRL(totalRestante), sub: totalMeta > 0 ? `${Math.round((totalFaturado / totalMeta) * 100)}% atingido` : null },
            { label: 'Meta/Dia', value: fmtBRL(Math.max(totalRestante, 0) / diasRestantes), sub: `${diasRestantes} dias restantes` },
          ].map(card => (
            <div key={card.label} className="rounded-lg border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">{card.label}</p>
              <p className="text-xl font-bold">{card.value}</p>
              {card.sub && <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Main table */}
      {goals.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-2.5 font-medium">Produto</th>
                <th className="text-right px-4 py-2.5 font-medium">Meta</th>
                <th className="text-right px-4 py-2.5 font-medium">Faturado</th>
                <th className="text-right px-4 py-2.5 font-medium">Restante</th>
                <th className="text-right px-4 py-2.5 font-medium">Meta/Dia</th>
                <th className="text-right px-4 py-2.5 font-medium">% Meta</th>
                <th className="text-center px-4 py-2.5 font-medium">Status</th>
                <th className="w-4" />
              </tr>
            </thead>
            <tbody>
              {goals.map((g, i) => {
                const fat = faturadoMap[g.name] ?? 0
                const restante = g.meta - fat
                const pct = g.meta > 0 ? (fat / g.meta) * 100 : null
                const metaDia = g.meta > 0 ? Math.max(restante, 0) / diasRestantes : 0
                const status = pct === null ? '—'
                  : pct >= 100 ? '✅ Atingido'
                  : pct >= 70 ? '🟡 Em andamento'
                  : '🔴 Abaixo'
                const sources = sourcesMap[g.name] ?? []
                return (
                  <ExpandableRow key={g.name} stripe={i % 2 !== 0} sources={sources}>
                    <td className="px-4 py-2.5 font-medium">{g.name}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{g.meta > 0 ? fmtBRL(g.meta) : '—'}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{fat > 0 ? fmtBRL(fat) : '—'}</td>
                    <td className={`px-4 py-2.5 text-right ${restante > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                      {g.meta > 0 ? fmtBRL(restante) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      {g.meta > 0 && metaDia > 0 ? fmtBRL(metaDia) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {pct !== null ? (
                        <span className={pct >= 100 ? 'text-green-600 font-semibold' : pct >= 70 ? 'text-yellow-600' : 'text-red-600'}>
                          {pct.toFixed(1)}%
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs">{status}</td>
                  </ExpandableRow>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/50 font-semibold">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right">{fmtBRL(totalMeta)}</td>
                <td className="px-4 py-2.5 text-right">{fmtBRL(totalFaturado)}</td>
                <td className={`px-4 py-2.5 text-right ${totalRestante > 0 ? 'text-orange-600' : 'text-green-600'}`}>{fmtBRL(totalRestante)}</td>
                <td className="px-4 py-2.5 text-right">{fmtBRL(Math.max(totalRestante, 0) / diasRestantes)}</td>
                <td className="px-4 py-2.5 text-right">
                  {totalMeta > 0 ? (
                    <span className={(totalFaturado / totalMeta) * 100 >= 100 ? 'text-green-600' : ''}>
                      {((totalFaturado / totalMeta) * 100).toFixed(1)}%
                    </span>
                  ) : '—'}
                </td>
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {loading && goals.length === 0 && (
        <div className="flex justify-center py-12 text-muted-foreground text-sm">Carregando...</div>
      )}

      {/* Unmapped Hotmart products */}
      {unmappedProducts.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <button
            onClick={() => setShowUnmapped(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/40 transition-colors"
          >
            <span>Produtos Hotmart não mapeados ({unmappedProducts.length})</span>
            {showUnmapped ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showUnmapped && (
            <div className="border-t overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="text-left px-4 py-2 font-medium">Nome no Hotmart</th>
                    <th className="text-right px-4 py-2 font-medium">Faturado</th>
                    <th className="text-right px-4 py-2 font-medium">Vendas</th>
                  </tr>
                </thead>
                <tbody>
                  {unmappedProducts.map(p => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="px-4 py-2 text-muted-foreground">{p.name}</td>
                      <td className="px-4 py-2 text-right">{fmtBRL(p.total)}</td>
                      <td className="px-4 py-2 text-right">{p.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
