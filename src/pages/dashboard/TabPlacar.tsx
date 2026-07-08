import { useState, useCallback, useEffect, useRef } from 'react'
import { RefreshCw, ChevronDown, ChevronUp, Pencil, Loader2, Settings, Plus, Trash2, X, ClipboardList } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Lancamento } from '@/lib/supabase'
import { LancamentoLeadsKpis, CHART_COLORS, AdThumbTooltip } from './components'

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
interface LeadsDistRow { campanha: string; content: string | null; leads: number }
interface LeadsData {
  leadsUtm: Record<string, number>
  leadsClint: Record<string, ClintLeads>
  clintAtivo: boolean
  leadsDistribuicao: Record<string, LeadsDistRow[]>
}
interface RangeInfo { since: string; until: string; diasNoRange: number; diasNoMes: number; fatorMeta: number }
interface PlacarResp {
  month: string
  range: RangeInfo | null
  produtos: Produto[]
  totalLiquido: number
  totalVendas: number
  totalMeta: number
  porCategoria: Record<Categoria, number>
  meta: MetaInfo | null
  metaError: string | null
}

interface OrcamentoEntry {
  orcamento: number | null
  ticket: number | null
  conversao: number | null
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

// ─── Tetos e ROAS esperado (cálculos por produto) ────────────────────────────

interface Alvos {
  roasEsperado: number | null
  tetoCpv: number | null
  tetoCpl: number | null
}

function calcAlvos(meta: number | null, orc: OrcamentoEntry): Alvos {
  const { orcamento, ticket, conversao } = orc
  if (!orcamento || orcamento <= 0 || !meta || meta <= 0) {
    return { roasEsperado: null, tetoCpv: null, tetoCpl: null }
  }
  const roasEsperado = meta / orcamento
  const vendasNecessarias = ticket && ticket > 0 ? meta / ticket : null
  const tetoCpv = vendasNecessarias && vendasNecessarias > 0 ? orcamento / vendasNecessarias : null
  const leadsNecessarios = vendasNecessarias && conversao && conversao > 0 ? vendasNecessarias / conversao : null
  const tetoCpl = leadsNecessarios && leadsNecessarios > 0 ? orcamento / leadsNecessarios : null
  return { roasEsperado, tetoCpv, tetoCpl }
}

// Verde/Amarelo/Vermelho para CPV e CPL (menor = melhor, teto é máximo).
function colorCusto(real: number | null, teto: number | null): string {
  if (real === null || teto === null || teto <= 0) return ''
  if (real <= teto) return 'text-green-600'
  if (real <= teto * 1.10) return 'text-yellow-600'
  return 'text-red-600'
}

// Verde/Amarelo/Vermelho para ROAS (maior = melhor, esperado é mínimo).
function colorRoas(real: number | null, esperado: number | null): string {
  if (real === null || esperado === null || esperado <= 0) return ''
  if (real >= esperado) return 'text-green-600 font-medium'
  if (real >= esperado * 0.90) return 'text-yellow-600'
  return 'text-red-600'
}

// ─── Célula de meta editável (grava em monthly_goals via goalName) ───────────

function EditableMeta({ month, goalName, meta, onSaved, pctNode, readOnly }: {
  month: string
  goalName: string
  meta: number | null
  onSaved: (v: number) => void
  pctNode?: React.ReactNode
  readOnly?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const savedRef = useRef(false)

  function startEdit() {
    if (readOnly) return
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

  if (readOnly) {
    return (
      <td className="px-4 py-2.5 text-right text-muted-foreground" title="Meta proporcional ao período (somente leitura)">
        <div>{meta && meta > 0 ? fmtBRL(meta) : '—'}</div>
        {pctNode && <div className="text-xs">{pctNode}</div>}
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

// ─── Célula de orçamento editável (grava em orcamento_trafego via API) ────────

function EditableOrcamento({ month, product, token, entry, onSaved }: {
  month: string
  product: string
  token: string
  entry: OrcamentoEntry
  onSaved: (e: OrcamentoEntry) => void
}) {
  const [open, setOpen] = useState(false)
  const [draftOrc, setDraftOrc] = useState('')
  const [draftTicket, setDraftTicket] = useState('')
  const [draftConv, setDraftConv] = useState('')
  const [saving, setSaving] = useState(false)

  function openEdit() {
    setDraftOrc(entry.orcamento != null && entry.orcamento > 0 ? String(entry.orcamento) : '')
    setDraftTicket(entry.ticket != null && entry.ticket > 0 ? String(entry.ticket) : '')
    setDraftConv(entry.conversao != null && entry.conversao > 0 ? String(Math.round(entry.conversao * 100)) : '')
    setOpen(true)
  }

  function parseNum(s: string) {
    const v = parseFloat(s.replace(/\./g, '').replace(',', '.').trim())
    return isNaN(v) || v <= 0 ? null : v
  }

  async function save() {
    setSaving(true)
    const orcamento = parseNum(draftOrc)
    const ticket = parseNum(draftTicket)
    const convPct = parseNum(draftConv)
    const conversao = convPct != null ? convPct / 100 : null
    const body = { month, product, orcamento, ticket, conversao }
    await fetch('/api/orcamento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    setSaving(false)
    onSaved({ orcamento, ticket, conversao })
    setOpen(false)
  }

  const orcVal = entry.orcamento

  return (
    <td className="px-4 py-2.5 text-right relative">
      <button
        onClick={openEdit}
        title="Clique para editar orçamento, ticket e conversão"
        className="inline-flex items-center gap-1 cursor-pointer hover:opacity-80 group/orc"
      >
        <span className={`rounded px-1.5 py-0.5 text-sm ${orcVal ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'text-muted-foreground italic opacity-60'}`}>
          {orcVal ? fmtBRL(orcVal) : 'definir'}
        </span>
        <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover/orc:opacity-60 transition-opacity" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border bg-white dark:bg-zinc-900 shadow-xl p-3 space-y-2 text-left" onClick={e => e.stopPropagation()}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Orçamento — {product}</p>
          <div>
            <label className="text-xs text-muted-foreground">Orçamento de tráfego (R$)</label>
            <input
              autoFocus type="text" inputMode="decimal" value={draftOrc}
              onChange={e => setDraftOrc(e.target.value)}
              placeholder="ex: 12000"
              className="mt-0.5 w-full text-sm border rounded px-2 py-1 bg-background"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Ticket médio (R$) <span className="opacity-60">histórico ou manual</span></label>
            <input type="text" inputMode="decimal" value={draftTicket}
              onChange={e => setDraftTicket(e.target.value)}
              placeholder="ex: 1750"
              className="mt-0.5 w-full text-sm border rounded px-2 py-1 bg-background"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Conversão (%) <span className="opacity-60">vendas ÷ leads int</span></label>
            <input type="text" inputMode="decimal" value={draftConv}
              onChange={e => setDraftConv(e.target.value)}
              placeholder="ex: 18.6"
              className="mt-0.5 w-full text-sm border rounded px-2 py-1 bg-background"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={save} disabled={saving}
              className="flex-1 text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-1">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Salvar'}
            </button>
            <button onClick={() => setOpen(false)} className="text-xs px-3 py-1.5 rounded border hover:bg-muted">
              Cancelar
            </button>
          </div>
        </div>
      )}
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

// ─── Modal de distribuição de leads por campanha + content ───────────────────

function LeadsDistModal({ produto, rows, token, onClose }: {
  produto: string
  rows: LeadsDistRow[]
  token: string
  onClose: () => void
}) {
  const total = rows.reduce((s, r) => s + r.leads, 0)

  // Agrupa por campanha para exibição hierárquica
  const byCampanha = new Map<string, { total: number; contents: { content: string | null; leads: number }[] }>()
  for (const r of rows) {
    const entry = byCampanha.get(r.campanha) ?? { total: 0, contents: [] }
    entry.total += r.leads
    entry.contents.push({ content: r.content, leads: r.leads })
    byCampanha.set(r.campanha, entry)
  }
  const campanhas = [...byCampanha.entries()].sort((a, b) => b[1].total - a[1].total)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative z-10 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-lg border flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h3 className="font-semibold">Leads — {produto}</h3>
            <p className="text-xs text-muted-foreground">{total.toLocaleString('pt-BR')} leads únicos · por campanha e anúncio</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {campanhas.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">Sem dados de distribuição.</p>
          )}
          {campanhas.map(([campanha, { total: totCamp, contents }]) => (
            <div key={campanha} className="rounded-lg border overflow-hidden">
              {/* Cabeçalho da campanha */}
              <div className="flex items-center justify-between px-3 py-2 bg-muted/50">
                <span className="text-xs font-semibold truncate max-w-[340px]" title={campanha}>{campanha}</span>
                <span className="text-xs font-bold tabular-nums ml-2 flex-shrink-0">{totCamp.toLocaleString('pt-BR')}</span>
              </div>
              {/* Linhas de content */}
              <div className="divide-y">
                {contents.sort((a, b) => b.leads - a.leads).map((c, i) => {
                  const pct = total > 0 ? (c.leads / total) * 100 : 0
                  return (
                    <div key={i} className="flex items-center gap-3 px-3 py-1.5">
                      <div className="flex-1 min-w-0">
                        {c.content ? (
                          <AdThumbTooltip
                            label={c.content}
                            cacheKey={c.content}
                            className="text-xs text-muted-foreground truncate block"
                            fetchThumb={() =>
                              fetch(`/api/meta-thumb-by-name?name=${encodeURIComponent(c.content!)}`, { headers: { Authorization: `Bearer ${token}` } })
                                .then(res => res.ok ? res.json() : null)
                                .then(data => data?.thumbnail ?? null)
                            }
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground truncate block italic opacity-60">sem utm_content</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-primary/60" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs tabular-nums w-8 text-right">{c.leads}</span>
                        <span className="text-[10px] text-muted-foreground w-8 text-right">{pct.toFixed(0)}%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Modal de detalhes dos leads Clint ───────────────────────────────────────

interface ClintDealDetail {
  id: string; date: string; name: string; phone: string | null
  tipo: 'Interessado' | 'Abordado' | null; funil: string; stage: string; vendedor: string | null
}

function ClintLeadsModal({ produto, token, since, until, total, onClose }: {
  produto: string; token: string; since: string; until: string; total: number; onClose: () => void
}) {
  const [deals, setDeals] = useState<ClintDealDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const qs = new URLSearchParams({ produto, since, until })
    fetch(`/api/clint-leads-detail?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error)))
      .then(j => setDeals(j.deals ?? []))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [produto, token, since, until])

  const TIPO_CLS: Record<string, string> = {
    'Interessado': 'text-blue-600 bg-blue-50',
    'Abordado':    'text-amber-600 bg-amber-50',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative z-10 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-2xl border flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h3 className="font-semibold">Leads Clint — {produto}</h3>
            <p className="text-xs text-muted-foreground">{total} leads · {since} a {until}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto flex-1">
          {loading && <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
          {error && <p className="text-sm text-destructive p-4">{error}</p>}
          {!loading && !error && deals.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-10">Nenhum deal encontrado.</p>
          )}
          {!loading && deals.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Data</th>
                  <th className="text-left px-4 py-2 font-medium">Nome</th>
                  <th className="text-left px-4 py-2 font-medium">Tipo</th>
                  <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">Funil</th>
                  <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">Vendedor</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {deals.map(d => (
                  <tr key={d.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2 tabular-nums text-muted-foreground text-xs">{fmtDate(d.date)}</td>
                    <td className="px-4 py-2 font-medium max-w-[180px] truncate" title={d.name}>{d.name}</td>
                    <td className="px-4 py-2">
                      {d.tipo ? (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${TIPO_CLS[d.tipo] ?? ''}`}>{d.tipo}</span>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground hidden sm:table-cell truncate max-w-[140px]" title={d.funil}>{d.funil}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground hidden sm:table-cell">{d.vendedor ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function fmtDate(s: string) {
  if (!s) return '—'
  try { return new Date(s + 'T12:00:00Z').toLocaleDateString('pt-BR') } catch { return s }
}

// ─── Ações rápidas por produto/dia ───────────────────────────────────────────

function todayIso() { return new Date().toISOString().slice(0, 10) }

function AcaoCell({ produto, acoes, onChange }: {
  produto: string
  acoes: Record<string, string>
  onChange: (produto: string, valor: string) => void
}) {
  const valor = acoes[produto] ?? ''
  const [draft, setDraft] = useState(valor)
  const [saving, setSaving] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sincroniza quando acoes muda externamente (carga inicial)
  useEffect(() => { setDraft(acoes[produto] ?? '') }, [acoes, produto])

  async function persist(text: string) {
    setSaving(true)
    await supabase.from('placar_acoes').upsert(
      { data: todayIso(), produto, acao: text, updated_at: new Date().toISOString() },
      { onConflict: 'data,produto' }
    )
    setSaving(false)
    onChange(produto, text)
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value
    setDraft(text)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => persist(text), 800)
  }

  return (
    <td className="px-3 py-2 min-w-[180px] max-w-[260px]">
      <div className="relative">
        <textarea
          rows={1}
          value={draft}
          onChange={handleChange}
          placeholder="ação rápida…"
          className="w-full resize-none rounded border px-2 py-1 text-xs bg-background leading-snug placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
          style={{ minHeight: '28px', maxHeight: '80px', overflow: 'hidden' }}
          onInput={e => {
            const t = e.target as HTMLTextAreaElement
            t.style.height = 'auto'
            t.style.height = Math.min(t.scrollHeight, 80) + 'px'
          }}
        />
        {saving && <Loader2 className="absolute right-1.5 top-1.5 h-3 w-3 animate-spin text-muted-foreground/60" />}
      </div>
    </td>
  )
}

function AcoesModal({ acoes, produtos, onClose }: {
  acoes: Record<string, string>
  produtos: string[]
  onClose: () => void
}) {
  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
  const com = produtos.filter(p => acoes[p]?.trim())

  function copiar() {
    const linhas = [`📋 Ações do Placar — ${hoje}`, '']
    for (const p of com) {
      linhas.push(`• *${p}*: ${acoes[p].trim()}`)
    }
    navigator.clipboard.writeText(linhas.join('\n'))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative z-10 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-lg border flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h3 className="font-semibold">Ações do dia</h3>
            <p className="text-xs text-muted-foreground capitalize">{hoje}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={copiar} className="text-xs px-3 py-1.5 rounded border hover:bg-muted transition-colors">
              Copiar texto
            </button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {com.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhuma ação registrada hoje.</p>
          ) : com.map(p => (
            <div key={p} className="rounded-lg border p-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{p}</p>
              <p className="text-sm whitespace-pre-wrap">{acoes[p].trim()}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Linha de produto (com drill-down de ofertas) ────────────────────────────

const PCT_META_CRITICO = 40

function ProdutoRow({ p, stripe, month, token, onMeta, onOrcamento, metaReadOnly, leadsUtm, leadsClint, clintAtivo, orcEntry, acoes, onAcao, leadsDist, since, until }: {
  p: Produto; stripe: boolean; month: string; token: string
  onMeta: (goalName: string, v: number) => void
  onOrcamento: (nome: string, e: OrcamentoEntry) => void
  metaReadOnly: boolean
  leadsUtm: number | null; leadsClint: ClintLeads | null; clintAtivo: boolean
  orcEntry: OrcamentoEntry
  acoes: Record<string, string>
  onAcao: (produto: string, valor: string) => void
  leadsDist: LeadsDistRow[]
  since: string; until: string
}) {
  const [open, setOpen] = useState(false)
  const [showDist, setShowDist] = useState(false)
  const [showClintDetail, setShowClintDetail] = useState(false)
  const pct = p.meta && p.meta > 0 ? (p.liquido / p.meta) * 100 : null
  const hasOfertas = (p.ofertas?.length ?? 0) > 1
  const cpv = p.gasto > 0 && p.vendas > 0 ? p.gasto / p.vendas : null
  const cplUtm = p.gasto > 0 && leadsUtm != null && leadsUtm > 0 ? p.gasto / leadsUtm : null
  const cplClint = p.gasto > 0 && leadsClint != null && leadsClint.interessado > 0 ? p.gasto / leadsClint.interessado : null
  const pctCls = pct === null ? '' : pct >= 100 ? 'text-green-600 font-semibold' : pct >= 70 ? 'text-yellow-600' : 'text-red-600'
  const critico = pct !== null && pct < PCT_META_CRITICO
  const rowCls = critico ? 'bg-red-50 dark:bg-red-950/30' : (stripe ? 'bg-muted/20' : '')

  const alvos = calcAlvos(p.meta, orcEntry)

  const cpvColor = colorCusto(cpv, alvos.tetoCpv)
  // CPL: usa UTM se disponível, senão Clint
  const cplRef = cplUtm ?? cplClint
  const cplColor = colorCusto(cplRef, alvos.tetoCpl)
  const roasColor = colorRoas(p.roas, alvos.roasEsperado)

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
        {/* Meta + % */}
        <EditableMeta month={month} goalName={p.goalName} meta={p.meta} onSaved={v => onMeta(p.goalName, v)} readOnly={metaReadOnly}
          pctNode={pct !== null ? <span className={pctCls}>{pct.toFixed(0)}%{pct >= 100 ? ' ✓' : ''}</span> : null} />
        {/* Gasto */}
        <GastoCell gasto={p.gasto} etapas={p.gastoEtapas} />
        {/* Orçamento mês (editável) */}
        <EditableOrcamento month={month} product={p.nome} token={token} entry={orcEntry} onSaved={e => onOrcamento(p.nome, e)} />
        {/* Vendas */}
        <td className="px-4 py-2.5 text-right">{p.vendas}</td>
        {/* Leads — clicável abre distribuição por campanha/content */}
        <td className="px-4 py-2.5 text-right">
          {leadsUtm != null && leadsUtm > 0 ? (
            <button
              onClick={() => setShowDist(true)}
              className="font-medium tabular-nums hover:text-primary hover:underline transition-colors"
              title="Clique para ver distribuição por campanha e anúncio"
            >
              {leadsUtm.toLocaleString('pt-BR')}
            </button>
          ) : <span className="text-muted-foreground">—</span>}
          {clintAtivo && leadsClint && leadsClint.total > 0 && (
            <div className="text-xs text-muted-foreground">
              <button
                onClick={() => setShowClintDetail(true)}
                className="font-medium text-foreground hover:text-primary hover:underline transition-colors"
                title="Clique para ver os leads"
              >
                {leadsClint.total.toLocaleString('pt-BR')}
              </button>
              {' '}
              <span title="Interessado / Abordado (campo tipo preenchido)">
                ({leadsClint.interessado} int · {leadsClint.abordado} abord)
              </span>
            </div>
          )}
          {showDist && (
            <LeadsDistModal produto={p.nome} rows={leadsDist} token={token} onClose={() => setShowDist(false)} />
          )}
          {showClintDetail && leadsClint && (
            <ClintLeadsModal
              produto={p.nome} token={token} since={since} until={until}
              total={leadsClint.total} onClose={() => setShowClintDetail(false)}
            />
          )}
        </td>
        {/* CPV com teto */}
        <td className="px-4 py-2.5 text-right">
          <div className={cpv !== null ? cpvColor || 'text-muted-foreground' : 'text-muted-foreground'}>
            {cpv !== null ? fmtBRL(cpv) : '—'}
          </div>
          {alvos.tetoCpv !== null && (
            <div className="text-[11px] text-muted-foreground">teto {fmtBRL(alvos.tetoCpv)}</div>
          )}
        </td>
        {/* CPL com teto */}
        <td className="px-4 py-2.5 text-right">
          <div title="CPL UTM = gasto ÷ leads UTM" className={cplUtm !== null ? cplColor || 'text-muted-foreground' : 'text-muted-foreground'}>
            {cplUtm !== null ? fmtBRL(cplUtm) : '—'}
          </div>
          {clintAtivo && cplClint !== null && (
            <div className={`text-xs ${cplUtm === null ? cplColor : ''}`} title="CPL Clint = gasto ÷ leads interessado (Clint)">
              {fmtBRL(cplClint)}
            </div>
          )}
          {alvos.tetoCpl !== null && (
            <div className="text-[11px] text-muted-foreground">teto {fmtBRL(alvos.tetoCpl)}</div>
          )}
        </td>
        {/* ROAS com esperado */}
        <td className="px-4 py-2.5 text-right">
          {p.roas !== null ? (
            <div className={roasColor || (p.roas >= 1 ? 'text-green-600 font-medium' : 'text-red-600')}>
              {p.roas.toFixed(2)}x
            </div>
          ) : <div className="text-muted-foreground">—</div>}
          {alvos.roasEsperado !== null && (
            <div className="text-[11px] text-muted-foreground">esp {alvos.roasEsperado.toFixed(2)}x</div>
          )}
        </td>
        {/* Ação rápida */}
        <AcaoCell produto={p.nome} acoes={acoes} onChange={onAcao} />
      </tr>
      {open && p.ofertas?.map(o => (
        <tr key={o.code} className="border-b bg-muted/5 text-xs text-muted-foreground">
          <td className="pl-10 py-1.5 italic">
            {o.nome}{o.nome !== o.code && <span className="not-italic opacity-50"> ({o.code})</span>}
          </td>
          <td className="px-4 py-1.5 text-right">{fmtBRL(o.liquido)}</td>
          <td colSpan={4} />
          <td className="px-4 py-1.5 text-right">{o.vendas}</td>
          <td colSpan={4} />
        </tr>
      ))}
    </>
  )
}

// ─── Modal: mapeamento de campanha → produto (campaign_produto_map) ──────────

interface MapRow { id: number; account: string; prefixo: string; produto_ids: number[]; label: string }

function CampanhaMapModal({ token, onClose, onChanged }: { token: string; onClose: () => void; onChanged: () => void }) {
  const [account, setAccount] = useState<'conta1' | 'conta2'>('conta1')
  const [rows, setRows] = useState<MapRow[]>([])
  const [loading, setLoading] = useState(true)
  const [newPrefixo, setNewPrefixo] = useState('')
  const [newId, setNewId] = useState('')
  const [saving, setSaving] = useState(false)
  const [produtoOpts, setProdutoOpts] = useState<Array<{ label: string; id: number }>>(PRODUTOS_SELECIONAVEIS)

  // Carrega lista de produtos do banco (para refletir produtos adicionados via UI)
  useEffect(() => {
    fetch('/api/produtos-canonicos', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then((data: Array<{ product_id: number; nome: string }> | null) => {
        if (data && data.length > 0) {
          setProdutoOpts(data.map(p => ({ label: p.nome, id: p.product_id })).sort((a, b) => a.label.localeCompare(b.label)))
        }
      })
      .catch(() => {/* fallback para PRODUTOS_SELECIONAVEIS já no state */})
  }, [token])

  const idToLabel = Object.fromEntries(produtoOpts.map(p => [p.id, p.label]))

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
    const label = idToLabel[idNum] ?? ''
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

        <div className="px-5 py-3 border-b flex gap-2">
          {(['conta1', 'conta2'] as const).map(c => (
            <button key={c} onClick={() => setAccount(c)}
              className={`text-xs px-3 py-1.5 rounded border transition-colors ${account === c ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>
              {c === 'conta1' ? 'GBS Launch (conta1)' : 'GBS Pós (conta2)'}
            </button>
          ))}
        </div>

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
              {produtoOpts.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <button onClick={add} disabled={saving || !newPrefixo.trim() || !newId}
              className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-2">
          {loading && <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhuma regra nesta conta. Tudo cai em Buco Approve.</p>
          )}
          {rows.map(r => (
            <div key={r.id} className="flex items-center gap-2 px-3 py-2 rounded hover:bg-muted/40 group">
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{r.prefixo}</code>
              <span className="text-muted-foreground text-xs">→</span>
              <span className="text-sm flex-1">{idToLabel[r.produto_ids?.[0]] ?? r.label ?? `id ${r.produto_ids?.[0]}`}</span>
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

  const loadAvailable = useCallback(async () => {
    const r = await fetch('/api/clint-tags?available=1', { headers: { Authorization: `Bearer ${token}` } })
    const j = await r.json().catch(() => ({}))
    if (r.ok) setAvailable(j.available ?? [])
    else { setAvailable([]); setTagsErro(j.detail ?? j.error ?? 'Falha ao listar tags da Clint') }
  }, [token])

  useEffect(() => { load(); loadAvailable() }, [load, loadAvailable])

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
              {PRODUTOS_SELECIONAVEIS.map(p => <option key={p.id} value={p.label}>{p.label}</option>)}
            </select>
            <div className="flex-1 relative">
              <input
                className="w-full text-sm border rounded px-2.5 py-1.5 bg-background"
                placeholder={available === null ? 'carregando tags…' : selectedTag ? selectedTag.name : 'buscar tag da Clint pelo nome…'}
                value={selectedTag ? selectedTag.name : tagSearch}
                onChange={e => { setSelectedTag(null); setTagSearch(e.target.value) }}
                disabled={available === null}
              />
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

// ─── Lançamento ativo (rodando agora: captura_inicio ≤ hoje ≤ carrinho_fim) ───

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function findLancamentoAtivo(lancamentos: Lancamento[]): Lancamento | null {
  const today = todayIsoDate()
  return lancamentos.find(l => {
    const inicio = l.captura_inicio ?? l.data_inicio
    const fim = l.carrinho_fim
    if (!inicio || !fim) return false
    return inicio <= today && today <= fim
  }) ?? null
}

function LancamentoAtivoCard({ token }: { token: string }) {
  const [lancamento, setLancamento] = useState<Lancamento | null | undefined>(undefined)
  const [totalLeads, setTotalLeads] = useState<number | null>(null)
  const [gastoCaptura, setGastoCaptura] = useState<number | null>(null)
  const [vendasAntecipado, setVendasAntecipado] = useState<{ vendas: number; liquido: number } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('lancamentos').select('*').order('ordem').order('created_at', { ascending: false })
      .then(({ data }) => setLancamento(findLancamentoAtivo((data ?? []) as Lancamento[])))
  }, [])

  useEffect(() => {
    if (!lancamento) return

    const since = lancamento.captura_inicio ?? lancamento.data_inicio ?? ''
    const until = lancamento.carrinho_fim ?? ''
    if (!since || !until) return

    const headers = { Authorization: `Bearer ${token}` }

    const leadsPromise = fetch(
      `/api/launch-data?prefix=${encodeURIComponent(lancamento.prefixo)}&since=${since}&until=${until}&broadSearch=true`,
      { headers },
    )
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(j => {
        const rows: Array<{ lead_email?: string; date?: string }> = j.rows ?? []
        const emails = new Set<string>()
        for (const row of rows) {
          const email = row.lead_email
          const date = row.date?.slice(0, 10) ?? ''
          if (email && date >= since && date <= until) emails.add(email)
        }
        return emails.size
      })
      .catch(() => null)

    const gastoPromise = fetch(
      `/api/meta-spend?since=${since}&until=${until}&spendFilter=${encodeURIComponent(lancamento.spend_filter)}&orFilter=${encodeURIComponent(lancamento.or_filter)}`,
      { headers },
    )
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(j => {
        const campaigns: Array<{ name: string; spend: number }> = j.metaCampaigns ?? []
        const pfx = lancamento.prefixo.toLowerCase()
        return campaigns
          .filter(c => { const n = c.name.toLowerCase(); return n.includes(pfx) && n.includes('captura') && !n.includes('engajamento') })
          .reduce((s, c) => s + c.spend, 0)
      })
      .catch(() => null)

    const vendasPromise = lancamento.tipo === 'meteórico' && lancamento.produto_antecipado_id != null
      ? fetch(`/api/lancamento-vendas?since=${since}&until=${lancamento.captura_fim ?? until}`, { headers })
          .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
          .then(j => j.vendasPorProdutoId?.[lancamento.produto_antecipado_id!] ?? { vendas: 0, liquido: 0 })
          .catch(() => ({ vendas: 0, liquido: 0 }))
      : Promise.resolve({ vendas: 0, liquido: 0 })

    Promise.all([leadsPromise, gastoPromise, vendasPromise]).then(([leads, gasto, vendas]) => {
      setTotalLeads(leads)
      setGastoCaptura(gasto)
      setVendasAntecipado(vendas)
      setLoading(false)
    })
  }, [token, lancamento])

  if (lancamento === undefined) return null
  if (lancamento === null) return null

  const metaLeads = lancamento.meta_leads_trafico + lancamento.meta_leads_organico + lancamento.meta_leads_manychat

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 px-4 py-2 border-b bg-muted/40">
        <span className="text-sm font-semibold">
          Lançamento em andamento: <span style={{ color: CHART_COLORS[1] }}>{lancamento.nome}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {lancamento.captura_inicio ?? lancamento.data_inicio} → {lancamento.carrinho_fim}
        </span>
      </div>
      {loading ? (
        <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <LancamentoLeadsKpis
          totalLeads={totalLeads ?? 0}
          metaLeads={metaLeads}
          investimento={gastoCaptura ?? 0}
          receitaAntecipado={vendasAntecipado?.liquido ?? 0}
          qtdVendasAntecipado={vendasAntecipado?.vendas ?? 0}
        />
      )}
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

const EMPTY_ORC: OrcamentoEntry = { orcamento: null, ticket: null, conversao: null }

export default function TabPlacar({ token, enabled }: Props) {
  const [month, setMonth] = useState(currentMonthStr)
  const [data, setData] = useState<PlacarResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showMap, setShowMap] = useState(false)
  const [showClint, setShowClint] = useState(false)
  const [showAcoes, setShowAcoes] = useState(false)
  const [leads, setLeads] = useState<LeadsData | null>(null)
  const [rangeSince, setRangeSince] = useState('')
  const [rangeUntil, setRangeUntil] = useState('')
  // Orçamento por produto: produto nome → OrcamentoEntry
  const [orcamentos, setOrcamentos] = useState<Record<string, OrcamentoEntry>>({})
  // Ações rápidas do dia: produto → texto
  const [acoes, setAcoes] = useState<Record<string, string>>({})

  const load = useCallback(async (m: string, since = '', until = '') => {
    setLoading(true)
    setError('')
    try {
      const rangeQs = since && until ? `&since=${since}&until=${until}` : ''
      const r = await fetch(`/api/placar?month=${m}${rangeQs}`, { headers: { Authorization: `Bearer ${token}` } })
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

  const loadLeads = useCallback(async (m: string, since = '', until = '') => {
    setLeads(null)
    try {
      const rangeQs = since && until ? `&since=${since}&until=${until}` : ''
      const r = await fetch(`/api/placar-leads?month=${m}${rangeQs}`, { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) setLeads(await r.json())
    } catch { /* silencioso */ }
  }, [token])

  const loadOrcamentos = useCallback(async (m: string) => {
    try {
      const r = await fetch(`/api/orcamento?month=${m}`, { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) {
        const j = await r.json()
        setOrcamentos(j.produtos ?? {})
      }
    } catch { /* silencioso */ }
  }, [token])

  const loadAcoes = useCallback(async () => {
    try {
      const { data: rows } = await supabase
        .from('placar_acoes')
        .select('produto, acao')
        .eq('data', todayIso())
      const map: Record<string, string> = {}
      for (const r of rows ?? []) map[r.produto] = r.acao
      setAcoes(map)
    } catch { /* silencioso */ }
  }, [])

  const onAcao = useCallback((produto: string, valor: string) => {
    setAcoes(prev => ({ ...prev, [produto]: valor }))
  }, [])

  useEffect(() => {
    if (enabled) {
      load(month, rangeSince, rangeUntil)
      loadLeads(month, rangeSince, rangeUntil)
      loadOrcamentos(month)
      loadAcoes()
    }
  }, [enabled, month, rangeSince, rangeUntil, load, loadLeads, loadOrcamentos, loadAcoes])

  const onMeta = useCallback((goalName: string, v: number) => {
    setData(prev => {
      if (!prev) return prev
      const produtos = prev.produtos.map(p => p.goalName === goalName ? { ...p, meta: v } : p)
      const totalMeta = produtos.reduce((s, p) => s + (p.meta ?? 0), 0)
      return { ...prev, produtos, totalMeta }
    })
  }, [])

  const onOrcamento = useCallback((nome: string, entry: OrcamentoEntry) => {
    setOrcamentos(prev => ({ ...prev, [nome]: entry }))
  }, [])

  const { dayOfMonth, lastDay, isCurrent } = daysInfo(month)
  const totalLiquido = data?.totalLiquido ?? 0
  const totalMeta = data?.totalMeta ?? 0
  const pctMeta = totalMeta > 0 ? (totalLiquido / totalMeta) * 100 : null
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

  // Total do orçamento (soma dos produtos que têm orçamento definido)
  const totalOrcamento = Object.values(orcamentos).reduce((s, e) => s + (e.orcamento ?? 0), 0)
  const roasEsperadoTotal = totalOrcamento > 0 && totalMeta > 0 ? totalMeta / totalOrcamento : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">Placar do Negócio 🎯</h2>
          <p className="text-xs text-muted-foreground">Faturamento líquido (comissão Hotmart) por produto · {month}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={month} onChange={e => { setMonth(e.target.value); setRangeSince(''); setRangeUntil('') }} className="text-sm border rounded px-2 py-1.5 bg-background">
            {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>de</span>
            <input type="date" value={rangeSince} onChange={e => setRangeSince(e.target.value)} className="text-sm border rounded px-2 py-1.5 bg-background" />
            <span>até</span>
            <input type="date" value={rangeUntil} onChange={e => setRangeUntil(e.target.value)} className="text-sm border rounded px-2 py-1.5 bg-background" />
            {(rangeSince || rangeUntil) && (
              <button onClick={() => { setRangeSince(''); setRangeUntil('') }} className="underline hover:no-underline">limpar</button>
            )}
          </div>
          <button onClick={() => setShowAcoes(true)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border bg-background hover:bg-muted transition-colors" title="Ver ações do dia">
            <ClipboardList className="h-3.5 w-3.5" />
            Ver ações
          </button>
          <button onClick={() => setShowMap(true)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border bg-background hover:bg-muted transition-colors" title="Mapear campanhas para produtos">
            <Settings className="h-3.5 w-3.5" />
            Campanhas
          </button>
          <button onClick={() => setShowClint(true)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border bg-background hover:bg-muted transition-colors" title="Tags da Clint por produto">
            <Settings className="h-3.5 w-3.5" />
            Tags Clint
          </button>
          <button onClick={() => { load(month, rangeSince, rangeUntil); loadLeads(month, rangeSince, rangeUntil); loadOrcamentos(month) }} disabled={loading} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border bg-background hover:bg-muted transition-colors disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {showMap && <CampanhaMapModal token={token} onClose={() => setShowMap(false)} onChanged={() => load(month, rangeSince, rangeUntil)} />}
      {showClint && <ClintTagsModal token={token} onClose={() => setShowClint(false)} onChanged={() => loadLeads(month, rangeSince, rangeUntil)} />}
      {showAcoes && <AcoesModal acoes={acoes} produtos={produtos.map(p => p.nome)} onClose={() => setShowAcoes(false)} />}

      <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-xs text-blue-800">
        ⚙️ Aba em construção. O gasto de cada campanha é atribuído ao produto pela aba <strong>Produtos/Campanhas</strong> (prefixo → produto). Campanha sem regra cai em <strong>Buco Approve</strong>.
      </div>

      {(rangeSince || rangeUntil) && !data?.range && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-2.5 text-sm text-destructive">
          Período inválido — selecione <strong>de</strong> e <strong>até</strong> dentro do mês {month} (não pode cruzar dois meses).
        </div>
      )}
      {data?.range && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-2.5 text-xs text-amber-800">
          Período <strong>{data.range.since}</strong> a <strong>{data.range.until}</strong> ({Math.round(data.range.diasNoRange)} de {data.range.diasNoMes} dias). Faturamento, gasto, vendas e leads são do período; metas estão <strong>proporcionais</strong> ({Math.round(data.range.fatorMeta * 100)}% da mensal).
        </div>
      )}

      {error && <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

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

      {data && (() => {
        const restante = totalMeta - totalLiquido
        const roasGeral = gastoProdutos > 0 ? totalLiquido / gastoProdutos : null
        const roasGeralColor = colorRoas(roasGeral, roasEsperadoTotal)
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Faturamento', value: fmtBRL(totalLiquido), sub: pctMeta !== null ? `${pctMeta.toFixed(0)}% da meta` : null, cls: '' },
              { label: 'Gasto total (2 contas)', value: totalGasto > 0 ? fmtBRL(totalGasto) : '—', sub: gastoProdutos > 0 ? `${fmtBRL(gastoProdutos)} em produtos` : null, cls: '' },
              {
                label: 'ROAS geral',
                value: roasGeral !== null ? `${roasGeral.toFixed(2)}x` : '—',
                sub: roasEsperadoTotal !== null ? `esp ${roasEsperadoTotal.toFixed(2)}x` : 'líquido ÷ gasto produtos',
                cls: roasGeralColor,
              },
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

      {data?.metaError && (
        <div className="rounded-md bg-yellow-50 border border-yellow-200 px-4 py-2.5 text-xs text-yellow-800">
          ⚠️ Gasto Meta indisponível ({data.metaError}). Verifique <code>META_AD_ACCOUNTS</code> e <code>META_ACCESS_TOKEN</code> no Vercel.
        </div>
      )}

      {produtos.length > 0 && (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-2.5 font-medium">Produto</th>
                <th className="text-right px-4 py-2.5 font-medium">Faturamento</th>
                <th className="text-right px-4 py-2.5 font-medium">Meta</th>
                <th className="text-right px-4 py-2.5 font-medium">Gasto</th>
                <th className="text-right px-4 py-2.5 font-medium">
                  <span title="Orçamento mensal de tráfego. Clique no valor para editar junto com ticket e conversão.">Orç. mês ✎</span>
                </th>
                <th className="text-right px-4 py-2.5 font-medium">Vendas</th>
                <th className="text-right px-4 py-2.5 font-medium" title="Leads UTM (BigQuery) e Leads Clint (interessado/abordado)">Leads</th>
                <th className="text-right px-4 py-2.5 font-medium" title="CPV real e teto calculado. Verde ≤ teto, Amarelo ≤ teto×1,10, Vermelho acima.">CPV</th>
                <th className="text-right px-4 py-2.5 font-medium" title="CPL real e teto calculado. Verde ≤ teto, Amarelo ≤ teto×1,10, Vermelho acima.">CPL</th>
                <th className="text-right px-4 py-2.5 font-medium" title="ROAS real e esperado. Verde ≥ esperado, Amarelo ≥ esperado×0,90, Vermelho abaixo.">ROAS</th>
                <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Ação</th>
              </tr>
            </thead>
            <tbody>
              {produtos.map((p, i) => (
                <ProdutoRow key={p.nome} p={p} stripe={i % 2 !== 0} month={month} token={token} onMeta={onMeta} onOrcamento={onOrcamento}
                  metaReadOnly={!!data?.range}
                  leadsUtm={leads?.leadsUtm[p.nome] ?? null}
                  leadsClint={leads?.leadsClint[p.nome] ?? null}
                  clintAtivo={leads?.clintAtivo ?? false}
                  orcEntry={orcamentos[p.nome] ?? EMPTY_ORC}
                  acoes={acoes} onAcao={onAcao}
                  leadsDist={leads?.leadsDistribuicao[p.nome] ?? []}
                  since={rangeSince || `${month}-01`}
                  until={rangeUntil || new Date(Number(month.split('-')[0]), Number(month.split('-')[1]), 0).toISOString().slice(0, 10)} />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/50 font-semibold">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right">{fmtBRL(totalLiquido)}</td>
                <td className="px-4 py-2.5 text-right">
                  <div>{totalMeta > 0 ? fmtBRL(totalMeta) : '—'}</div>
                  {totalMeta > 0 && pctMeta !== null && <div className="text-xs font-normal"><span className={pctMeta >= 100 ? 'text-green-600' : ''}>{pctMeta.toFixed(0)}%{pctMeta >= 100 ? ' ✓' : ''}</span></div>}
                </td>
                <td className="px-4 py-2.5 text-right">{gastoProdutos > 0 ? fmtBRL(gastoProdutos) : '—'}</td>
                {/* Orçamento total */}
                <td className="px-4 py-2.5 text-right">
                  {totalOrcamento > 0 ? (
                    <span className="rounded px-1.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200">{fmtBRL(totalOrcamento)}</span>
                  ) : '—'}
                </td>
                <td className="px-4 py-2.5 text-right">{data?.totalVendas ?? 0}</td>
                <td className="px-4 py-2.5 text-right">
                  {leads ? (
                    <>
                      <div>{Object.values(leads.leadsUtm).reduce((s, v) => s + v, 0).toLocaleString('pt-BR')}</div>
                      {leads.clintAtivo && <div className="text-xs font-normal text-muted-foreground">{Object.values(leads.leadsClint).reduce((s, v) => s + v.total, 0).toLocaleString('pt-BR')} total Clint</div>}
                    </>
                  ) : '—'}
                </td>
                {/* CPV total */}
                <td className="px-4 py-2.5 text-right">{gastoProdutos > 0 && (data?.totalVendas ?? 0) > 0 ? fmtBRL(gastoProdutos / (data?.totalVendas ?? 1)) : '—'}</td>
                <td className="px-4 py-2.5 text-right">—</td>
                {/* ROAS total */}
                <td className="px-4 py-2.5 text-right">
                  {gastoProdutos > 0 ? (
                    <>
                      <div className={colorRoas(totalLiquido / gastoProdutos, roasEsperadoTotal) || (totalLiquido / gastoProdutos >= 1 ? 'text-green-600' : 'text-red-600')}>
                        {(totalLiquido / gastoProdutos).toFixed(2)}x
                      </div>
                      {roasEsperadoTotal !== null && (
                        <div className="text-[11px] font-normal text-muted-foreground">esp {roasEsperadoTotal.toFixed(2)}x</div>
                      )}
                    </>
                  ) : '—'}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <LancamentoAtivoCard token={token} />

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
