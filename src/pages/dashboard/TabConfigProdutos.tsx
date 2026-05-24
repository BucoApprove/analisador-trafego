import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Plus, Trash2, Save, AlertCircle, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProdutoRow {
  id?: number
  account: 'conta1' | 'conta2'
  prefixo: string
  produto_ids: number[]
  label: string
  _dirty?: boolean
  _new?: boolean
}

type Toast = { type: 'success' | 'error'; msg: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyRow(account: 'conta1' | 'conta2'): ProdutoRow {
  return { account, prefixo: '', produto_ids: [], label: '', _dirty: true, _new: true }
}

function idsToString(ids: number[]): string {
  return ids.join(', ')
}

function stringToIds(s: string): number[] {
  return s
    .split(/[\s,;]+/)
    .map(v => parseInt(v.trim(), 10))
    .filter(n => !isNaN(n) && n > 0)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TabConfigProdutos() {
  const [account, setAccount]   = useState<'conta1' | 'conta2'>('conta1')
  const [rows, setRows]         = useState<ProdutoRow[]>([])
  const [loading, setLoading]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [toast, setToast]       = useState<Toast | null>(null)

  function showToast(type: Toast['type'], msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('campaign_produto_map')
      .select('id, account, prefixo, produto_ids, label')
      .eq('account', account)
      .order('id')
    if (error) {
      showToast('error', 'Erro ao carregar: ' + error.message)
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
  }, [account])

  useEffect(() => { load() }, [load])

  function updateRow(index: number, patch: Partial<ProdutoRow>) {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, ...patch, _dirty: true } : r))
  }

  function addRow() {
    setRows(prev => [...prev, emptyRow(account)])
  }

  function removeRow(index: number) {
    setRows(prev => prev.filter((_, i) => i !== index))
  }

  async function save() {
    const toSave = rows.filter(r => r._dirty)
    if (!toSave.length) return

    // Validate
    for (const r of toSave) {
      if (!r.prefixo.trim()) { showToast('error', 'Todos os prefixos precisam ser preenchidos.'); return }
      if (!r.label.trim())   { showToast('error', 'Todos os labels precisam ser preenchidos.'); return }
      if (!r.produto_ids.length) { showToast('error', 'Informe ao menos um ID de produto em cada linha.'); return }
    }

    setSaving(true)

    const upsertPayload = toSave.map(r => ({
      ...(r.id ? { id: r.id } : {}),
      account:     r.account,
      prefixo:     r.prefixo.toLowerCase().trim(),
      produto_ids: r.produto_ids,
      label:       r.label.trim(),
    }))

    const { error } = await supabase
      .from('campaign_produto_map')
      .upsert(upsertPayload, { onConflict: 'id' })

    if (error) {
      showToast('error', 'Erro ao salvar: ' + error.message)
    } else {
      showToast('success', `${toSave.length} ${toSave.length === 1 ? 'linha salva' : 'linhas salvas'} com sucesso.`)
      await load()
    }

    setSaving(false)
  }

  async function deleteRow(row: ProdutoRow, index: number) {
    if (row._new) { removeRow(index); return }
    if (!row.id) return
    const { error } = await supabase
      .from('campaign_produto_map')
      .delete()
      .eq('id', row.id)
    if (error) { showToast('error', 'Erro ao excluir: ' + error.message); return }
    removeRow(index)
  }

  const hasDirty = rows.some(r => r._dirty)

  return (
    <div className="space-y-6 max-w-3xl">

      <div>
        <h2 className="text-lg font-bold mb-1">Configuração de Produtos por Campanha</h2>
        <p className="text-sm text-muted-foreground">
          Associe prefixos de nomes de campanha a IDs de produto (Hotmart/Greenn) para calcular
          <strong className="text-foreground"> vendas_totais_periodo</strong> em campanhas de venda direta.
        </p>
      </div>

      {/* ── Conta ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Conta</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button size="sm" variant={account === 'conta1' ? 'default' : 'outline'} onClick={() => setAccount('conta1')}>
            GBS Launch — Lançamentos
          </Button>
          <Button size="sm" variant={account === 'conta2' ? 'default' : 'outline'} onClick={() => setAccount('conta2')}>
            GBS — Pós-graduações
          </Button>
        </CardContent>
      </Card>

      {/* ── Tabela ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center justify-between">
            Mapeamentos — {account === 'conta1' ? 'GBS Launch' : 'GBS Pós-graduações'}
            <Button size="sm" variant="outline" onClick={addRow} className="gap-1.5 h-7 text-xs">
              <Plus className="h-3.5 w-3.5" /> Adicionar linha
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Carregando...</span>
            </div>
          ) : (
            <div className="space-y-3">

              {/* Header */}
              {rows.length > 0 && (
                <div className="grid grid-cols-[1fr_1fr_1.5fr_2fr_auto] gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-1">
                  <span>Prefixo da campanha</span>
                  <span>Label (legível)</span>
                  <span>IDs do produto</span>
                  <span className="col-span-1">Conta</span>
                  <span />
                </div>
              )}

              {rows.length === 0 && (
                <div className="text-center py-10 text-sm text-muted-foreground">
                  Nenhum mapeamento cadastrado para esta conta.
                  <br />
                  <button onClick={addRow} className="text-primary underline mt-1 hover:no-underline text-xs">
                    Adicionar o primeiro
                  </button>
                </div>
              )}

              {rows.map((row, i) => (
                <div key={row.id ?? `new-${i}`} className={`grid grid-cols-[1fr_1fr_1.5fr_2fr_auto] gap-2 items-center rounded-lg p-2 transition-colors ${row._dirty ? 'bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800' : 'bg-muted/30'}`}>

                  {/* Prefixo */}
                  <div className="space-y-0.5">
                    <Input
                      value={row.prefixo}
                      onChange={e => updateRow(i, { prefixo: e.target.value })}
                      placeholder="ex: imers"
                      className="h-8 text-sm font-mono"
                    />
                  </div>

                  {/* Label */}
                  <div>
                    <Input
                      value={row.label}
                      onChange={e => updateRow(i, { label: e.target.value })}
                      placeholder="ex: Imersão Enare"
                      className="h-8 text-sm"
                    />
                  </div>

                  {/* IDs */}
                  <div>
                    <Input
                      value={idsToString(row.produto_ids)}
                      onChange={e => updateRow(i, { produto_ids: stringToIds(e.target.value) })}
                      placeholder="ex: 12345, 67890"
                      className="h-8 text-sm font-mono"
                    />
                  </div>

                  {/* Conta (read-only badge) */}
                  <div>
                    <span className="text-xs text-muted-foreground font-mono px-2 py-1 bg-muted rounded">
                      {row.account}
                    </span>
                  </div>

                  {/* Delete */}
                  <button
                    onClick={() => deleteRow(row, i)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Remover"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}

              {/* Legend */}
              {rows.length > 0 && (
                <p className="text-[11px] text-muted-foreground pt-1 px-1">
                  O <strong>prefixo</strong> é verificado com <code className="bg-muted px-0.5 rounded">includes</code> no nome da campanha (case-insensitive).
                  Separe múltiplos IDs de produto por vírgula.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Ajuda: como achar o ID do produto ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Como descobrir o ID do produto</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>O <strong className="text-foreground">ID do Produto</strong> é o campo <code className="bg-muted px-1 rounded text-xs">ID_do_Produto</code> da tabela <code className="bg-muted px-1 rounded text-xs">Hotmart_Greenn_Unificada</code> no BigQuery.</p>
          <p>Para encontrar, rode esta query no BigQuery:</p>
          <pre className="bg-muted rounded-lg p-3 text-xs font-mono overflow-x-auto leading-relaxed">
{`SELECT DISTINCT ID_do_Produto, Nome_do_Produto
FROM \`seu_projeto.seu_dataset.Hotmart_Greenn_Unificada\`
WHERE LOWER(Nome_do_Produto) LIKE '%enare%'
ORDER BY 1`}
          </pre>
          <p>Substitua <code className="bg-muted px-1 rounded text-xs">%enare%</code> pelo nome (parcial) do produto que procura.</p>
        </CardContent>
      </Card>

      {/* ── Ações ── */}
      <div className="flex items-center gap-3">
        <Button
          onClick={save}
          disabled={!hasDirty || saving}
          className="gap-2"
        >
          {saving
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</>
            : <><Save className="h-4 w-4" /> Salvar alterações</>
          }
        </Button>

        {hasDirty && !saving && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            Há alterações não salvas
          </span>
        )}
      </div>

      {/* ── Toast ── */}
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
