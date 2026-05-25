/**
 * POST /api/admin-fix-utm
 * Endpoint temporário — executa UPDATEs no BQ para corrigir utm_campaign.
 * Apagar este arquivo após uso.
 * Requer: Authorization: Bearer <DASHBOARD_TOKEN_ADMIN>
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createSign } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const FIXES = [
  { from: 'Leads - Rota Enare Intensivo - A - 16/05/26', to: 'PPTBA_Vendas_RTE_Intensivo_A_1605' },
  { from: 'Leads - Rota Enare Intensivo - B - 16/05/26', to: 'PPTBA_Vendas_RTE_Intensivo_B_1605' },
  { from: 'Leads - Rota Enare Intensivo - C - 16/05/26', to: 'PPTBA_Vendas_RTE_Intensivo_C_1605' },
]

function getCredentials() {
  let json = process.env.BQ_CREDENTIALS
  if (!json) {
    const p = join(process.cwd(), 'effective-might-466701-r5-d79d7f677293.json')
    if (existsSync(p)) json = readFileSync(p, 'utf8')
  }
  if (!json) throw new Error('BQ_CREDENTIALS não configurado')
  return JSON.parse(json) as { project_id: string; client_email: string; private_key: string }
}

async function getToken(creds: ReturnType<typeof getCredentials>): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header   = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const claimset = Buffer.from(JSON.stringify({
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/bigquery',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  })).toString('base64url')
  const toSign = `${header}.${claimset}`
  const signer = createSign('RSA-SHA256')
  signer.update(toSign)
  const jwt = `${toSign}.${signer.sign(creds.private_key, 'base64url')}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const data = await res.json() as { access_token: string }
  return data.access_token
}

async function runDml(sql: string, projectId: string, token: string): Promise<number> {
  // Insere job
  const jobRes = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/jobs`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configuration: {
          query: { query: sql, useLegacySql: false, location: process.env.BQ_LOCATION ?? 'US' },
        },
      }),
    },
  )
  if (!jobRes.ok) throw new Error(`Job insert failed: ${await jobRes.text()}`)
  const job = await jobRes.json() as { jobReference: { jobId: string }; status?: { errorResult?: { message: string } } }
  const jobId = job.jobReference.jobId

  // Polling até completar (max 50s)
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const pollRes = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/jobs/${jobId}?location=${process.env.BQ_LOCATION ?? 'US'}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const poll = await pollRes.json() as {
      status: { state: string; errorResult?: { message: string } }
      statistics?: { query?: { numDmlAffectedRows?: string } }
    }
    if (poll.status.state === 'DONE') {
      if (poll.status.errorResult) throw new Error(poll.status.errorResult.message)
      return parseInt(poll.statistics?.query?.numDmlAffectedRows ?? '0')
    }
  }
  throw new Error('Job timeout após 50s')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '').trim()
  if (!token || token !== (process.env.DASHBOARD_TOKEN_ADMIN ?? '')) {
    return res.status(401).json({ error: 'Não autorizado.' })
  }

  try {
    const creds    = getCredentials()
    const bqToken  = await getToken(creds)
    const dataset  = process.env.BQ_DATASET ?? 'Hotmart'
    const project  = creds.project_id
    const table    = `\`${project}.${dataset}.Green_Gold\``

    const results = []
    for (const fix of FIXES) {
      const sql = `UPDATE ${table} SET utm_campaign = '${fix.to}' WHERE utm_campaign = '${fix.from}'`
      try {
        const affected = await runDml(sql, project, bqToken)
        results.push({ from: fix.from, to: fix.to, affected, ok: true })
      } catch (e: any) {
        results.push({ from: fix.from, to: fix.to, affected: 0, ok: false, error: e.message })
      }
    }

    return res.json({ ok: true, results })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
