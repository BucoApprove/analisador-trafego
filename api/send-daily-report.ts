/**
 * Relatório diário de vendas enviado via ManyChat → WhatsApp
 *
 * Chamado por Vercel Cron ("crons" em vercel.json).
 * Também pode ser chamado manualmente via POST para testes.
 *
 * Env vars obrigatórias:
 *   CRON_SECRET          — header "Authorization: Bearer <secret>" exigido pelo Vercel Cron
 *   MANYCHAT_TOKEN       — API token do ManyChat (Settings → API)
 *   MANYCHAT_PHONE       — Telefone do destinatário no formato internacional sem + (ex: 5553981234567)
 *                          OU defina MANYCHAT_SUBSCRIBER_ID diretamente para pular a busca
 *   BQ_CREDENTIALS / BQ_CREDENTIALS_FILE, BQ_DATASET, BQ_TABLE_VENDAS, BQ_TABLE_LEADS
 *   TAG_INSCRITO         — tag dos inscritos (ex: "BA25-Inscritos") — opcional, exibe contagem
 *   TAG_CAPTURA_PREFIX   — prefixo das tags de captura BA25 (ex: "BA25") — opcional
 *
 * Opcional:
 *   MANYCHAT_SUBSCRIBER_ID — se definido, pula a busca por telefone
 *   REPORT_DATE            — forçar data (YYYY-MM-DD) para testes manuais
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bqQuery, tableLeads, tableVendas } from './_bq.js'

// ─── Auth ─────────────────────────────────────────────────────────────────────

function authCron(req: VercelRequest, res: VercelResponse): boolean {
  const secret = process.env.CRON_SECRET ?? ''
  if (!secret) {
    // Em desenvolvimento sem CRON_SECRET configurado, permite passar
    console.warn('CRON_SECRET not set — allowing unauthenticated access')
    return true
  }
  const header = req.headers.authorization ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (provided !== secret) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

// ─── ManyChat helpers ─────────────────────────────────────────────────────────

async function findSubscriberByPhone(token: string, phone: string): Promise<string | null> {
  const url = new URL('https://api.manychat.com/fb/subscriber/findByPhone')
  url.searchParams.set('phone', phone)
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`ManyChat findByPhone error ${res.status}: ${txt.substring(0, 200)}`)
  }
  const data = await res.json() as { status: string; data?: { id: string | number } }
  if (data.status !== 'success' || !data.data?.id) return null
  return String(data.data.id)
}

async function sendWhatsAppMessage(token: string, subscriberId: string, text: string): Promise<void> {
  const res = await fetch('https://api.manychat.com/fb/sending/sendContent', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subscriber_id: subscriberId,
      data: {
        version: 'v2',
        content: {
          messages: [{ type: 'text', text }],
          actions: [],
          quick_replies: [],
        },
      },
    }),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`ManyChat sendContent error ${res.status}: ${txt.substring(0, 300)}`)
  }
  const result = await res.json() as { status: string; message?: string }
  if (result.status !== 'sent' && result.status !== 'success') {
    throw new Error(`ManyChat sendContent status: ${result.status} — ${result.message ?? ''}`)
  }
}

// ─── Formatação de valores ────────────────────────────────────────────────────

/** Converte centavos BQ → "R$ 1.234,56" */
function brl(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  })
}

function todayBrt(): string {
  // BRT = UTC-3
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000)
  return d.toISOString().split('T')[0]
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authCron(req, res)) return

  const rawDate = typeof req.query.date === 'string' ? req.query.date : (process.env.REPORT_DATE ?? todayBrt())
  // Validate and sanitize date to prevent SQL injection before interpolating into queries
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    res.status(400).json({ error: 'Formato de data inválido. Use YYYY-MM-DD.' })
    return
  }
  const today = rawDate

  const manychatToken = process.env.MANYCHAT_TOKEN ?? ''
  const manychatPhone = process.env.MANYCHAT_PHONE ?? ''
  let subscriberId    = process.env.MANYCHAT_SUBSCRIBER_ID ?? ''

  if (!manychatToken) {
    res.status(500).json({ error: 'MANYCHAT_TOKEN não configurado' })
    return
  }

  const tVendas = tableVendas()
  const tLeads  = tableLeads()

  try {
    // ── 1. Queries BQ em paralelo ─────────────────────────────────────────────
    const capturaPrefix = process.env.TAG_CAPTURA_PREFIX ?? ''
    const tagInscrito   = process.env.TAG_INSCRITO ?? ''

    const [rVendas, rPorProduto, rCaptura, rInscritos] = await Promise.all([
      // Totais do dia (aprovado + completo)
      bqQuery(
        `SELECT
           COUNT(*) AS total_vendas,
           COUNTIF(Status = 'COMPLETO') AS completo,
           COUNTIF(Status = 'APROVADO') AS aprovado,
           SUM(IF(Status IN ('COMPLETO','APROVADO'), CAST(Valor_do_Produto AS INT64), 0))
             AS receita_bruta,
           SUM(IF(Status IN ('COMPLETO','APROVADO'), CAST(Valor_Pago_pelo_Comprador_Sem_Taxas_e_Impostos AS INT64), 0))
             AS receita_liquida
         FROM ${tVendas}
         WHERE Data_de_Aprova____o = '${today}'`,
      ),

      // Breakdown por produto
      bqQuery(
        `SELECT
           Nome_do_Produto AS produto,
           COUNT(*) AS vendas,
           SUM(CAST(Valor_do_Produto AS INT64)) AS receita_bruta
         FROM ${tVendas}
         WHERE Data_de_Aprova____o = '${today}'
           AND Status IN ('COMPLETO','APROVADO')
         GROUP BY produto
         ORDER BY vendas DESC
         LIMIT 8`,
      ),

      // Novos leads de captura BA25 no dia (se configurado)
      capturaPrefix
        ? bqQuery(
            `SELECT COUNT(DISTINCT lead_email) AS cnt
             FROM ${tLeads}
             WHERE tag_name LIKE @prefix
               AND DATE(lead_register) = DATE('${today}')`,
            [{ name: 'prefix', value: `%${capturaPrefix}%` }],
          )
        : Promise.resolve(null),

      // Inscritos no evento (se configurado)
      tagInscrito
        ? bqQuery(
            `SELECT COUNT(DISTINCT lead_email) AS cnt
             FROM ${tLeads}
             WHERE tag_name = @tag
               AND DATE(lead_register) = DATE('${today}')`,
            [{ name: 'tag', value: tagInscrito }],
          )
        : Promise.resolve(null),
    ])

    // ── 2. Processa dados ─────────────────────────────────────────────────────
    const vRow = rVendas.rows[0]
    const totalVendas  = parseInt(vRow?.total_vendas ?? '0')
    const completo     = parseInt(vRow?.completo     ?? '0')
    const aprovado     = parseInt(vRow?.aprovado     ?? '0')
    const receitaBruta = parseInt(vRow?.receita_bruta  ?? '0')
    const receitaLiq   = parseInt(vRow?.receita_liquida ?? '0')

    const porProduto = rPorProduto.rows.map(r => ({
      produto: r.produto as string ?? '—',
      vendas: parseInt(r.vendas ?? '0'),
      receita: parseInt(r.receita_bruta ?? '0'),
    }))

    const novasCaptura  = rCaptura ? parseInt(rCaptura.rows[0]?.cnt  ?? '0') : null
    const novosInscritos = rInscritos ? parseInt(rInscritos.rows[0]?.cnt ?? '0') : null

    // ── 3. Monta mensagem ─────────────────────────────────────────────────────
    const dateFormatted = new Date(today + 'T12:00:00Z').toLocaleDateString('pt-BR', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    })

    const lines: string[] = []
    lines.push(`📊 *Relatório Diário — ${dateFormatted}*`)
    lines.push('')

    if (totalVendas === 0) {
      lines.push('Nenhuma venda aprovada hoje.')
    } else {
      lines.push(`💰 *Vendas do dia: ${totalVendas}*`)
      if (completo > 0)  lines.push(`  ✅ Completo: ${completo}`)
      if (aprovado > 0)  lines.push(`  🔄 Aprovado: ${aprovado}`)
      lines.push(`  💵 Receita bruta:  ${brl(receitaBruta)}`)
      lines.push(`  💵 Receita líquida: ${brl(receitaLiq)}`)
      lines.push('')

      if (porProduto.length > 0) {
        lines.push('📦 *Por produto:*')
        for (const p of porProduto) {
          lines.push(`  • ${p.produto}: ${p.vendas} venda${p.vendas > 1 ? 's' : ''} (${brl(p.receita)})`)
        }
      }
    }

    if (novasCaptura !== null || novosInscritos !== null) {
      lines.push('')
      lines.push('🎯 *Captação:*')
      if (novasCaptura !== null)   lines.push(`  Novos leads BA25: ${novasCaptura}`)
      if (novosInscritos !== null) lines.push(`  Novos inscritos: ${novosInscritos}`)
    }

    lines.push('')
    lines.push(`_Gerado automaticamente às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })} (BRT)_`)

    const messageText = lines.join('\n')

    // ── 4. Resolve subscriber ID ──────────────────────────────────────────────
    if (!subscriberId && manychatPhone) {
      subscriberId = (await findSubscriberByPhone(manychatToken, manychatPhone)) ?? ''
      if (!subscriberId) {
        throw new Error(`Subscriber não encontrado para o telefone ${manychatPhone}. Verifique se o número está cadastrado como subscriber no ManyChat.`)
      }
    }

    if (!subscriberId) {
      // Modo diagnóstico: retorna a mensagem sem enviar
      res.json({
        ok: true,
        dry_run: true,
        message: 'MANYCHAT_PHONE e MANYCHAT_SUBSCRIBER_ID não configurados — mensagem não enviada',
        preview: messageText,
        stats: { totalVendas, completo, aprovado, receitaBruta, receitaLiq },
      })
      return
    }

    // ── 5. Envia via ManyChat ─────────────────────────────────────────────────
    await sendWhatsAppMessage(manychatToken, subscriberId, messageText)

    console.log(`send-daily-report: enviado para subscriber ${subscriberId} em ${today}`)
    res.json({
      ok: true,
      date: today,
      subscriberId,
      totalVendas,
      receita: brl(receitaLiq),
      preview: messageText,
    })
  } catch (err) {
    console.error('send-daily-report error:', err)
    res.status(500).json({ error: String(err) })
  }
}
