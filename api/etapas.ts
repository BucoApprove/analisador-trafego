/**
 * GET /api/etapas?token={token}&account={conta}
 *
 * Retorna as etapas disponíveis para uma conta, com label e tipo de funil.
 * Permite que a skill descubra o funil automaticamente sem perguntar ao usuário.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'

const CONTA1_ETAPAS = [
  { id: 'etapa1', label: 'Posts Impulsionados', tipo: 'topo' },
  { id: 'etapa2', label: 'Captura',             tipo: 'meio' },
  { id: 'etapa3', label: 'Relacionamento',      tipo: 'meio' },
  { id: 'etapa4', label: 'Conversão',           tipo: 'fundo' },
  { id: 'etapa5', label: 'Remarketing',         tipo: 'fundo' },
]

const CONTA2_ETAPAS = [
  { id: 'anatomia',           label: 'Pós-Grad. Anatomia',   tipo: 'fundo' },
  { id: 'patologia',          label: 'Pós-Grad. Patologia',  tipo: 'fundo' },
  { id: 'lowticket-brasil',   label: 'Low Ticket Brasil',    tipo: 'fundo' },
  { id: 'lowticket-latam',    label: 'Low Ticket Latam',     tipo: 'fundo' },
]

export default function handler(req: VercelRequest, res: VercelResponse) {
  const providedToken = typeof req.query.token === 'string' ? req.query.token : ''
  const validToken    = process.env.DASHBOARD_TOKEN ?? ''
  const validAdmin    = process.env.DASHBOARD_TOKEN_ADMIN ?? ''
  if (!providedToken || (providedToken !== validToken && providedToken !== validAdmin)) {
    return res.status(401).json({ error: 'Token inválido. Passe ?token=SEU_TOKEN' })
  }

  const account = typeof req.query.account === 'string' ? req.query.account : ''
  if (account === 'conta1') {
    return res.json({ conta: 'conta1', etapas: CONTA1_ETAPAS })
  }
  if (account === 'conta2') {
    return res.json({ conta: 'conta2', etapas: CONTA2_ETAPAS })
  }

  // Sem account: retorna todas as etapas agrupadas por conta
  return res.json({
    contas: {
      conta1: CONTA1_ETAPAS,
      conta2: CONTA2_ETAPAS,
    },
  })
}
