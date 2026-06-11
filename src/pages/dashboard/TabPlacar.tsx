import { useState, useCallback, useEffect, useRef } from 'react'
import { RefreshCw, ChevronDown, ChevronUp, Pencil, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

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
  goalName: string
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

const CAT_BADGE: Record<Categoria, { label: string; cls: string }> = {
  core:  { label: 'core',    cls: 'bg-blue-100 text-blue-700' },
  porta: { label: 'entrada', cls: 'bg-purple-100 text-purple-700' },
  low:   { label: 'low',     cls: 'bg-gray-100 text-gray-600' },
}

function CatBadge({ cat }: { cat: Categoria }) {
  const b = CAT_BADGE[cat]
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${b.cls}`}>{b.label}</span>
}

// ─── Célula de meta editável (grava em monthly_goals via goalName) ───────────

function EditableMeta({ month, goalName, meta, onSaved }: {
  month: string
  goalName: string
  meta: number | null
  onSaved: (v: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const savedRef = useRef(false)

  function startEdit() {
    setDraft(meta && meta > 0 ? String(meta) : '')
    savedRef.current = false
    setEditing(true)
  }

  async function save() {
    if (savedRef.current) return
    savedRef.current = true
    const parsed = parseFloat(draft.replace(/\./g, '').replace(',', '.').trim()) || 0
    setSaving(true)
    const { error } = await supabase.from('monthly_goals').upsert({
      month, product_name: goalName, meta: parsed, updated_at: new Date().toISOString(),
    })
    setSaving(false)
    if (error) { savedRef.current = false; return }
    onSaved(parsed)
    setEditing(false)
  }

  if (editing) {
    return (
      <td className="px-4 py-2.5 text-right">
        <div className="flex items-center justify-end gap-1">
          <span className="text-xs text-muted-foreground">R$</span>
          <input
            autoFocus type="text" inputMode="decimal" value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') { savedRef.current = true; setEditing(false) }
            }}
            onBlur={save} disabled={saving}
            className="w-24 text-right text-sm border rounded px-1.5 py-0.5 bg-background disabled:opacity-50"
          />
          {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
      </td>
    )
  }

  return (
    <td onClick={startEdit} title="Clique para editar a meta"
      className="px-4 py-2.5 text-right text-muted-foreground cursor-pointer hover:bg-muted/40 hover:text-foreground transition-colors group/meta">
      <span className="inline-flex items-center gap-1">
        {meta && meta > 0 ? fmtBRL(meta) : <span className="italic opacity-60">definir</span>}
        <Pencil className="h-3 w-3 opacity-0 group-hover/meta:opacity-60 transition-opacity" />
      </span>
    </td>
  )
}

// ─── Linha de produto (com drill-down de ofertas) ────────────────────────────

function ProdutoRow({ p, stripe, month, onMeta }: { p: Produto; stripe: boolean; month: string; onMeta: (goalName: string, v: number) => void }) {
  const [open, setOpen] = useState(false)
  const pct = p.meta && p.meta > 0 ? (p.liquido / p.meta) * 100 : null
  const hasOfertas = (p.ofertas?.length ?? 0) > 1
  return (
    <>
      <tr className={`border-b ${stripe ? 'bg-muted/20' : ''}`}>
        <td className="px-4 py-2.5 font-medium">
          <span className="inline-flex items-center gap-1.5">
            {hasOfertas ? (
              <button onClick={() => setOpen(o => !o)} className="text-muted-foreground hover:text-foreground">
                {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            ) : <span className="w-3.5 inline-block" />}
            {p.nome}
            <CatBadge cat={p.categoria} />
          </span>
        </td>
        <td className="px-4 py-2.5 text-right">{p.vendas}</td>
        <td className="px-4 py-2.5 text-right font-semibold">{fmtBRL(p.liquido)}</td>
        <EditableMeta month={month} goalName={p.goalName} meta={p.meta} onSaved={v => onMeta(p.goalName, v)} />
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

  // Atualiza localmente a meta de todos os produtos que usam o mesmo goalName.
  const onMeta = useCallback((goalName: string, v: number) => {
    setData(prev => {
      if (!prev) return prev
      const produtos = prev.produtos.map(p => p.goalName === goalName ? { ...p, meta: v } : p)
      const totalMeta = produtos.reduce((s, p) => s + (p.meta ?? 0), 0)
      return { ...prev, produtos, totalMeta }
    })
  }, [])

  const { dayOfMonth, lastDay, diasRestantes, isCurrent } = daysInfo(month)
  const totalLiquido = data?.totalLiquido ?? 0
  const totalMeta = data?.totalMeta ?? 0
  const pctMeta = totalMeta > 0 ? (totalLiquido / totalMeta) * 100 : null
  // Ritmo só faz sentido no mês corrente: % esperado = fração do mês já decorrida.
  const pctEsperado = (dayOfMonth / lastDay) * 100
  const abaixoDoRitmo = isCurrent && pctMeta !== null && pctMeta < pctEsperado

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
            {isCurrent
              ? <>Dia {dayOfMonth} de {lastDay} · faltam {diasRestantes} dias
                  {pctMeta !== null && ` · esperado até hoje: ${pctEsperado.toFixed(0)}% da meta`}
                  {abaixoDoRitmo && <span className="text-red-600 font-medium"> · ⚠️ abaixo do esperado</span>}
                </>
              : <>Mês fechado</>}
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

      {/* Tabela única de produtos (badge identifica a categoria) */}
      {produtos.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-2.5 font-medium">Produto</th>
                <th className="text-right px-4 py-2.5 font-medium">Vendas</th>
                <th className="text-right px-4 py-2.5 font-medium">Líquido</th>
                <th className="text-right px-4 py-2.5 font-medium">Meta</th>
                <th className="text-right px-4 py-2.5 font-medium">% Meta</th>
              </tr>
            </thead>
            <tbody>
              {produtos.map((p, i) => <ProdutoRow key={p.nome} p={p} stripe={i % 2 !== 0} month={month} onMeta={onMeta} />)}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/50 font-semibold">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right">{data?.totalVendas ?? 0}</td>
                <td className="px-4 py-2.5 text-right">{fmtBRL(totalLiquido)}</td>
                <td className="px-4 py-2.5 text-right">{totalMeta > 0 ? fmtBRL(totalMeta) : '—'}</td>
                <td className="px-4 py-2.5 text-right">
                  {pctMeta !== null ? <span className={pctMeta >= 100 ? 'text-green-600' : ''}>{pctMeta.toFixed(0)}%</span> : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {loading && !data && (
        <div className="flex justify-center py-12 text-muted-foreground text-sm">Carregando...</div>
      )}
    </div>
  )
}
