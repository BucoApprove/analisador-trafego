/**
 * Seed único: migra os UUIDs de tag da Clint (antes hardcoded em api/_clint.ts,
 * referência de junho/2026 do clint_leads.py) para a tabela clint_tags.
 *
 * Uso: node ./node_modules/tsx/dist/cli.mjs supabase/seed-clint-tags.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].trim()
}

const TAGS = {
  'Buco Approve':           ['2749bbb9-d335-4077-a940-abfff6050264', '20ad2a94-14f2-4938-a13d-61e95fe4a31b'],
  'Intensivo ENARE':        ['95818d14-845a-4bea-9c53-f14bbb8f1dde', '447ceac5-f682-41fb-9691-77b59f35cbb6'],
  'Imersão ENARE':          ['97e5af6d-0d5d-4adf-a624-896333266cd6', 'b6c68687-3812-46f5-85d4-b862778a3df9'],
  'Mentoria CTBMF':         ['17f9aec7-0381-4b61-918d-c616ee387906'],
  'Pós Patologia':          ['7a7f2e78-eca6-4d03-bf78-9b517c4b9b60', 'a54d86f4-4d3f-4679-9491-784e51161cd4'],
  'Pós Anatomia':           ['211baf47-a20f-4497-a440-3fa7e4ecd4fb'],
  'Planejamento ImpulsoR+': ['3e6a901f-f27e-4902-bdc9-a8de113ae4c9'],
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const rows = []
for (const [product_name, tags] of Object.entries(TAGS)) {
  for (const tag_id of tags) rows.push({ product_name, tag_id, label: '' })
}

const { error } = await sb.from('clint_tags').upsert(rows, { onConflict: 'product_name,tag_id' })
console.log(error ? `ERRO: ${error.message}` : `✅ ${rows.length} tags inseridas em clint_tags`)
