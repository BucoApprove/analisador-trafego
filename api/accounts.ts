/**
 * GET /api/accounts?token={token}
 *
 * Retorna as contas disponíveis com nomes amigáveis.
 * Permite que a skill monte o menu de seleção sem o usuário precisar saber o ID.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'

const CONTAS = [
  { id: 'conta1', nome: 'GBS Launch' },
  { id: 'conta2', nome: 'GBS Pós-graduações' },
]

export default function handler(req: VercelRequest, res: VercelResponse) {
  const providedToken = typeof req.query.token === 'string' ? req.query.token : ''
  const validToken    = process.env.DASHBOARD_TOKEN ?? ''
  const validAdmin    = process.env.DASHBOARD_TOKEN_ADMIN ?? ''
  if (!providedToken || (providedToken !== validToken && providedToken !== validAdmin)) {
    return res.status(401).json({ error: 'Token inválido. Passe ?token=SEU_TOKEN' })
  }

  return res.json({ contas: CONTAS })
}
