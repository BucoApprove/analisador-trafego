import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHash } from 'crypto'

const GHL_BASE = 'https://services.leadconnectorhq.com'
const META_BASE = 'https://graph.facebook.com/v19.0'
const META_PIXEL_ID = '1003367439719418'

// Offer codes → turma
const OFFER_TURMAS: Record<string, string> = {
  hf2r1wt6: 'fundadora',
  ex4bejyw: 'lancamento',
}

function sha256(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex')
}

function hashName(name: string): { fn?: string; ln?: string } {
  const parts = name.trim().split(/\s+/)
  return {
    fn: sha256(parts[0] ?? ''),
    ln: sha256(parts.slice(1).join(' ') || parts[0] ?? ''),
  }
}

async function tagContact(contactId: string, tagsToAdd: string[], apiToken: string) {
  // Busca tags existentes
  const getRes = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    headers: { Authorization: `Bearer ${apiToken}`, Version: '2021-07-28' },
  })
  if (!getRes.ok) return

  const data = await getRes.json() as { contact: { tags: string[] } }
  const existing = data.contact?.tags ?? []
  const merged = [...new Set([...existing, ...tagsToAdd])]

  await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tags: merged }),
  })
}

async function findContactByEmail(email: string, locationId: string, apiToken: string): Promise<string | null> {
  const url = new URL(`${GHL_BASE}/contacts/`)
  url.searchParams.set('locationId', locationId)
  url.searchParams.set('query', email)
  url.searchParams.set('limit', '1')

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiToken}`, Version: '2021-07-28' },
  })
  if (!res.ok) return null

  const data = await res.json() as { contacts: { id: string; email: string }[] }
  const match = data.contacts?.find(c => c.email?.toLowerCase() === email.toLowerCase())
  return match?.id ?? null
}

async function sendMetaCAPI(
  eventName: string,
  pixelId: string,
  accessToken: string,
  userData: { em?: string; ph?: string; fn?: string; ln?: string; client_ip_address?: string },
  customData: Record<string, unknown> = {}
) {
  const payload = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      user_data: userData,
      custom_data: customData,
    }],
  }

  await fetch(`${META_BASE}/${pixelId}/events?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Valida Hottok
  const hottok = process.env.HOTMART_WEBHOOK_SECRET
  if (hottok) {
    const provided = req.headers['x-hotmart-hottok'] ?? req.headers['hottok']
    if (provided !== hottok) {
      res.status(401).json({ error: 'Invalid hottok' })
      return
    }
  }

  const apiToken = process.env.FULLFUNNEL_API_TOKEN ?? ''
  const locationId = process.env.FULLFUNNEL_LOCATION_ID ?? ''
  const metaToken = process.env.META_ACCESS_TOKEN ?? ''

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const event = req.body as any
  const eventType: string = event?.event ?? event?.data?.purchase?.status ?? ''
  const buyer = event?.data?.buyer ?? {}
  const purchase = event?.data?.purchase ?? {}
  const subscription = event?.data?.subscription ?? {}
  const offerCode: string = purchase?.offer?.code ?? subscription?.plan?.name ?? ''

  const email: string = buyer?.email ?? ''
  const name: string = buyer?.name ?? ''
  const phone: string = buyer?.checkout_phone ?? ''
  const today = new Date().toISOString().split('T')[0]

  if (!email) {
    res.status(200).json({ ok: true, skipped: 'no email' })
    return
  }

  try {
    // Encontra o contato no GHL
    let contactId = await findContactByEmail(email, locationId, apiToken)

    // Se não encontrar, cria
    if (!contactId) {
      const parts = name.trim().split(/\s+/)
      const createRes = await fetch(`${GHL_BASE}/contacts/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Version: '2021-07-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          locationId,
          firstName: parts[0] ?? '',
          lastName: parts.slice(1).join(' ') ?? '',
          email,
          phone,
          tags: [],
        }),
      })

      if (createRes.ok) {
        const created = await createRes.json() as { contact: { id: string } }
        contactId = created.contact?.id
      } else if (createRes.status === 400) {
        const errData = await createRes.json() as { meta?: { contactId?: string } }
        contactId = errData.meta?.contactId ?? null
      }
    }

    if (!contactId) {
      res.status(200).json({ ok: true, skipped: 'contact not found/created' })
      return
    }

    // Determina tags pela tipo de evento
    const isApproved = eventType === 'PURCHASE_APPROVED' || eventType === 'PURCHASE' || purchase?.status === 'APPROVED'
    const isRefunded = eventType === 'PURCHASE_REFUNDED' || eventType === 'REFUND'
    const isCanceled = eventType === 'PURCHASE_CANCELED' || eventType === 'CANCELED'

    if (isApproved) {
      const turma = OFFER_TURMAS[offerCode] ? `comprou-turma-${OFFER_TURMAS[offerCode]}` : null
      const tags = ['comprou-curso', `compra:${today}`, ...(turma ? [turma] : [])]
      await tagContact(contactId, tags, apiToken)

      // Meta CAPI - Purchase
      const userData = {
        em: sha256(email),
        ph: phone ? sha256(phone.replace(/\D/g, '')) : undefined,
        ...hashName(name),
      }
      await sendMetaCAPI('Purchase', META_PIXEL_ID, metaToken, userData, {
        currency: 'BRL',
        value: purchase?.price?.value ?? 0,
      })
    } else if (isRefunded) {
      await tagContact(contactId, ['reembolso'], apiToken)
    } else if (isCanceled) {
      await tagContact(contactId, ['cancelou'], apiToken)
    }

    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('hotmart-webhook error:', err)
    res.status(500).json({ error: 'Erro interno' })
  }
}
