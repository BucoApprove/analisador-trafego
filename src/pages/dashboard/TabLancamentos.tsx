import { useState, useCallback, useEffect } from 'react'
import { Plus, X, Loader2, Trash2, ChevronLeft, Calendar, Pencil } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Lancamento } from '@/lib/supabase'
import type { GoalsData } from './types'
import TabBA25 from './TabBA25'

// Monta o objeto de metas (GoalsData) a partir do lançamento, substituindo a
// planilha legada do goals-data. Origens de captura e keywords de fase são
// fixas (Tráfego/Orgânico/Manychat · instagram/engajamento/lembrete/remarketing).
function goalsFromLancamento(l: Lancamento): GoalsData {
  return {
    metaLeadsTrafico: l.meta_leads_trafico,
    metaLeadsOrganico: l.meta_leads_organico,
    metaLeadsManychat: l.meta_leads_manychat,
    orcamentoTotal: l.orcamento_total,
    inicioCaptacao: l.captura_inicio ?? '',
    finalCaptacao: l.captura_fim ?? '',
    orcamentoPorFase: {
      captura: l.orcamento_captura,
      descoberta: l.orcamento_descoberta,
      aquecimento: l.orcamento_aquecimento,
      lembrete: l.orcamento_lembrete,
      remarketing: l.orcamento_remarketing,
    },
    tagsReferencia: {
      lancamento: l.prefixo,
      captura: 'Captura',
      descoberta: 'Instagram',
      aquecimento: 'Engajamento',
      lembrete: 'Lembrete',
      remarketing: 'Remarketing',
    },
  }
}

interface Props { token: string; enabled: boolean }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y.slice(2)}`
}

// Produtos vinculáveis (mesma lista do Placar). label → product_id.
const PRODUTOS: Array<{ label: string; id: number }> = [
  { label: 'Buco Approve', id: 2016048 },
  { label: 'Intensivo ENARE', id: -2016048 },
  { label: 'Mentoria CTBMF', id: 3811518 },
  { label: 'Pós Patologia', id: 5694443 },
  { label: 'Pós Anatomia', id: 6115663 },
  { label: 'Planejamento ImpulsoR+', id: 6739963 },
  { label: 'Renovação de acesso', id: 3510472 },
  { label: 'Rota Enare', id: 4739673 },
  { label: 'BucoApp', id: 2286372 },
  { label: 'Imersão ENARE', id: 7737553 },
  { label: 'Segurança Clínica por Casos', id: 7812483 },
  { label: 'Low ticket', id: 6766383 },
]

const emptyForm = {
  nome: '', prefixo: '', spend_filter: '', or_filter: '', tipo: 'interno',
  data_inicio: '', captura_inicio: '', captura_fim: '', carrinho_inicio: '', carrinho_fim: '',
  produto_venda: '', survey_sheet_id: '',
  meta_leads_trafico: '', meta_leads_organico: '', meta_leads_manychat: '',
  orcamento_total: '', orcamento_captura: '', orcamento_descoberta: '',
  orcamento_aquecimento: '', orcamento_lembrete: '', orcamento_remarketing: '',
  produto_ingresso_id: '', produto_principal_id: '', produto_downsell_id: '',
  meta_vendas_ingresso: '', meta_vendas_principal: '', meta_vendas_downsell: '',
}
type FormState = typeof emptyForm

// ─── Modal de cadastro/edição ────────────────────────────────────────────────

function LancamentoModal({ initial, onClose, onSaved }: {
  initial: Lancamento | null
  onClose: () => void
  onSaved: () => void
}) {
  const numStr = (n: number | null | undefined) => (n && n > 0 ? String(n) : '')
  const idStr = (n: number | null | undefined) => (n != null ? String(n) : '')
  const [form, setForm] = useState<FormState>(initial ? {
    nome: initial.nome, prefixo: initial.prefixo, spend_filter: initial.spend_filter, or_filter: initial.or_filter,
    tipo: initial.tipo ?? 'interno',
    data_inicio: initial.data_inicio ?? '', captura_inicio: initial.captura_inicio ?? '', captura_fim: initial.captura_fim ?? '',
    carrinho_inicio: initial.carrinho_inicio ?? '', carrinho_fim: initial.carrinho_fim ?? '',
    produto_venda: initial.produto_venda ?? '', survey_sheet_id: initial.survey_sheet_id ?? '',
    meta_leads_trafico: numStr(initial.meta_leads_trafico), meta_leads_organico: numStr(initial.meta_leads_organico), meta_leads_manychat: numStr(initial.meta_leads_manychat),
    orcamento_total: numStr(initial.orcamento_total), orcamento_captura: numStr(initial.orcamento_captura), orcamento_descoberta: numStr(initial.orcamento_descoberta),
    orcamento_aquecimento: numStr(initial.orcamento_aquecimento), orcamento_lembrete: numStr(initial.orcamento_lembrete), orcamento_remarketing: numStr(initial.orcamento_remarketing),
    produto_ingresso_id: idStr(initial.produto_ingresso_id), produto_principal_id: idStr(initial.produto_principal_id), produto_downsell_id: idStr(initial.produto_downsell_id),
    meta_vendas_ingresso: numStr(initial.meta_vendas_ingresso), meta_vendas_principal: numStr(initial.meta_vendas_principal), meta_vendas_downsell: numStr(initial.meta_vendas_downsell),
  } : emptyForm)
  const [saving, setSaving] = useState(false)

  const set = (k: keyof FormState, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!form.nome.trim()) return
    setSaving(true)
    const num = (s: string) => parseFloat(s.replace(/\./g, '').replace(',', '.').trim()) || 0
    const int = (s: string) => parseInt(s.trim(), 10) || 0
    const idOrNull = (s: string) => (s.trim() === '' ? null : parseInt(s.trim(), 10))
    const payload = {
      nome: form.nome.trim(),
      prefixo: form.prefixo.trim(),
      spend_filter: form.spend_filter.trim(),
      or_filter: form.or_filter.trim(),
      tipo: form.tipo,
      produto_ingresso_id: idOrNull(form.produto_ingresso_id),
      produto_principal_id: idOrNull(form.produto_principal_id),
      produto_downsell_id: idOrNull(form.produto_downsell_id),
      meta_vendas_ingresso: int(form.meta_vendas_ingresso),
      meta_vendas_principal: int(form.meta_vendas_principal),
      meta_vendas_downsell: int(form.meta_vendas_downsell),
      data_inicio: form.data_inicio || null,
      captura_inicio: form.captura_inicio || null,
      captura_fim: form.captura_fim || null,
      carrinho_inicio: form.carrinho_inicio || null,
      carrinho_fim: form.carrinho_fim || null,
      produto_venda: form.produto_venda.trim(),
      survey_sheet_id: form.survey_sheet_id.trim(),
      meta_leads_trafico: int(form.meta_leads_trafico),
      meta_leads_organico: int(form.meta_leads_organico),
      meta_leads_manychat: int(form.meta_leads_manychat),
      orcamento_total: num(form.orcamento_total),
      orcamento_captura: num(form.orcamento_captura),
      orcamento_descoberta: num(form.orcamento_descoberta),
      orcamento_aquecimento: num(form.orcamento_aquecimento),
      orcamento_lembrete: num(form.orcamento_lembrete),
      orcamento_remarketing: num(form.orcamento_remarketing),
    }
    const { error } = initial
      ? await supabase.from('lancamentos').update(payload).eq('id', initial.id)
      : await supabase.from('lancamentos').insert(payload)
    setSaving(false)
    if (!error) onSaved()
  }

  const dateField = (label: string, k: keyof FormState) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input type="date" value={form[k]} onChange={e => set(k, e.target.value)} className="text-sm border rounded px-2 py-1.5 bg-background" />
    </label>
  )

  const textField = (label: string, k: keyof FormState, ph = '') => (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input value={form[k]} onChange={e => set(k, e.target.value)} placeholder={ph} className="text-sm border rounded px-2 py-1.5 bg-background" inputMode="decimal" />
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative z-10 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[88vh] overflow-y-auto border" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white dark:bg-zinc-900">
          <h3 className="font-semibold">{initial ? 'Editar lançamento' : 'Novo lançamento'}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Nome do lançamento</span>
            <input value={form.nome} onChange={e => set('nome', e.target.value)} placeholder="ex: Imersão ENARE" className="text-sm border rounded px-2.5 py-1.5 bg-background" autoFocus />
          </label>

          <div>
            <span className="text-xs text-muted-foreground block mb-1">Tipo de lançamento</span>
            <div className="flex gap-2">
              {([['interno', 'Interno (3 aulas → lead → venda)'], ['pago', 'Pago (evento/ingresso → venda)']] as const).map(([v, lbl]) => (
                <button key={v} type="button" onClick={() => set('tipo', v)}
                  className={`flex-1 text-xs px-3 py-2 rounded border transition-colors ${form.tipo === v ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 col-span-1">
              <span className="text-xs text-muted-foreground">Prefixo da campanha</span>
              <input value={form.prefixo} onChange={e => set('prefixo', e.target.value)} placeholder="BA25" className="text-sm border rounded px-2.5 py-1.5 bg-background font-mono" />
            </label>
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-xs text-muted-foreground">Filtro de gasto (AND)</span>
              <input value={form.spend_filter} onChange={e => set('spend_filter', e.target.value)} placeholder="BA25" className="text-sm border rounded px-2.5 py-1.5 bg-background font-mono" />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Filtro de gasto (OR — separado por vírgula)</span>
            <input value={form.or_filter} onChange={e => set('or_filter', e.target.value)} placeholder="instagram,engajamento,lembrete,remarketing" className="text-sm border rounded px-2.5 py-1.5 bg-background font-mono" />
          </label>

          <div className="border-t pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Datas do funil</p>
            <div className="grid grid-cols-2 gap-3">
              {dateField('Início (geral)', 'data_inicio')}
              <div />
              {dateField('Início da captura', 'captura_inicio')}
              {dateField('Fim da captura', 'captura_fim')}
              {dateField('Abertura do carrinho', 'carrinho_inicio')}
              {dateField('Fechamento do carrinho', 'carrinho_fim')}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">A janela de dados do detalhe vai de <strong>início da captura</strong> a <strong>fechamento do carrinho</strong>.</p>
          </div>

          <div className="border-t pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Produtos & metas de venda (qtd)</p>
            <div className="space-y-3">
              {form.tipo === 'pago' && (
                <div className="grid grid-cols-[2fr_1fr] gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Produto do ingresso (evento)</span>
                    <select value={form.produto_ingresso_id} onChange={e => set('produto_ingresso_id', e.target.value)} className="text-sm border rounded px-2 py-1.5 bg-background">
                      <option value="">—</option>
                      {PRODUTOS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </label>
                  {textField('Meta vendas ingresso', 'meta_vendas_ingresso')}
                </div>
              )}
              <div className="grid grid-cols-[2fr_1fr] gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Produto principal</span>
                  <select value={form.produto_principal_id} onChange={e => set('produto_principal_id', e.target.value)} className="text-sm border rounded px-2 py-1.5 bg-background">
                    <option value="">—</option>
                    {PRODUTOS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </label>
                {textField('Meta vendas principal', 'meta_vendas_principal')}
              </div>
              <div className="grid grid-cols-[2fr_1fr] gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Produto de downsell (opcional)</span>
                  <select value={form.produto_downsell_id} onChange={e => set('produto_downsell_id', e.target.value)} className="text-sm border rounded px-2 py-1.5 bg-background">
                    <option value="">—</option>
                    {PRODUTOS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </label>
                {textField('Meta vendas downsell', 'meta_vendas_downsell')}
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Config do detalhe (opcional)</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Filtro do produto de venda</span>
                <input value={form.produto_venda} onChange={e => set('produto_venda', e.target.value)} placeholder="%buco%approve%" className="text-sm border rounded px-2 py-1.5 bg-background font-mono" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">ID planilha de pesquisa</span>
                <input value={form.survey_sheet_id} onChange={e => set('survey_sheet_id', e.target.value)} placeholder="ID do Google Sheets" className="text-sm border rounded px-2 py-1.5 bg-background font-mono" />
              </label>
            </div>
          </div>

          <div className="border-t pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Metas de leads</p>
            <div className="grid grid-cols-3 gap-3">
              {textField('Tráfego', 'meta_leads_trafico')}
              {textField('Orgânico', 'meta_leads_organico')}
              {textField('ManyChat', 'meta_leads_manychat')}
            </div>
          </div>

          <div className="border-t pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Orçamento por fase (R$)</p>
            <div className="grid grid-cols-3 gap-3">
              {textField('Total', 'orcamento_total')}
              {textField('Captura', 'orcamento_captura')}
              {textField('Descoberta', 'orcamento_descoberta')}
              {textField('Aquecimento', 'orcamento_aquecimento')}
              {textField('Lembrete', 'orcamento_lembrete')}
              {textField('Remarketing', 'orcamento_remarketing')}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t flex justify-end gap-2 sticky bottom-0 bg-white dark:bg-zinc-900">
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded border hover:bg-muted">Cancelar</button>
          <button onClick={save} disabled={saving || !form.nome.trim()} className="text-sm px-4 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Card de lançamento ──────────────────────────────────────────────────────

function LancamentoCard({ l, onOpen, onEdit, onDelete }: {
  l: Lancamento
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="rounded-lg border bg-card hover:shadow-md transition-shadow group relative">
      <button onClick={onOpen} className="w-full text-left p-4">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="font-semibold text-base">{l.nome}</h3>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${l.tipo === 'pago' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
            {l.tipo === 'pago' ? 'pago' : 'interno'}
          </span>
        </div>
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5"><Calendar className="h-3 w-3" /> Captura: {fmtDate(l.captura_inicio)} → {fmtDate(l.captura_fim)}</div>
          <div className="flex items-center gap-1.5"><Calendar className="h-3 w-3" /> Carrinho: {fmtDate(l.carrinho_inicio)} → {fmtDate(l.carrinho_fim)}</div>
          {l.prefixo && <div className="font-mono mt-1.5 inline-block bg-muted px-1.5 py-0.5 rounded">Prefixo: {l.prefixo}</div>}
        </div>
      </button>
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onEdit} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground" title="Editar"><Pencil className="h-3.5 w-3.5" /></button>
        <button onClick={onDelete} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive" title="Excluir"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function TabLancamentos({ token, enabled }: Props) {
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Lancamento | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Lancamento | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('lancamentos').select('*').order('ordem').order('created_at', { ascending: false })
    setLancamentos((data ?? []) as Lancamento[])
    setLoading(false)
  }, [])

  useEffect(() => { if (enabled) load() }, [enabled, load])

  async function remove(l: Lancamento) {
    if (!confirm(`Excluir o lançamento "${l.nome}"?`)) return
    await supabase.from('lancamentos').delete().eq('id', l.id)
    load()
  }

  // ── Detalhe de um lançamento (reusa o TabBA25 com os params dele) ──
  if (selected) {
    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Voltar aos lançamentos
        </button>
        <TabBA25
          token={token}
          enabled={true}
          prefix={selected.prefixo}
          spendFilter={selected.spend_filter}
          orFilter={selected.or_filter}
          defaultSince={selected.captura_inicio ?? selected.data_inicio ?? ''}
          defaultUntil={selected.carrinho_fim ?? ''}
          nome={selected.nome}
          productFilter={selected.produto_venda}
          surveySheetId={selected.survey_sheet_id}
          goalsOverride={goalsFromLancamento(selected)}
        />
      </div>
    )
  }

  // ── Grid de cards ──
  return (
    <div className="space-y-6">
      {modalOpen && (
        <LancamentoModal
          initial={editing}
          onClose={() => { setModalOpen(false); setEditing(null) }}
          onSaved={() => { setModalOpen(false); setEditing(null); load() }}
        />
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">Lançamentos</h2>
          <p className="text-xs text-muted-foreground">Clique num lançamento para ver os dados completos do período.</p>
        </div>
        <button onClick={() => { setEditing(null); setModalOpen(true) }} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded border bg-background hover:bg-muted transition-colors">
          <Plus className="h-4 w-4" /> Novo lançamento
        </button>
      </div>

      {loading && <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}

      {!loading && lancamentos.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <Calendar className="h-8 w-8 opacity-30" />
          <p className="text-sm">Nenhum lançamento cadastrado.</p>
          <button onClick={() => { setEditing(null); setModalOpen(true) }} className="text-primary text-sm underline hover:no-underline">Cadastrar o primeiro</button>
        </div>
      )}

      {!loading && lancamentos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {lancamentos.map(l => (
            <LancamentoCard
              key={l.id}
              l={l}
              onOpen={() => setSelected(l)}
              onEdit={() => { setEditing(l); setModalOpen(true) }}
              onDelete={() => remove(l)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
