import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(url, key)

export type UserRole = 'admin' | 'analyst'

export interface Profile {
  id: string
  name: string
  role: UserRole
}

export interface Activity {
  id: string
  product_name: string
  title: string
  description: string
  status: 'pendente' | 'em andamento' | 'concluída'
  created_at: string
}

export interface ActivityLink {
  id: string
  activity_id: string
  label: string
  url: string
  type: 'drive' | 'sheet' | 'link'
}

export interface ActivityComment {
  id: string
  activity_id: string
  author: string
  text: string
  created_at: string
}

export interface MonthlyGoal {
  month: string
  product_name: string
  meta: number
  updated_at: string
}

export interface ProductMapping {
  hotmart_name: string
  product_name: string
  updated_at: string
}

export interface Lancamento {
  id: string
  nome: string
  prefixo: string
  spend_filter: string
  or_filter: string
  data_inicio: string | null
  captura_inicio: string | null
  captura_fim: string | null
  carrinho_inicio: string | null
  carrinho_fim: string | null
  ordem: number
  produto_venda: string
  survey_sheet_id: string
  meta_leads_trafico: number
  meta_leads_organico: number
  meta_leads_manychat: number
  orcamento_total: number
  orcamento_captura: number
  orcamento_descoberta: number
  orcamento_aquecimento: number
  orcamento_lembrete: number
  orcamento_remarketing: number
  tipo: 'interno' | 'pago'
  produto_ingresso_id: number | null
  produto_principal_id: number | null
  produto_downsell_id: number | null
  meta_vendas_ingresso: number
  meta_vendas_principal: number
  meta_vendas_downsell: number
  created_at: string
}
