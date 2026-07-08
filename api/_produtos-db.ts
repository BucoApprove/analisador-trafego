/**
 * Produtos canônicos lidos do Supabase (tabela produtos_canonicos).
 * Cache em memória com TTL de 5 minutos — adequado para funções serverless Vercel.
 * Mantém a mesma interface pública de _produtos-canonicos.ts para compatibilidade.
 *
 * Substitui api/_produtos-canonicos.ts — não modifique aquele arquivo.
 */
import { createClient } from '@supabase/supabase-js'

export type Categoria = 'core' | 'porta' | 'low'

export interface ProdutoCanonico {
  nome: string
  categoria: Categoria
}

interface DbRow {
  product_id: number
  nome: string
  categoria: string
  goal_name: string | null
  intensivo_offer_codes: string[] | null
  is_low_ticket: boolean
  is_intensivo_marker: boolean
}

interface Cache {
  rows: DbRow[]
  ts: number
}

let _cache: Cache | null = null
// TTL curto: cada instância serverless mantém seu próprio cache em memória, e
// invalidateCache() só afeta a instância que processou o save — um TTL longo
// fazia edições em produtos_canonicos (ex: intensivo_offer_codes) demorarem
// minutos para refletir em instâncias que não receberam o save diretamente.
const CACHE_TTL_MS = 30 * 1000

function sb() {
  return createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
    { auth: { persistSession: false } },
  )
}

async function loadRows(): Promise<DbRow[]> {
  const now = Date.now()
  if (_cache && now - _cache.ts < CACHE_TTL_MS) return _cache.rows
  const { data, error } = await sb()
    .from('produtos_canonicos')
    .select('product_id,nome,categoria,goal_name,intensivo_offer_codes,is_low_ticket,is_intensivo_marker')
  if (error) throw new Error(`produtos_canonicos: ${error.message}`)
  _cache = { rows: (data ?? []) as DbRow[], ts: now }
  return _cache.rows
}

export async function classifyProduto(productId: number, offerCode?: string): Promise<ProdutoCanonico> {
  const rows = await loadRows()
  // Compara como número (bigint do Supabase pode vir como string em alguns drivers)
  const matchId = (r: DbRow) => Number(r.product_id) === productId
  // Sentinela negativo (Intensivo ENARE via campanha Meta)
  const marker = rows.find(r => r.is_intensivo_marker && matchId(r))
  if (marker) return { nome: marker.nome, categoria: marker.categoria as Categoria }
  // Produto específico pelo id
  const row = rows.find(r => matchId(r))
  if (row) {
    // Verifica se é oferta de Intensivo dentro do BucoApprove
    if (offerCode && row.intensivo_offer_codes?.includes(offerCode)) {
      const intensivo = rows.find(r => r.is_intensivo_marker)
      if (intensivo) return { nome: intensivo.nome, categoria: intensivo.categoria as Categoria }
    }
    return { nome: row.nome, categoria: row.categoria as Categoria }
  }
  // Qualquer id desconhecido → Low ticket
  const lowRow = rows.find(r => r.is_low_ticket)
  return lowRow ? { nome: lowRow.nome, categoria: lowRow.categoria as Categoria } : { nome: 'Low ticket', categoria: 'low' }
}

export async function getGoalNameByCanon(): Promise<Record<string, string>> {
  const rows = await loadRows()
  const map: Record<string, string> = {}
  for (const r of rows) {
    if (r.goal_name) map[r.nome] = r.goal_name
  }
  return map
}

export async function getProdutosSelecionaveis(): Promise<Array<{ label: string; id: number }>> {
  const rows = await loadRows()
  return rows
    .map(r => ({ label: r.nome, id: r.product_id }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export async function getBucoPid(): Promise<number> {
  const rows = await loadRows()
  // BucoApprove: produto com intensivo_offer_codes preenchido e não é o marcador
  const row = rows.find(r => r.intensivo_offer_codes && r.intensivo_offer_codes.length > 0 && !r.is_intensivo_marker)
  return row ? Number(row.product_id) : 2016048
}

export async function getIntensivoOffers(): Promise<Set<string>> {
  const rows = await loadRows()
  const row = rows.find(r => r.intensivo_offer_codes && r.intensivo_offer_codes.length > 0 && !r.is_intensivo_marker)
  return new Set(row?.intensivo_offer_codes ?? [])
}

/** Retorna mapa nome canônico → categoria. Usado pelo placar para promover
 *  produtos com gasto mas sem venda Hotmart à tabela principal. */
export async function getCategoriaByNome(): Promise<Record<string, Categoria>> {
  const rows = await loadRows()
  const map: Record<string, Categoria> = {}
  for (const r of rows) map[r.nome] = r.categoria as Categoria
  return map
}

/** Invalida o cache manualmente (chamado após save na tela de gestão). */
export function invalidateCache() { _cache = null }
