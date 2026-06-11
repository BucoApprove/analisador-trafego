import { useState, useCallback, useEffect, useRef } from 'react'
import { RefreshCw, ChevronDown, ChevronUp, Pencil, Loader2, Settings, Plus, Trash2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// Produtos selecionáveis no editor de mapeamento (label → product_id gravado
// na campaign_produto_map; o backend converte o id de volta no nome canônico).
const INTENSIVO_MARKER_ID = -2016048
const PRODUTOS_SELECIONAVEIS: Array<{ label: string; id: number }> = [
  { label: 'Buco Approve',                id: 2016048 },
  { label: 'Intensivo ENARE',             id: INTENSIVO_MARKER_ID },
  { label: 'Mentoria CTBMF',              id: 3811518 },
  { label: 'Pós Patologia',               id: 5694443 },
  { label: 'Pós Anatomia',                id: 6115663 },
  { label: 'Planejamento ImpulsoR+',      id: 6739963 },
  { label: 'Renovação de acesso',         id: 3510472 },
  { label: 'Rota Enare',                  id: 4739673 },
  { label: 'BucoApp',                     id: 2286372 },
  { label: 'Imersão ENARE',               id: 7737553 },
  { label: 'Segurança Clínica por Casos', id: 7812483 },
  { label: 'Low ticket',                  id: 6766383 },
]
const ID_TO_LABEL: Record<number, string> = Object.fromEntries(PRODUTOS_SELECIONAVEIS.map(p => [p.id, p.label]))

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props { token: string; enabled: boolean }
type Categoria = 'core' | 'porta' | 'low'

type Etapa = 'conversão' | 'remarketing' | 'descoberta' | 'relacionamento'
const ETAPAS: Etapa[] = ['conversão', 'remarketing', 'descoberta', 'relacionamento']
type EtapaGasto = Record<Etapa, number>

interface Oferta { code: string; nome: string; vendas: number; liquido: number }
interface Produto {
  nome: string
  categoria: Categoria
  vendas: number
  liquido: number
  meta: number | null
  goalName: string
  gasto: number
  roas: number | null
  gastoEtapas: EtapaGasto | null
  ofertas?: Oferta[]
}
interface GastoSemVenda { nome: string; gasto: number; etapas: EtapaGasto | null }
interface MetaInfo {
  totalGasto: number
  totalClassificado: number
  gastoSemVenda: GastoSemVenda[]
  campanhas: { campaign: string; conta: string; spend: number; produto: string; etapa: Etapa }[]
}
interface PlacarResp {
  month: string
  produtos: Produto[]
  totalLiquido: number
  totalVendas: number
  totalMeta: number
  porCategoria: Record<Categoria, number>
  meta: MetaInfo | null
  metaError: string | null
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

// ─── Célula de gasto com tooltip de split por etapa ──────────────────────────

function GastoCell({ gasto, etapas }: { gasto: number; etapas: EtapaGasto | null }) {
  if (gasto <= 0) return <td className="px-4 py-2.5 text-right text-muted-foreground">—</td>
  const linhas = etapas ? ETAPAS.filter(e => etapas[e] > 0).map(e => [e, etapas[e]] as const) : []
  return (
    <td className="px-4 py-2.5 text-right text-muted-foreground relative group/gasto">
      <span className="cursor-help border-b border-dotted border-muted-foreground/40">{fmtBRL(gasto)}</span>
      {linhas.length > 0 && (
        <div className="invisible group-hover/gasto:visible absolute right-4 top-full z-30 mt-1 w-52 rounded-md border bg-white dark:bg-zinc-900 shadow-xl p-2 text-left">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Gasto por etapa</p>
          {linhas.map(([etapa, v]) => (
            <div key={etapa} className="flex justify-between text-xs py-0.5">
              <span className="capitalize text-muted-foreground">{etapa}</span>
              <span className="font-medium">{fmtBRL(v)}</span>
            </div>
          ))}
        </div>
      )}
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
        <GastoCell gasto={p.gasto} etapas={p.gastoEtapas} />
        <td className="px-4 py-2.5 text-right text-muted-foreground">
          {p.gasto > 0 && p.vendas > 0 ? fmtBRL(p.gasto / p.vendas) : '—'}
        </td>
        <td className="px-4 py-2.5 text-right">
          {p.roas !== null ? (
            <span className={p.roas >= 1 ? 'text-green-600 font-medium' : 'text-red-600'}>{p.roas.toFixed(2)}x</span>
          ) : '—'}
        </td>
      </tr>
      {open && p.ofertas?.map(o => (
        <tr key={o.code} className="border-b bg-muted/5 text-xs text-muted-foreground">
          <td className="pl-10 py-1.5 italic">
            {o.nome}{o.nome !== o.code && <span className="not-italic opacity-50"> ({o.code})</span>}
          </td>
          <td className="px-4 py-1.5 text-right">{o.vendas}</td>
          <td className="px-4 py-1.5 text-right">{fmtBRL(o.liquido)}</td>
          <td colSpan={5} />
        </tr>
      ))}
    </>
  )
}

// ─── Modal: mapeamento de campanha → produto (campaign_produto_map) ──────────

interface MapRow { id: number; account: string; prefixo: string; produto_ids: number[]; label: string }

function CampanhaMapModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [account, setAccount] = useState<'conta1' | 'conta2'>('conta1')
  const [rows, setRows] = useState<MapRow[]>([])
  const [loading, setLoading] = useState(true)
  const [newPrefixo, setNewPrefixo] = useState('')
  const [newId, setNewId] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('campaign_produto_map')
      .select('id, account, prefixo, produto_ids, label')
      .eq('account', account)
      .order('id')
    setRows((data ?? []) as MapRow[])
    setLoading(false)
  }, [account])

  useEffect(() => { load() }, [load])

  async function add() {
    const idNum = Number(newId)
    if (!newPrefixo.trim() || !idNum) return
    setSaving(true)
    const label = ID_TO_LABEL[idNum] ?? ''
    const { error } = await supabase.from('campaign_produto_map').insert({
      account, prefixo: newPrefixo.toLowerCase().trim(), produto_ids: [idNum], label,
    })
    setSaving(false)
    if (!error) { setNewPrefixo(''); setNewId(''); await load(); onChanged() }
  }

  async function remove(id: number) {
    await supabase.from('campaign_produto_map').delete().eq('id', id)
    await load(); onChanged()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative z-10 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col border" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h3 className="font-semibold">Mapeamento de campanhas → produto</h3>
            <p className="text-xs text-muted-foreground">Trecho do nome da campanha define o produto. Sem regra → vai para <strong>Buco Approve</strong>.</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {/* Seletor de conta */}
        <div className="px-5 py-3 border-b flex gap-2">
          {(['conta1', 'conta2'] as const).map(c => (
            <button key={c} onClick={() => setAccount(c)}
              className={`text-xs px-3 py-1.5 rounded border transition-colors ${account === c ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>
              {c === 'conta1' ? 'GBS Launch (conta1)' : 'GBS Pós (conta2)'}
            </button>
          ))}
        </div>

        {/* Nova regra */}
        <div className="px-5 py-3 border-b bg-muted/20">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Nova regra</p>
          <div className="flex gap-2">
            <input
              className="flex-1 text-sm border rounded px-2.5 py-1.5 bg-background font-mono"
              placeholder="trecho do nome (ex: anato)"
              value={newPrefixo}
              onChange={e => setNewPrefixo(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') add() }}
            />
            <select className="text-sm border rounded px-2 py-1.5 bg-background" value={newId} onChange={e => setNewId(e.target.value)}>
              <option value="">produto…</option>
              {PRODUTOS_SELECIONAVEIS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <button onClick={add} disabled={saving || !newPrefixo.trim() || !newId}
              className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Lista */}
        <div className="overflow-y-auto flex-1 p-2">
          {loading && <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhuma regra nesta conta. Tudo cai em Buco Approve.</p>
          )}
          {rows.map(r => (
            <div key={r.id} className="flex items-center gap-2 px-3 py-2 rounded hover:bg-muted/40 group">
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{r.prefixo}</code>
              <span className="text-muted-foreground text-xs">→</span>
              <span className="text-sm flex-1">{ID_TO_LABEL[r.produto_ids?.[0]] ?? r.label ?? `id ${r.produto_ids?.[0]}`}</span>
              <button onClick={() => remove(r.id)} className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-all">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function TabPlacar({ token, enabled }: Props) {
  const [month, setMonth] = useState(currentMonthStr)
  const [data, setData] = useState<PlacarResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showMap, setShowMap] = useState(false)

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
  const gastoProdutos = produtos.reduce((s, p) => s + p.gasto, 0)
  const totalGasto = data?.meta?.totalGasto ?? 0
  const gastoSemVenda = data?.meta?.gastoSemVenda ?? []

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
          <button onClick={() => setShowMap(true)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border bg-background hover:bg-muted transition-colors" title="Mapear campanhas para produtos">
            <Settings className="h-3.5 w-3.5" />
            Campanhas
          </button>
          <button onClick={() => load(month)} disabled={loading} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border bg-background hover:bg-muted transition-colors disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {showMap && <CampanhaMapModal onClose={() => setShowMap(false)} onChanged={() => load(month)} />}

      <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-xs text-blue-800">
        ⚙️ Aba em construção. O gasto de cada campanha é atribuído ao produto pela aba <strong>Produtos/Campanhas</strong> (prefixo → produto). Campanha sem regra cai em <strong>Buco Approve</strong>.
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
            { label: 'Vendas',         value: String(data.totalVendas), sub: null },
            { label: 'Gasto total (2 contas)', value: totalGasto > 0 ? fmtBRL(totalGasto) : '—', sub: gastoProdutos > 0 ? `${fmtBRL(gastoProdutos)} em produtos` : null },
            { label: 'ROAS geral',     value: gastoProdutos > 0 ? `${(totalLiquido / gastoProdutos).toFixed(2)}x` : '—', sub: 'líquido ÷ gasto produtos' },
            { label: 'Low ticket',     value: fmtBRL(data.porCategoria.low), sub: null },
          ].map(c => (
            <div key={c.label} className="rounded-lg border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">{c.label}</p>
              <p className="text-xl font-bold">{c.value}</p>
              {c.sub && <p className="text-xs text-muted-foreground mt-0.5">{c.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Aviso se o gasto Meta falhou */}
      {data?.metaError && (
        <div className="rounded-md bg-yellow-50 border border-yellow-200 px-4 py-2.5 text-xs text-yellow-800">
          ⚠️ Gasto Meta indisponível ({data.metaError}). Verifique <code>META_AD_ACCOUNTS</code> e <code>META_ACCESS_TOKEN</code> no Vercel.
        </div>
      )}

      {/* Tabela única de produtos (badge identifica a categoria) */}
      {/* overflow-visible para o tooltip de gasto por etapa não ser cortado */}
      {produtos.length > 0 && (
        <div className="rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-2.5 font-medium">Produto</th>
                <th className="text-right px-4 py-2.5 font-medium">Vendas</th>
                <th className="text-right px-4 py-2.5 font-medium">Líquido</th>
                <th className="text-right px-4 py-2.5 font-medium">Meta</th>
                <th className="text-right px-4 py-2.5 font-medium">% Meta</th>
                <th className="text-right px-4 py-2.5 font-medium">Gasto</th>
                <th className="text-right px-4 py-2.5 font-medium">CPA</th>
                <th className="text-right px-4 py-2.5 font-medium">ROAS</th>
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
                <td className="px-4 py-2.5 text-right">{gastoProdutos > 0 ? fmtBRL(gastoProdutos) : '—'}</td>
                <td className="px-4 py-2.5 text-right">
                  {gastoProdutos > 0 && (data?.totalVendas ?? 0) > 0 ? fmtBRL(gastoProdutos / (data?.totalVendas ?? 1)) : '—'}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {gastoProdutos > 0 ? <span className={totalLiquido / gastoProdutos >= 1 ? 'text-green-600' : 'text-red-600'}>{(totalLiquido / gastoProdutos).toFixed(2)}x</span> : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Gasto atribuído a produto sem venda no mês (ex: Quiz, produto novo) */}
      {gastoSemVenda.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-2 bg-muted/50 border-b text-sm font-semibold">
            Gasto sem venda no mês <span className="font-normal text-muted-foreground">— produtos com investimento mas sem faturamento Hotmart</span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {gastoSemVenda.map((g, i) => (
                <tr key={g.nome} className={`border-b last:border-0 ${i % 2 !== 0 ? 'bg-muted/20' : ''}`}>
                  <td className="px-4 py-2 text-muted-foreground">{g.nome}</td>
                  <GastoCell gasto={g.gasto} etapas={g.etapas} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loading && !data && (
        <div className="flex justify-center py-12 text-muted-foreground text-sm">Carregando...</div>
      )}
    </div>
  )
}
