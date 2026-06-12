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
interface ClintLeads { total: number; interessado: number; abordado: number }
interface LeadsData {
  leadsUtm: Record<string, number>
  leadsClint: Record<string, ClintLeads>
  clintAtivo: boolean
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

function EditableMeta({ month, goalName, meta, onSaved, pctNode }: {
  month: string
  goalName: string
  meta: number | null
  onSaved: (v: number) => void
  pctNode?: React.ReactNode  // % da meta, exibido embaixo do valor
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
      <div className="inline-flex items-center gap-1">
        {meta && meta > 0 ? fmtBRL(meta) : <span className="italic opacity-60">definir</span>}
        <Pencil className="h-3 w-3 opacity-0 group-hover/meta:opacity-60 transition-opacity" />
      </div>
      {pctNode && <div className="text-xs">{pctNode}</div>}
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

// Limite de % da meta abaixo do qual a linha inteira é destacada em vermelho.
const PCT_META_CRITICO = 40

function ProdutoRow({ p, stripe, month, onMeta, leadsUtm, leadsClint, clintAtivo }: {
  p: Produto; stripe: boolean; month: string; onMeta: (goalName: string, v: number) => void
  leadsUtm: number | null; leadsClint: ClintLeads | null; clintAtivo: boolean
}) {
  const [open, setOpen] = useState(false)
  const pct = p.meta && p.meta > 0 ? (p.liquido / p.meta) * 100 : null
  const hasOfertas = (p.ofertas?.length ?? 0) > 1
  const cpv = p.gasto > 0 && p.vendas > 0 ? p.gasto / p.vendas : null
  const cplUtm = p.gasto > 0 && leadsUtm != null && leadsUtm > 0 ? p.gasto / leadsUtm : null
  const cplClint = p.gasto > 0 && leadsClint != null && leadsClint.interessado > 0 ? p.gasto / leadsClint.interessado : null
  const pctCls = pct === null ? '' : pct >= 100 ? 'text-green-600 font-semibold' : pct >= 70 ? 'text-yellow-600' : 'text-red-600'
  // Linha inteira em vermelho quando o % da meta está muito baixo.
  const critico = pct !== null && pct < PCT_META_CRITICO
  const rowCls = critico ? 'bg-red-50 dark:bg-red-950/30' : (stripe ? 'bg-muted/20' : '')

  return (
    <>
      <tr className={`border-b ${rowCls}`}>
        {/* Produto */}
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
        {/* Faturamento */}
        <td className="px-4 py-2.5 text-right font-semibold">{fmtBRL(p.liquido)}</td>
        {/* Meta + % embaixo */}
        <EditableMeta month={month} goalName={p.goalName} meta={p.meta} onSaved={v => onMeta(p.goalName, v)}
          pctNode={pct !== null ? <span className={pctCls}>{pct.toFixed(0)}%{pct >= 100 ? ' ✓' : ''}</span> : null} />
        {/* Gasto (com tooltip de etapa) */}
        <GastoCell gasto={p.gasto} etapas={p.gastoEtapas} />
        {/* Vendas */}
        <td className="px-4 py-2.5 text-right">{p.vendas}</td>
        {/* Leads: UTM em cima, Clint (interessado/abordado) embaixo */}
        <td className="px-4 py-2.5 text-right">
          <div title="Leads UTM (BigQuery)">{leadsUtm != null && leadsUtm > 0 ? leadsUtm.toLocaleString('pt-BR') : '—'}</div>
          {clintAtivo && (
            <div className="text-xs text-muted-foreground" title="Leads Clint: interessado / abordado">
              {leadsClint && leadsClint.total > 0
                ? <>{leadsClint.interessado.toLocaleString('pt-BR')} int · {leadsClint.abordado.toLocaleString('pt-BR')} abord</>
                : '—'}
            </div>
          )}
        </td>
        {/* CPV (gasto ÷ vendas) */}
        <td className="px-4 py-2.5 text-right text-muted-foreground">{cpv !== null ? fmtBRL(cpv) : '—'}</td>
        {/* CPL: UTM em cima, Clint (interessado) embaixo */}
        <td className="px-4 py-2.5 text-right text-muted-foreground">
          <div title="CPL UTM = gasto ÷ leads UTM">{cplUtm !== null ? fmtBRL(cplUtm) : '—'}</div>
          {clintAtivo && (
            <div className="text-xs" title="CPL Clint = gasto ÷ leads interessado (Clint)">
              {cplClint !== null ? fmtBRL(cplClint) : '—'}
            </div>
          )}
        </td>
        {/* ROAS */}
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
          <td className="px-4 py-1.5 text-right">{fmtBRL(o.liquido)}</td>
          <td colSpan={3} />
          <td className="px-4 py-1.5 text-right">{o.vendas}</td>
          <td colSpan={3} />
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

// ─── Modal: tags da Clint por produto (clint_tags) ───────────────────────────

interface ClintTagRow { id: string; product_name: string; tag_id: string; label: string }

function ClintTagsModal({ token, onClose, onChanged }: { token: string; onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<ClintTagRow[]>([])
  const [loading, setLoading] = useState(true)
  const [prod, setProd] = useState('')
  const [available, setAvailable] = useState<{ id: string; name: string }[] | null>(null)
  const [tagSearch, setTagSearch] = useState('')
  const [selectedTag, setSelectedTag] = useState<{ id: string; name: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [tagsErro, setTagsErro] = useState('')

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/clint-tags', { headers: { Authorization: `Bearer ${token}` } })
    const j = await r.json().catch(() => ({ tags: [] }))
    setRows(j.tags ?? [])
    setLoading(false)
  }, [token])

  // Lista de tags da Clint (id+nome) para o dropdown.
  const loadAvailable = useCallback(async () => {
    const r = await fetch('/api/clint-tags?available=1', { headers: { Authorization: `Bearer ${token}` } })
    const j = await r.json().catch(() => ({}))
    if (r.ok) setAvailable(j.available ?? [])
    else { setAvailable([]); setTagsErro(j.detail ?? j.error ?? 'Falha ao listar tags da Clint') }
  }, [token])

  useEffect(() => { load(); loadAvailable() }, [load, loadAvailable])

  // já cadastradas (para não repetir no dropdown)
  const jaUsadas = new Set(rows.map(r => r.tag_id))
  const tagsFiltradas = (available ?? [])
    .filter(t => !jaUsadas.has(t.id))
    .filter(t => !tagSearch || t.name.toLowerCase().includes(tagSearch.toLowerCase()))
    .slice(0, 50)

  async function add() {
    if (!prod || !selectedTag) return
    setSaving(true)
    await fetch('/api/clint-tags', { method: 'POST', headers, body: JSON.stringify({ product_name: prod, tag_id: selectedTag.id, label: selectedTag.name }) })
    setSelectedTag(null); setTagSearch('')
    setSaving(false)
    await load(); onChanged()
  }

  async function remove(id: string) {
    await fetch(`/api/clint-tags?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    await load(); onChanged()
  }

  // Agrupa por produto para exibir.
  const porProduto = rows.reduce((acc, r) => { (acc[r.product_name] ??= []).push(r); return acc }, {} as Record<string, ClintTagRow[]>)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative z-10 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col border" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h3 className="font-semibold">Tags da Clint → produto (Leads Clint)</h3>
            <p className="text-xs text-muted-foreground">Cada tag UUID da Clint conta como lead do produto escolhido. Um produto pode ter várias tags.</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="px-5 py-3 border-b bg-muted/20 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nova tag</p>
          <div className="flex gap-2">
            <select value={prod} onChange={e => setProd(e.target.value)} className="text-sm border rounded px-2 py-1.5 bg-background">
              <option value="">produto…</option>
              {PRODUTOS_SELECIONAVEIS.filter(p => p.id > 0).map(p => <option key={p.id} value={p.label}>{p.label}</option>)}
            </select>
            <div className="flex-1 relative">
              <input
                className="w-full text-sm border rounded px-2.5 py-1.5 bg-background"
                placeholder={available === null ? 'carregando tags…' : selectedTag ? selectedTag.name : 'buscar tag da Clint pelo nome…'}
                value={selectedTag ? selectedTag.name : tagSearch}
                onChange={e => { setSelectedTag(null); setTagSearch(e.target.value) }}
                disabled={available === null}
              />
              {/* lista filtrável */}
              {!selectedTag && tagSearch && tagsFiltradas.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border bg-white dark:bg-zinc-900 shadow-lg">
                  {tagsFiltradas.map(t => (
                    <button key={t.id} onClick={() => { setSelectedTag(t); setTagSearch('') }}
                      className="block w-full text-left text-sm px-3 py-1.5 hover:bg-muted">
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={add} disabled={saving || !prod || !selectedTag} className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            </button>
          </div>
          {tagsErro && <p className="text-[11px] text-red-500">{tagsErro} — verifique o CLINT_API_TOKEN no Vercel.</p>}
          {available !== null && available.length === 0 && !tagsErro && (
            <p className="text-[11px] text-muted-foreground">Nenhuma tag retornada pela Clint.</p>
          )}
        </div>

        <div className="overflow-y-auto flex-1 p-2">
          {loading && <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
          {!loading && rows.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nenhuma tag cadastrada.</p>}
          {Object.entries(porProduto).map(([produto, tags]) => (
            <div key={produto} className="mb-2">
              <p className="text-xs font-semibold px-3 py-1">{produto}</p>
              {tags.map(t => (
                <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-muted/40 group">
                  <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{t.tag_id}</code>
                  {t.label && <span className="text-xs text-muted-foreground">{t.label}</span>}
                  <button onClick={() => remove(t.id)} className="ml-auto opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-all"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
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
  const [showClint, setShowClint] = useState(false)
  const [leads, setLeads] = useState<LeadsData | null>(null)

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

  // Leads (UTM + Clint) — carrega em paralelo, não bloqueia a tabela.
  const loadLeads = useCallback(async (m: string) => {
    setLeads(null)
    try {
      const r = await fetch(`/api/placar-leads?month=${m}`, { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) setLeads(await r.json())
    } catch { /* silencioso — leads são complementares */ }
  }, [token])

  useEffect(() => { if (enabled) { load(month); loadLeads(month) } }, [enabled, month, load, loadLeads])

  // Atualiza localmente a meta de todos os produtos que usam o mesmo goalName.
  const onMeta = useCallback((goalName: string, v: number) => {
    setData(prev => {
      if (!prev) return prev
      const produtos = prev.produtos.map(p => p.goalName === goalName ? { ...p, meta: v } : p)
      const totalMeta = produtos.reduce((s, p) => s + (p.meta ?? 0), 0)
      return { ...prev, produtos, totalMeta }
    })
  }, [])

  const { dayOfMonth, lastDay, isCurrent } = daysInfo(month)
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
          <button onClick={() => setShowClint(true)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border bg-background hover:bg-muted transition-colors" title="Tags da Clint por produto">
            <Settings className="h-3.5 w-3.5" />
            Tags Clint
          </button>
          <button onClick={() => load(month)} disabled={loading} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border bg-background hover:bg-muted transition-colors disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {showMap && <CampanhaMapModal onClose={() => setShowMap(false)} onChanged={() => load(month)} />}
      {showClint && <ClintTagsModal token={token} onClose={() => setShowClint(false)} onChanged={() => loadLeads(month)} />}

      <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-xs text-blue-800">
        ⚙️ Aba em construção. O gasto de cada campanha é atribuído ao produto pela aba <strong>Produtos/Campanhas</strong> (prefixo → produto). Campanha sem regra cai em <strong>Buco Approve</strong>.
      </div>

      {error && <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      {/* Hero: faturamento do mês (sem ritmo — ritmo vai no card separado) */}
      {data && (
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs text-muted-foreground mb-1">Faturamento líquido do mês</p>
          <div className="flex items-end gap-4 flex-wrap">
            <p className="text-3xl font-bold">{fmtBRL(totalLiquido)}</p>
            {pctMeta !== null && (
              <p className={`text-sm font-medium mb-1 ${pctMeta >= 100 ? 'text-green-600' : 'text-muted-foreground'}`}>
                {pctMeta.toFixed(0)}% da meta {totalMeta > 0 && `(${fmtBRL(totalMeta)})`}
              </p>
            )}
          </div>
        </div>
      )}

      {/* KPIs: Faturamento · Gasto · ROAS geral · Distância da meta / ritmo */}
      {data && (() => {
        const restante = totalMeta - totalLiquido
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Faturamento', value: fmtBRL(totalLiquido), sub: pctMeta !== null ? `${pctMeta.toFixed(0)}% da meta` : null, cls: '' },
              { label: 'Gasto total (2 contas)', value: totalGasto > 0 ? fmtBRL(totalGasto) : '—', sub: gastoProdutos > 0 ? `${fmtBRL(gastoProdutos)} em produtos` : null, cls: '' },
              { label: 'ROAS geral', value: gastoProdutos > 0 ? `${(totalLiquido / gastoProdutos).toFixed(2)}x` : '—', sub: 'líquido ÷ gasto produtos', cls: '' },
              {
                label: 'Distância da meta',
                value: totalMeta > 0 ? (restante > 0 ? fmtBRL(restante) : 'atingida ✓') : '—',
                sub: isCurrent && totalMeta > 0
                  ? `esperado hoje: ${pctEsperado.toFixed(0)}%${abaixoDoRitmo ? ' · ⚠️ abaixo' : ' · no ritmo'}`
                  : (totalMeta > 0 ? 'mês fechado' : null),
                cls: abaixoDoRitmo ? 'text-red-600' : '',
              },
            ].map(c => (
              <div key={c.label} className="rounded-lg border bg-card p-4">
                <p className="text-xs text-muted-foreground mb-1">{c.label}</p>
                <p className={`text-xl font-bold ${c.cls}`}>{c.value}</p>
                {c.sub && <p className={`text-xs mt-0.5 ${c.cls || 'text-muted-foreground'}`}>{c.sub}</p>}
              </div>
            ))}
          </div>
        )
      })()}

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
                <th className="text-right px-4 py-2.5 font-medium">Faturamento</th>
                <th className="text-right px-4 py-2.5 font-medium">Meta</th>
                <th className="text-right px-4 py-2.5 font-medium">Gasto</th>
                <th className="text-right px-4 py-2.5 font-medium">Vendas</th>
                <th className="text-right px-4 py-2.5 font-medium" title="Leads UTM (BigQuery) e Leads Clint (interessado/abordado)">Leads</th>
                <th className="text-right px-4 py-2.5 font-medium" title="Custo por venda (gasto ÷ vendas)">CPV</th>
                <th className="text-right px-4 py-2.5 font-medium" title="CPL UTM (gasto÷leads UTM) e CPL Clint (gasto÷interessado)">CPL</th>
                <th className="text-right px-4 py-2.5 font-medium">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {produtos.map((p, i) => (
                <ProdutoRow key={p.nome} p={p} stripe={i % 2 !== 0} month={month} onMeta={onMeta}
                  leadsUtm={leads?.leadsUtm[p.nome] ?? null}
                  leadsClint={leads?.leadsClint[p.nome] ?? null}
                  clintAtivo={leads?.clintAtivo ?? false} />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/50 font-semibold">
                <td className="px-4 py-2.5">Total</td>
                {/* Faturamento */}
                <td className="px-4 py-2.5 text-right">{fmtBRL(totalLiquido)}</td>
                {/* Meta + % */}
                <td className="px-4 py-2.5 text-right">
                  <div>{totalMeta > 0 ? fmtBRL(totalMeta) : '—'}</div>
                  {totalMeta > 0 && pctMeta !== null && <div className="text-xs font-normal"><span className={pctMeta >= 100 ? 'text-green-600' : ''}>{pctMeta.toFixed(0)}%{pctMeta >= 100 ? ' ✓' : ''}</span></div>}
                </td>
                {/* Gasto */}
                <td className="px-4 py-2.5 text-right">{gastoProdutos > 0 ? fmtBRL(gastoProdutos) : '—'}</td>
                {/* Vendas */}
                <td className="px-4 py-2.5 text-right">{data?.totalVendas ?? 0}</td>
                {/* Leads */}
                <td className="px-4 py-2.5 text-right">
                  {leads ? (
                    <>
                      <div>{Object.values(leads.leadsUtm).reduce((s, v) => s + v, 0).toLocaleString('pt-BR')}</div>
                      {leads.clintAtivo && <div className="text-xs font-normal text-muted-foreground">{Object.values(leads.leadsClint).reduce((s, v) => s + v.interessado, 0).toLocaleString('pt-BR')} int</div>}
                    </>
                  ) : '—'}
                </td>
                {/* CPV */}
                <td className="px-4 py-2.5 text-right">{gastoProdutos > 0 && (data?.totalVendas ?? 0) > 0 ? fmtBRL(gastoProdutos / (data?.totalVendas ?? 1)) : '—'}</td>
                {/* CPL */}
                <td className="px-4 py-2.5 text-right">—</td>
                {/* ROAS */}
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
