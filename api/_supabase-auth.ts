/**
 * Auth helper para endpoints Vercel usando Supabase Auth.
 * Verifica o JWT do usuário e retorna nome + role do perfil.
 */
import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

export type Role = 'admin' | 'analyst'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: Role
}

function getAdmin() {
  const url = process.env.SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_KEY ?? ''
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function authUser(
  req: VercelRequest,
  res: VercelResponse,
): Promise<AuthUser | null> {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }

  const admin = getAdmin()
  if (!admin) {
    res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_KEY não configurados' })
    return null
  }

  const { data: { user }, error } = await admin.auth.getUser(token)
  if (error || !user) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('name, role')
    .eq('id', user.id)
    .single()

  return {
    id: user.id,
    email: user.email ?? '',
    name: profile?.name ?? user.email ?? '',
    role: (profile?.role as Role) ?? 'analyst',
  }
}

/** Retorna true se admin, 403 + false se não for */
export function requireAdmin(user: AuthUser, res: VercelResponse): boolean {
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' })
    return false
  }
  return true
}
