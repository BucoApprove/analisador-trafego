import type { VercelRequest, VercelResponse } from '@vercel/node'

const GHL_BASE = 'https://services.leadconnectorhq.com'

interface LeadBody {
  name?: string
  firstName?: string
  lastName?: string
  email: string
  phone?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
  tags?: string[]
}

async function upsertContact(locationId: string, apiToken: string, body: LeadBody) {
  const nameParts = (body.name ?? '').trim().split(/\s+/)
  const firstName = body.firstName ?? nameParts[0] ?? ''
  const lastName = body.lastName ?? nameParts.slice(1).join(' ') ?? ''

  const tags: string[] = [...(body.tags ?? [])]
  if (body.utmSource) tags.push(`utm_source:${body.utmSource}`)
  if (body.utmMedium) tags.push(`utm_medium:${body.utmMedium}`)
  if (body.utmCampaign) tags.push(`utm_campaign:${body.utmCampaign}`)

  const payload = {
    locationId,
    firstName,
    lastName,
    email: body.email,
    phone: body.phone,
    tags,
    source: body.utmSource ?? 'landing-page',
  }

  // Tenta criar
  const createRes = await fetch(`${GHL_BASE}/contacts/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (createRes.ok) {
    const created = await createRes.json() as { contact: { id: string } }
    return { id: created.contact?.id, action: 'created' }
  }

  // Se duplicata (400), extrai o ID e atualiza
  if (createRes.status === 400) {
    const errData = await createRes.json() as { meta?: { contactId?: string } }
    const contactId = errData.meta?.contactId
    if (!contactId) throw new Error('Duplicata sem contactId')

    // Busca tags existentes
    const getRes = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
      headers: { Authorization: `Bearer ${apiToken}`, Version: '2021-07-28' },
    })
    const existing = await getRes.json() as { contact: { tags: string[] } }
    const existingTags = existing.contact?.tags ?? []

    // Merge sem duplicatas
    const mergedTags = [...new Set([...existingTags, ...tags])]

    await fetch(`${GHL_BASE}/contacts/${contactId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tags: mergedTags }),
    })

    return { id: contactId, action: 'updated' }
  }

  throw new Error(`GHL error: ${createRes.status}`)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const locationId = process.env.FULLFUNNEL_LOCATION_ID ?? ''
  const apiToken = process.env.FULLFUNNEL_API_TOKEN ?? ''

  const body = req.body as LeadBody

  if (!body?.email) {
    res.status(400).json({ error: 'Email obrigatório' })
    return
  }

  try {
    const result = await upsertContact(locationId, apiToken, body)
    res.status(200).json({ success: true, ...result })
  } catch (err) {
    console.error('lead error:', err)
    res.status(500).json({ error: 'Erro ao registrar lead' })
  }
}
