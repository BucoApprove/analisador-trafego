import type { VercelRequest, VercelResponse } from '@vercel/node'

const GHL_BASE = 'https://services.leadconnectorhq.com'
const TAG_INSCRITO = 'masterclass-24-03-2026'

interface LeadBody {
  name?: string
  firstName?: string
  lastName?: string
  email: string
  phone?: string
  profissao?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
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

  const nameParts = (body.name ?? '').trim().split(/\s+/)
  const firstName = body.firstName ?? nameParts[0] ?? ''
  const lastName = body.lastName ?? nameParts.slice(1).join(' ') ?? ''

  const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
  const tags: string[] = [TAG_INSCRITO, `inscricao:${today}`]

  if (body.profissao) tags.push(`profissao:${body.profissao}`)
  if (body.utmSource) tags.push(`utm_source:${body.utmSource}`)
  if (body.utmMedium) tags.push(`utm_medium:${body.utmMedium}`)
  if (body.utmCampaign) tags.push(`utm_campaign:${body.utmCampaign}`)
  if (body.utmContent) tags.push(`utm_content:${body.utmContent}`)

  const payload = {
    locationId,
    firstName,
    lastName,
    email: body.email,
    phone: body.phone,
    tags,
    source: body.utmSource ?? 'masterclass-page',
  }

  try {
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
      res.status(200).json({ success: true, action: 'created' })
      return
    }

    // Duplicata
    if (createRes.status === 400) {
      const errData = await createRes.json() as { meta?: { contactId?: string } }
      const contactId = errData.meta?.contactId
      if (!contactId) throw new Error('Duplicata sem contactId')

      // Busca tags existentes e faz merge
      const getRes = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
        headers: { Authorization: `Bearer ${apiToken}`, Version: '2021-07-28' },
      })
      const existing = await getRes.json() as { contact: { tags: string[] } }
      const mergedTags = [...new Set([...(existing.contact?.tags ?? []), ...tags])]

      await fetch(`${GHL_BASE}/contacts/${contactId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Version: '2021-07-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tags: mergedTags }),
      })

      res.status(200).json({ success: true, action: 'updated', id: contactId })
      return
    }

    throw new Error(`GHL error: ${createRes.status}`)
  } catch (err) {
    console.error('lead-masterclass error:', err)
    res.status(500).json({ error: 'Erro ao registrar inscrição' })
  }
}
