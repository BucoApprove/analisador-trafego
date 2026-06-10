/**
 * Seed único: importa as metas mensais da antiga planilha Google Sheets
 * para a tabela `monthly_goals` no Supabase.
 *
 * Roda uma vez para preservar o histórico (FEV→JUNHO/2026). Depois disso a
 * planilha é aposentada e as metas são editadas pela UI do dashboard.
 *
 * Uso:
 *   node ./node_modules/tsx/dist/cli.mjs supabase/seed-monthly-goals.mjs
 * (precisa de SUPABASE_URL e SUPABASE_SERVICE_KEY no .env.local)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// Carrega .env.local manualmente (sem dependência extra).
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] ??= m[2].trim()
}

const SHEET_ID = '2PACX-1vRPO_lWvVNkOao5LF3BYLTUFeJqBOdDC9zx2sXgWR37R2MPKK3oGGfc8X63EDCVJz6JN-HqN6JIuSO2'

// month "YYYY-MM" → gid da aba (confirmado por pareamento posicional pubhtml + XLSX).
const MONTH_GIDS = {
  '2026-02': '0',           // FEV
  '2026-03': '1098579597',  // MARÇO
  '2026-04': '287243977',   // ABRIL
  '2026-05': '1049395397',  // MAIO
  '2026-06': '1694235169',  // JUNHO
}

const PRODUTOS_FIXOS = [
  'Buco Approve',
  'Renovação BA',
  'Mentoria',
  'Planejamento',
  'Pós Pato',
  'Pós Anato',
  'Low tickets',
  'Outros',
]

function parseBRL(val) {
  if (!val) return 0
  return parseFloat(val.replace(/R\$\s*/g, '').replace(/\./g, '').replace(',', '.').trim()) || 0
}

function parseCSV(text) {
  const rows = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const cols = []
    let current = ''
    let inQuotes = false
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes
      else if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = '' }
      else current += ch
    }
    cols.push(current.trim())
    rows.push(cols)
  }
  return rows
}

async function fetchGoals(gid) {
  const url = `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}/pub?output=csv&gid=${gid}`
  const text = await (await fetch(url)).text()
  const rows = parseCSV(text)
  const map = new Map()
  let headerFound = false
  for (const row of rows) {
    const first = row[0]?.trim().toUpperCase()
    if (!headerFound) { if (first === 'PRODUTO') headerFound = true; continue }
    if (!first || first === 'TOTAL') continue
    const prod = row[0]?.trim()
    if (prod) map.set(prod, parseBRL(row[1] ?? ''))
  }
  return map
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const upserts = []
for (const [month, gid] of Object.entries(MONTH_GIDS)) {
  const map = await fetchGoals(gid)
  for (const product of PRODUTOS_FIXOS) {
    const meta = map.get(product) ?? 0
    upserts.push({ month, product_name: product, meta })
  }
  const total = PRODUTOS_FIXOS.reduce((s, p) => s + (map.get(p) ?? 0), 0)
  console.log(`${month} (gid ${gid}): ${PRODUTOS_FIXOS.filter(p => map.get(p)).length} metas, total R$ ${total.toLocaleString('pt-BR')}`)
}

const { error } = await supabase.from('monthly_goals').upsert(upserts)
if (error) { console.error('Erro no upsert:', error.message); process.exit(1) }
console.log(`\n✅ ${upserts.length} linhas inseridas/atualizadas em monthly_goals.`)
