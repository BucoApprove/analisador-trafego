/**
 * Seed único: funde "BucoApp" (product_id 2286372) em "Renovação de acesso"
 * — são o mesmo produto vendido sob nomes diferentes. Mantém o product_id
 * original (2286372) intacto, só renomeia a linha em produtos_canonicos para
 * "Renovação de acesso", igualando categoria/goal_name à linha 3510472 já
 * existente — assim o Placar passa a somar as vendas dos dois product_id numa
 * única linha "Renovação de acesso".
 *
 * Uso: node ./node_modules/tsx/dist/cli.mjs supabase/merge-bucoapp-renovacao.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].trim()
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const { data: rows, error: readErr } = await sb
  .from('produtos_canonicos')
  .select('*')
  .in('product_id', [2286372, 3510472])

if (readErr) { console.error(`ERRO ao ler: ${readErr.message}`); process.exit(1) }

const bucoApp = rows.find(r => r.product_id === 2286372)
const renovacao = rows.find(r => r.product_id === 3510472)

console.log('Antes:')
console.log('  BucoApp (2286372):', bucoApp)
console.log('  Renovação de acesso (3510472):', renovacao)

if (!bucoApp) { console.error('ERRO: product_id 2286372 (BucoApp) não encontrado em produtos_canonicos.'); process.exit(1) }
if (!renovacao) { console.error('ERRO: product_id 3510472 (Renovação de acesso) não encontrado em produtos_canonicos.'); process.exit(1) }

const { error: updErr } = await sb
  .from('produtos_canonicos')
  .update({
    nome: renovacao.nome,
    categoria: renovacao.categoria,
    goal_name: renovacao.goal_name,
  })
  .eq('product_id', 2286372)

if (updErr) { console.error(`ERRO ao atualizar: ${updErr.message}`); process.exit(1) }

console.log(`\n✅ product_id 2286372 renomeado para "${renovacao.nome}" (categoria=${renovacao.categoria}, goal_name=${renovacao.goal_name ?? 'null'})`)
console.log('   Vendas do BucoApp (2286372) e Renovação de acesso (3510472) agora somam na mesma linha do Placar.')
