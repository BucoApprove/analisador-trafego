/**
 * BigQuery REST API helper — no heavy SDK dependency.
 * Authenticates via service account JWT and runs Standard SQL queries.
 *
 * Required env vars (Vercel):
 *   BQ_CREDENTIALS  — full JSON content of the service account key file
 *   BQ_DATASET      — BigQuery dataset name (e.g. "bianco")
 *
 * Optional env vars:
 *   BQ_TABLE_LEADS  — leads table name  (default: "TAGS-E-UTMS")
 *   BQ_TABLE_VENDAS — sales table name  (default: "VENDAS-BA")
 *   BQ_LOCATION     — dataset location  (default: "US")
 *   BQ_CREDENTIALS_FILE — local path to JSON key for local dev
 */

import { createSign } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServiceAccount {
  project_id: string
  client_email: string
  private_key: string
}

export interface QueryParam {
  name: string
  value: string | number | null
  type?: 'STRING' | 'INT64' | 'FLOAT64' | 'DATE' | 'BOOL'
}

export type BQRow = Record<string, string | null>

// ─── Module-level caches (reused across warm invocations) ─────────────────────

let _cachedCreds: ServiceAccount | null = null
let _cachedToken: { token: string; expiry: number } | null = null

// ─── Credentials ──────────────────────────────────────────────────────────────

function getCredentials(): ServiceAccount {
  if (_cachedCreds) return _cachedCreds

  let json = process.env.BQ_CREDENTIALS

  if (!json) {
    // Local dev fallback: read from the JSON key file in the project root
    const filePath =
      process.env.BQ_CREDENTIALS_FILE ??
      join(process.cwd(), 'effective-might-466701-r5-d79d7f677293.json')
    if (existsSync(filePath)) {
      json = readFileSync(filePath, 'utf8')
    }
  }

  if (!json) {
    throw new Error(
      'BigQuery credentials not found. Set BQ_CREDENTIALS env var to the contents of the service account JSON.',
    )
  }

  _cachedCreds = JSON.parse(json) as ServiceAccount
  return _cachedCreds
}

// ─── OAuth2 access token (JWT Bearer) ────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (_cachedToken && _cachedToken.expiry > now + 60) return _cachedToken.token

  const creds = getCredentials()

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const claimset = Buffer.from(
    JSON.stringify({
      iss: creds.client_email,
      scope: 'https://www.googleapis.com/auth/bigquery.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    }),
  ).toString('base64url')

  const toSign = `${header}.${claimset}`
  const signer = createSign('RSA-SHA256')
  signer.update(toSign)
  const sig = signer.sign(creds.private_key, 'base64url')
  const jwt = `${toSign}.${sig}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!res.ok) throw new Error(`BigQuery OAuth error: ${await res.text()}`)

  const tokenData = (await res.json()) as { access_token: string; expires_in: number }
  _cachedToken = { token: tokenData.access_token, expiry: now + tokenData.expires_in }
  return _cachedToken.token
}

// ─── Pagination helper ────────────────────────────────────────────────────────

async function fetchRemainingPages(
  projectId: string,
  jobId: string,
  token: string,
  fields: string[],
  initialRows: BQRow[],
  pageToken: string | undefined,
): Promise<BQRow[]> {
  const rows = [...initialRows]
  let pt = pageToken
  const location = process.env.BQ_LOCATION ?? 'US'

  while (pt) {
    const url = new URL(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}`,
    )
    url.searchParams.set('pageToken', pt)
    url.searchParams.set('maxResults', '10000')
    url.searchParams.set('location', location)

    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) break

    const page = (await res.json()) as {
      rows?: { f: { v: string | null }[] }[]
      pageToken?: string
    }
    ;(page.rows ?? []).forEach((row) => {
      const obj: BQRow = {}
      row.f.forEach((cell, i) => {
        obj[fields[i]] = cell.v
      })
      rows.push(obj)
    })
    pt = page.pageToken
  }

  return rows
}

// ─── Main query function ──────────────────────────────────────────────────────

export async function bqQuery(
  sql: string,
  params: QueryParam[] = [],
): Promise<{ rows: BQRow[]; totalRows: number }> {
  const creds = getCredentials()
  const token = await getAccessToken()

  const body = {
    query: sql,
    useLegacySql: false,
    location: process.env.BQ_LOCATION ?? 'US',
    timeoutMs: 55000,
    maxResults: 10000,
    queryParameters: params.map((p) => ({
      name: p.name,
      parameterType: {
        type: p.type ?? (typeof p.value === 'number' ? 'INT64' : 'STRING'),
      },
      parameterValue: { value: p.value === null ? null : String(p.value) },
    })),
  }

  const res = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${creds.project_id}/queries`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  )

  if (!res.ok) throw new Error(`BigQuery query failed (${res.status}): ${await res.text()}`)

  const result = (await res.json()) as {
    schema?: { fields: { name: string }[] }
    rows?: { f: { v: string | null }[] }[]
    totalRows?: string
    jobComplete?: boolean
    pageToken?: string
    jobReference?: { jobId: string }
  }

  if (!result.jobComplete) throw new Error('BigQuery query timed out (jobComplete=false)')

  const fields = result.schema?.fields?.map((f) => f.name) ?? []
  const firstRows: BQRow[] = (result.rows ?? []).map((row) => {
    const obj: BQRow = {}
    row.f.forEach((cell, i) => {
      obj[fields[i]] = cell.v
    })
    return obj
  })

  const allRows =
    result.pageToken && result.jobReference
      ? await fetchRemainingPages(
          creds.project_id,
          result.jobReference.jobId,
          token,
          fields,
          firstRows,
          result.pageToken,
        )
      : firstRows

  return { rows: allRows, totalRows: parseInt(result.totalRows ?? '0') }
}

// ─── Table reference helpers ──────────────────────────────────────────────────

export function tableLeads(): string {
  const { project_id } = getCredentials()
  const dataset = process.env.BQ_DATASET ?? ''
  const table = process.env.BQ_TABLE_LEADS ?? 'TAGS-E-UTMS'
  return `\`${project_id}.${dataset}.${table}\``
}

export function tableVendas(): string {
  const { project_id } = getCredentials()
  const dataset = process.env.BQ_DATASET ?? ''
  const table = process.env.BQ_TABLE_VENDAS ?? 'VENDAS-BA'
  return `\`${project_id}.${dataset}.${table}\``
}
