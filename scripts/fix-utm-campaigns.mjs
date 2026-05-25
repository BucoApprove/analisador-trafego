/**
 * Corrige utm_campaign gravados com nomes errados na tabela Green_Gold.
 * Roda com: node scripts/fix-utm-campaigns.mjs
 *
 * Requer BQ_CREDENTIALS ou o arquivo de service account na raiz do projeto.
 */

import { createSign } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ─── Credenciais ──────────────────────────────────────────────────────────────

function getCredentials() {
  let json = process.env.BQ_CREDENTIALS
  if (!json) {
    const filePath = join(ROOT, 'effective-might-466701-r5-d79d7f677293.json')
    if (existsSync(filePath)) json = readFileSync(filePath, 'utf8')
  }
  if (!json) throw new Error('Credenciais BQ não encontradas.')
  return JSON.parse(json)
}

async function getAccessToken(creds) {
  const now = Math.floor(Date.now() / 1000)
  const header   = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const claimset = Buffer.from(JSON.stringify({
    iss:   creds.client_email,
    scope: 'https://www.googleapis.com/auth/bigquery',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now,
  })).toString('base64url')

  const toSign = `${header}.${claimset}`
  const signer = createSign('RSA-SHA256')
  signer.update(toSign)
  const sig = signer.sign(creds.private_key, 'base64url')
  const jwt = `${toSign}.${sig}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  if (!res.ok) throw new Error(`OAuth error: ${await res.text()}`)
  const data = await res.json()
  return data.access_token
}

async function bqQuery(sql, projectId, token) {
  const res = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, useLegacySql: false, location: 'US', timeoutMs: 60000 }),
    }
  )
  const json = await res.json()
  if (!res.ok || json.status?.errors) {
    throw new Error(JSON.stringify(json.status?.errors ?? json, null, 2))
  }
  return json
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const DATASET = process.env.BQ_DATASET ?? 'Hotmart'
const TABLE   = `Green_Gold`

const FIXES = [
  { from: 'Leads - Rota Enare Intensivo - A - 16/05/26', to: 'PPTBA_Vendas_RTE_Intensivo_A_1605' },
  { from: 'Leads - Rota Enare Intensivo - B - 16/05/26', to: 'PPTBA_Vendas_RTE_Intensivo_B_1605' },
  { from: 'Leads - Rota Enare Intensivo - C - 16/05/26', to: 'PPTBA_Vendas_RTE_Intensivo_C_1605' },
]

const creds = getCredentials()
const token = await getAccessToken(creds)
const proj  = creds.project_id

console.log(`Projeto: ${proj} | Dataset: ${DATASET} | Tabela: ${TABLE}\n`)

// Primeiro: verifica quantos registros serão afetados
const checkSql = `
  SELECT utm_campaign, COUNT(*) AS cnt
  FROM \`${proj}.${DATASET}.${TABLE}\`
  WHERE utm_campaign IN (${FIXES.map(f => `'${f.from}'`).join(', ')})
  GROUP BY 1
`
console.log('Verificando registros afetados...')
const checkResult = await bqQuery(checkSql, proj, token)
const rows = checkResult.rows ?? []

if (rows.length === 0) {
  console.log('Nenhum registro encontrado com os utm_campaign informados. Verifique os valores.')
  process.exit(0)
}

console.log('Registros encontrados:')
for (const row of rows) {
  console.log(`  "${row.f[0].v}" → ${row.f[1].v} registros`)
}
console.log()

// Executa os UPDATEs
for (const fix of FIXES) {
  const sql = `
    UPDATE \`${proj}.${DATASET}.${TABLE}\`
    SET utm_campaign = '${fix.to}'
    WHERE utm_campaign = '${fix.from}'
  `
  process.stdout.write(`Atualizando "${fix.from}" → "${fix.to}"... `)
  const result = await bqQuery(sql, proj, token)
  const affected = result.numDmlAffectedRows ?? result.statistics?.numDmlAffectedRows ?? '?'
  console.log(`✓ ${affected} linha(s) atualizadas`)
}

console.log('\nConcluído.')
