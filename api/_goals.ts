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
