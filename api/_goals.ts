/**
 * Helpers compartilhados para ler as metas mensais do Supabase.
 *
 * Tabela `monthly_goals`: (month, product_name) → meta (R$).
 * month no formato "YYYY-MM".
 *
 * Substitui a antiga leitura da planilha Google Sheets publicada.
 */
import { createClient } from '@supabase/supabase-js'

// Produtos fixos na ordem de exibição.
export const PRODUTOS_FIXOS = [
  'Buco Approve',
  'Renovação BA',
  'Mentoria',
  'Planejamento',
  'Pós Pato',
  'Pós Anato',
  'Low tickets',
  'Outros',
]

export interface MonthlyGoals {
  goals: Record<string, number>
  totalMeta: number
  configured: boolean
}

function serviceClient() {
  return createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
    { auth: { persistSession: false } },
  )
}

/**
 * Busca as metas de um mês e retorna { produto → meta } restrito a PRODUTOS_FIXOS.
 * `configured` = true se houver ao menos uma linha cadastrada para o mês.
 */
export async function fetchMonthlyGoals(month: string): Promise<MonthlyGoals> {
  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('monthly_goals')
    .select('product_name, meta')
    .eq('month', month)

  if (error) throw new Error(`monthly_goals query failed: ${error.message}`)

  const rows = data ?? []
  const byProduct = new Map<string, number>()
  for (const r of rows) byProduct.set(r.product_name, Number(r.meta) || 0)

  const goals: Record<string, number> = {}
  let totalMeta = 0
  for (const name of PRODUTOS_FIXOS) {
    goals[name] = byProduct.get(name) ?? 0
    totalMeta += goals[name]
  }

  return { goals, totalMeta, configured: rows.length > 0 }
}

/**
 * Lê TODAS as metas de um mês (sem filtrar por PRODUTOS_FIXOS).
 * Usado pelo Placar, cujos nomes canônicos diferem dos produtos fixos antigos.
 * Retorna um mapa product_name → meta.
 */
export async function fetchAllGoals(month: string): Promise<Map<string, number>> {
  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('monthly_goals')
    .select('product_name, meta')
    .eq('month', month)

  if (error) throw new Error(`monthly_goals query failed: ${error.message}`)

  const map = new Map<string, number>()
  for (const r of data ?? []) map.set(r.product_name, Number(r.meta) || 0)
  return map
}

/**
 * Lê os overrides manuais de agrupamento (tabela product_mappings):
 * nome exato do produto Hotmart → produto-meta. Vale para todos os meses.
 */
export async function fetchProductMappings(): Promise<Record<string, string>> {
  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('product_mappings')
    .select('hotmart_name, product_name')

  if (error) throw new Error(`product_mappings query failed: ${error.message}`)

  const map: Record<string, string> = {}
  for (const r of data ?? []) map[r.hotmart_name] = r.product_name
  return map
}
