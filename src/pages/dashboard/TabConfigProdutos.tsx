import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Plus, Trash2, Save, AlertCircle, CheckCircle2, Pencil, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

type Categoria = 'core' | 'porta' | 'low'

interface ProdutoCanonicoRow {
  product_id: number
  nome: string
  categoria: Categoria
  goal_name: string | null
  intensivo_offer_codes: string[] | null
  is_low_ticket: boolean
  is_intensivo_marker: boolean
}

interface CampanhaRow {
  id?: number
  account: 'conta1' | 'conta2'
  prefixo: string
  produto_ids: number[]
  label: string
  _dirty?: boolean
  _new?: boolean
}

type Toast = { type: 'success' | 'error'; msg: string }

// Produtos que não podem ser removidos
const PROTECTED_IDS = new Set([2016048, 6766383])

// ─── Helper para API call ──────────────────────────────────────────────────────

async function apiCall(path: string, method: string, body?: unknown): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token ?? ''
  const opts: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(path, opts)
  if (res.ok) {
    const data = await res.json()
    return { ok: true, data }
  }
  const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
  return { ok: false, error: err.error ?? res.statusText }
}

// ─── Empty product form ────────────────────────────────────────────────────────

function emptyForm(): Omit<ProdutoCanonicoRow, 'product_id'> & { product_id: number | '' } {
  return { product_id: '', nome: '', categoria: 'core', goal_name: '', intensivo_offer_codes: null, is_low_ticket: false, is_intensivo_marker: false }
}

type FormState = ReturnType<typeof emptyForm>

// ─── Campaign mapping helpers ──────────────────────────────────────────────────

function emptyCampanhaRow(account: 'conta1' | 'conta2'): CampanhaRow {
  return { account, prefixo: '', produto_ids: [], label: '', _dirty: true, _new: true }
}

function idsToString(ids: number[]): string { return ids.join(', ') }

function stringToIds(s: string): number[] {
  return s.split(/[\s,;]+/).map(v => parseInt(v.trim(), 10)).filter(n => !isNaN(n) && n > 0)
}

// ─── Section: Produtos Canônicos ───────────────────────────────────────────────

function SecaoProdutosCanonicos({ onToast }: { onToast: (type: Toast['type'], msg: string) => void }) {
  const [rows, setRows] = useState<ProdutoCanonicoRow[]>([])
  const [loading, setLoading] = useState(false)
  const [editForm, setEditForm] = useState<FormState | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await apiCall('/api/produtos-canonicos', 'GET')
    if (!result.ok) {
      onToast('error', 'Erro ao carregar produtos: ' + (result.error ?? ''))
    } else {
      setRows((result.data as ProdutoCanonicoRow[]) ?? [])
    }
    setLoading(false)
  }, [onToast])

  useEffect(() => { load() }, [load])

  function openNew() {
    setEditForm(emptyForm())
  }

  function openEdit(row: ProdutoCanonicoRow) {
    setEditForm({
      product_id: row.product_id,
      nome: row.nome,
      categoria: row.categoria,
      goal_name: row.goal_name ?? '',
      intensivo_offer_codes: row.intensivo_offer_codes,
      is_low_ticket: row.is_low_ticket,
      is_intensivo_marker: row.is_intensivo_marker,
    })
  }

  function cancelForm() { setEditForm(null) }

  async function saveForm() {
    if (!editForm) return
    if (editForm.product_id === '' || editForm.product_id === undefined) {
      onToast('error', 'product_id é obrigatório')
      return
    }
    if (!editForm.nome?.trim()) { onToast('error', 'Nome é obrigatório'); return }

    setEditSaving(true)
    const offerCodesRaw = Array.isArray(editForm.intensivo_offer_codes)
      ? editForm.intensivo_offer_codes.join(', ')
      : (editForm.intensivo_offer_codes as unknown as string | null) ?? ''
    const payload = {
      product_id: Number(editForm.product_id),
      nome: editForm.nome.trim(),
      categoria: editForm.categoria,
      goal_name: editForm.goal_name?.trim() || null,
      intensivo_offer_codes: offerCodesRaw
        ? offerCodesRaw.split(',').map((s: string) => s.trim()).filter(Boolean)
        : null,
      is_low_ticket: editForm.is_low_ticket,
      is_intensivo_marker: editForm.is_intensivo_marker,
    }
    const result = await apiCall('/api/produtos-canonicos', 'POST', payload)
    if (!result.ok) {
      onToast('error', 'Erro ao salvar: ' + (result.error ?? ''))
    } else {
      onToast('success', 'Produto salvo com sucesso.')
      cancelForm()
      await load()
    }
    setEditSaving(false)
  }

  async function deleteRow(row: ProdutoCanonicoRow) {
    if (PROTECTED_IDS.has(row.product_id)) {
      onToast('error', '"' + row.nome + '" não pode ser removido.')
      return
    }
    if (!window.confirm(`Remover "${row.nome}" (id ${row.product_id})?`)) return
    const result = await apiCall(`/api/produtos-canonicos?id=${row.product_id}`, 'DELETE')
    if (!result.ok) {
      onToast('error', 'Erro ao remover: ' + (result.error ?? ''))
    } else {
      onToast('success', 'Produto removido.')
      await load()
    }
  }

  const categoriaBadge = (c: Categoria) => {
    if (c === 'core') return 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
    if (c === 'porta') return 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
    return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          Produtos Canônicos
          <Button size="sm" variant="outline" onClick={openNew} className="gap-1.5 h-7 text-xs">
            <Plus className="h-3.5 w-3.5" /> Novo produto
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Formulário inline */}
        {editForm && (
          <div className="border border-border rounded-xl p-4 space-y-3 bg-muted/30">
            <p className="text-sm font-semibold">
              {editForm.product_id !== '' ? 'Editar produto' : 'Novo produto'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">product_id *</label>
                <Input
                  type="number"
                  value={editForm.product_id}
                  onChange={e => setEditForm(f => f ? { ...f, product_id: e.target.value === '' ? '' : Number(e.target.value) } : f)}
                  placeholder="ex: 2016048 (negativo para sentinela)"
                  className="h-8 text-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nome *</label>
                <Input
                  value={editForm.nome}
                  onChange={e => setEditForm(f => f ? { ...f, nome: e.target.value } : f)}
                  placeholder="ex: Buco Approve"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Categoria *</label>
                <select
                  value={editForm.categoria}
                  onChange={e => setEditForm(f => f ? { ...f, categoria: e.target.value as Categoria } : f)}
                  className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="core">core</option>
                  <option value="porta">porta</option>
                  <option value="low">low</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">goal_name (monthly_goals)</label>
                <Input
                  value={editForm.goal_name ?? ''}
                  onChange={e => setEditForm(f => f ? { ...f, goal_name: e.target.value } : f)}
                  placeholder="ex: Buco Approve"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">intensivo_offer_codes (separados por vírgula)</label>
                <Input
                  value={
                    Array.isArray(editForm.intensivo_offer_codes)
                      ? editForm.intensivo_offer_codes.join(', ')
                      : (editForm.intensivo_offer_codes as unknown as string) ?? ''
                  }
                  onChange={e => setEditForm(f => f ? { ...f, intensivo_offer_codes: e.target.value as unknown as string[] } : f)}
                  placeholder="ex: wgmh3qg1, 32ypw9pk"
                  className="h-8 text-sm font-mono"
                />
              </div>
              <div className="flex items-center gap-4 col-span-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={!!editForm.is_low_ticket}
                    onChange={e => setEditForm(f => f ? { ...f, is_low_ticket: e.target.checked } : f)} />
                  is_low_ticket (IDs desconhecidos → este produto)
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={!!editForm.is_intensivo_marker}
                    onChange={e => setEditForm(f => f ? { ...f, is_intensivo_marker: e.target.checked } : f)} />
                  is_intensivo_marker (sentinela negativo)
                </label>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={saveForm} disabled={editSaving} className="gap-2">
                {editSaving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Salvando...</> : <><Save className="h-3.5 w-3.5" /> Salvar</>}
              </Button>
              <Button size="sm" variant="outline" onClick={cancelForm} className="gap-1.5">
                <X className="h-3.5 w-3.5" /> Cancelar
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Carregando...</span>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.length === 0 && (
              <div className="text-center py-8 text-sm text-muted-foreground">
                Nenhum produto canônico cadastrado.
              </div>
            )}
            {rows.length > 0 && (
              <div className="grid grid-cols-[auto_1fr_auto_1fr_auto_auto] gap-x-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-2 pb-1">
                <span>ID</span>
                <span>Nome</span>
                <span>Cat.</span>
                <span>goal_name</span>
                <span>Flags</span>
                <span />
              </div>
            )}
            {rows.map(row => (
              <div
                key={row.product_id}
                className="grid grid-cols-[auto_1fr_auto_1fr_auto_auto] gap-x-3 items-center rounded-lg px-2 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">{row.product_id}</span>
                <span className="text-sm font-medium truncate">{row.nome}</span>
                <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${categoriaBadge(row.categoria)}`}>
                  {row.categoria}
                </span>
                <span className="text-xs text-muted-foreground truncate">{row.goal_name ?? '—'}</span>
                <div className="flex gap-1 flex-wrap">
                  {row.is_low_ticket && (
                    <span className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 px-1.5 rounded">low-fallback</span>
                  )}
                  {row.is_intensivo_marker && (
                    <span className="text-[10px] bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300 px-1.5 rounded">sentinela</span>
                  )}
                  {row.intensivo_offer_codes && row.intensivo_offer_codes.length > 0 && (
                    <span className="text-[10px] bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 px-1.5 rounded" title={row.intensivo_offer_codes.join(', ')}>
                      offers:{row.intensivo_offer_codes.length}
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openEdit(row)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                    title="Editar"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => deleteRow(row)}
                    disabled={PROTECTED_IDS.has(row.product_id)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title={PROTECTED_IDS.has(row.product_id) ? 'Não pode ser removido' : 'Remover'}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {rows.length > 0 && (
              <p className="text-[11px] text-muted-foreground pt-1 px-2">
                "Buco Approve" (2016048) e "Low ticket" (6766383) são protegidos e não podem ser removidos.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Section: Mapeamento Campanha → Produto ────────────────────────────────────

function SecaoCampanhaProduto({ onToast }: { onToast: (type: Toast['type'], msg: string) => void }) {
  const [account, setAccount]   = useState<'conta1' | 'conta2'>('conta1')
  const [rows, setRows]         = useState<CampanhaRow[]>([])
  const [loading, setLoading]   = useState(false)
  const [saving, setSaving]     = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('campaign_produto_map')
      .select('id, account, prefixo, produto_ids, label')
      .eq('account', account)
      .order('id')
    if (error) {
      onToast('error', 'Erro ao carregar: ' + error.message)
    } else {
      setRows((data ?? []).map(r => ({
        id:          r.id,
        account:     r.account,
        prefixo:     r.prefixo,
        produto_ids: r.produto_ids ?? [],
        label:       r.label ?? '',
      })))
    }
    setLoading(false)
  }, [account, onToast])

  useEffect(() => { load() }, [load])

  function updateRow(index: number, patch: Partial<CampanhaRow>) {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, ...patch, _dirty: true } : r))
  }

  function addRow() { setRows(prev => [...prev, emptyCampanhaRow(account)]) }

  function removeRow(index: number) { setRows(prev => prev.filter((_, i) => i !== index)) }

  async function save() {
    const toSave = rows.filter(r => r._dirty)
    if (!toSave.length) return
    for (const r of toSave) {
      if (!r.prefixo.trim()) { onToast('error', 'Todos os prefixos precisam ser preenchidos.'); return }
      if (!r.label.trim())   { onToast('error', 'Todos os labels precisam ser preenchidos.'); return }
      if (!r.produto_ids.length) { onToast('error', 'Informe ao menos um ID de produto em cada linha.'); return }
    }
    setSaving(true)
    const upsertPayload = toSave.map(r => ({
      ...(r.id ? { id: r.id } : {}),
      account:     r.account,
      prefixo:     r.prefixo.toLowerCase().trim(),
      produto_ids: r.produto_ids,
      label:       r.label.trim(),
    }))
    const { error } = await supabase.from('campaign_produto_map').upsert(upsertPayload, { onConflict: 'id' })
    if (error) {
      onToast('error', 'Erro ao salvar: ' + error.message)
    } else {
      onToast('success', `${toSave.length} ${toSave.length === 1 ? 'linha salva' : 'linhas salvas'} com sucesso.`)
      await load()
    }
    setSaving(false)
  }

  async function deleteRow(row: CampanhaRow, index: number) {
    if (row._new) { removeRow(index); return }
    if (!row.id) return
    const { error } = await supabase.from('campaign_produto_map').delete().eq('id', row.id)
    if (error) { onToast('error', 'Erro ao excluir: ' + error.message); return }
    removeRow(index)
  }

  const hasDirty = rows.some(r => r._dirty)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Mapeamento Campanha → Produto</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Associe prefixos de nomes de campanha a IDs de produto (Hotmart) para calcular
          <strong className="text-foreground"> gasto por produto</strong> no Placar.
        </p>

        {/* Conta */}
        <div className="flex gap-2">
          <Button size="sm" variant={account === 'conta1' ? 'default' : 'outline'} onClick={() => setAccount('conta1')}>
            GBS Launch — Lançamentos
          </Button>
          <Button size="sm" variant={account === 'conta2' ? 'default' : 'outline'} onClick={() => setAccount('conta2')}>
            GBS — Pós-graduações
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Carregando...</span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Mapeamentos — {account === 'conta1' ? 'GBS Launch' : 'GBS Pós-graduações'}
              </p>
              <Button size="sm" variant="outline" onClick={addRow} className="gap-1.5 h-7 text-xs">
                <Plus className="h-3.5 w-3.5" /> Adicionar linha
              </Button>
            </div>

            {rows.length === 0 && (
              <div className="text-center py-10 text-sm text-muted-foreground">
                Nenhum mapeamento cadastrado para esta conta.
                <br />
                <button onClick={addRow} className="text-primary underline mt-1 hover:no-underline text-xs">
                  Adicionar o primeiro
                </button>
              </div>
            )}

            {rows.length > 0 && (
              <div className="grid grid-cols-[1fr_1fr_1.5fr_2fr_auto] gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-1">
                <span>Prefixo da campanha</span>
                <span>Label (legível)</span>
                <span>IDs do produto</span>
                <span>Conta</span>
                <span />
              </div>
            )}

            {rows.map((row, i) => (
              <div key={row.id ?? `new-${i}`} className={`grid grid-cols-[1fr_1fr_1.5fr_2fr_auto] gap-2 items-center rounded-lg p-2 transition-colors ${row._dirty ? 'bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800' : 'bg-muted/30'}`}>
                <Input value={row.prefixo} onChange={e => updateRow(i, { prefixo: e.target.value })} placeholder="ex: imers" className="h-8 text-sm font-mono" />
                <Input value={row.label} onChange={e => updateRow(i, { label: e.target.value })} placeholder="ex: Imersão Enare" className="h-8 text-sm" />
                <Input value={idsToString(row.produto_ids)} onChange={e => updateRow(i, { produto_ids: stringToIds(e.target.value) })} placeholder="ex: 12345, 67890" className="h-8 text-sm font-mono" />
                <span className="text-xs text-muted-foreground font-mono px-2 py-1 bg-muted rounded">{row.account}</span>
                <button onClick={() => deleteRow(row, i)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Remover">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}

            {rows.length > 0 && (
              <p className="text-[11px] text-muted-foreground pt-1 px-1">
                O <strong>prefixo</strong> é verificado com <code className="bg-muted px-0.5 rounded">includes</code> no nome da campanha (case-insensitive).
                Separe múltiplos IDs de produto por vírgula.
              </p>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <Button onClick={save} disabled={!hasDirty || saving} className="gap-2">
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</>
              : <><Save className="h-4 w-4" /> Salvar alterações</>
            }
          </Button>
          {hasDirty && !saving && (
            <span className="text-xs text-amber-600 dark:text-amber-400">Há alterações não salvas</span>
          )}
        </div>

        {/* Como achar o ID */}
        <div className="rounded-xl border border-border p-4 space-y-2 bg-muted/20">
          <p className="text-sm font-semibold">Como descobrir o ID do produto</p>
          <p className="text-sm text-muted-foreground">
            O <strong className="text-foreground">ID do Produto</strong> é o campo{' '}
            <code className="bg-muted px-1 rounded text-xs">ID_do_Produto</code> da tabela{' '}
            <code className="bg-muted px-1 rounded text-xs">Hotmart_Greenn_Unificada</code> no BigQuery.
          </p>
          <pre className="bg-muted rounded-lg p-3 text-xs font-mono overflow-x-auto leading-relaxed">
{`SELECT DISTINCT ID_do_Produto, Nome_do_Produto
FROM \`seu_projeto.seu_dataset.Hotmart_Greenn_Unificada\`
WHERE LOWER(Nome_do_Produto) LIKE '%enare%'
ORDER BY 1`}
          </pre>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function TabConfigProdutos() {
  const [toast, setToast] = useState<Toast | null>(null)

  function showToast(type: Toast['type'], msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }

  return (
    <div className="space-y-6 max-w-4xl">

      <div>
        <h2 className="text-lg font-bold mb-1">Configuração de Produtos</h2>
        <p className="text-sm text-muted-foreground">
          Gerencie os produtos canônicos (lidos pelo Placar) e os mapeamentos de campanha Meta → produto.
        </p>
      </div>

      <SecaoProdutosCanonicos onToast={showToast} />
      <SecaoCampanhaProduto onToast={showToast} />

      {/* Toast global */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
          toast.type === 'success'
            ? 'bg-green-50 text-green-800 border border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-800'
            : 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800'
        }`}>
          {toast.type === 'success'
            ? <CheckCircle2 className="h-4 w-4 shrink-0" />
            : <AlertCircle className="h-4 w-4 shrink-0" />
          }
          {toast.msg}
        </div>
      )}
    </div>
  )
}
