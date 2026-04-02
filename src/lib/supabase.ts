import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(url, key)

export type UserRole = 'admin' | 'analyst'

export interface Profile {
  id: string
  name: string
  role: UserRole
}

export interface Activity {
  id: string
  product_name: string
  title: string
  description: string
  status: 'pendente' | 'em andamento' | 'concluída'
  created_at: string
}

export interface ActivityLink {
  id: string
  activity_id: string
  label: string
  url: string
  type: 'drive' | 'sheet' | 'link'
}

export interface ActivityComment {
  id: string
  activity_id: string
  author: string
  text: string
  created_at: string
}
