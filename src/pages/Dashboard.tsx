import { useState, useEffect } from 'react'
import type { FormEvent } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Lock, Loader2 } from 'lucide-react'
import DashboardLayout from './dashboard/DashboardLayout'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'

export default function Dashboard() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true) // initial auth check
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // On mount: check existing session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) loadProfile(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) loadProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('id, name, role')
      .eq('id', userId)
      .single()
    setProfile(data ?? null)
    setLoading(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password.trim()) return
    setSubmitting(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError('E-mail ou senha incorretos.')
    setSubmitting(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  // Initial loading
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Authenticated
  if (session && profile) {
    const token = session.access_token
    const role = profile.role === 'admin' ? 'admin' : 'user'
    return (
      <DashboardLayout
        token={token}
        role={role}
        userName={profile.name}
        onLogout={handleLogout}
      />
    )
  }

  // Login form
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">

        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-2xl bg-primary flex items-center justify-center shadow-sm mb-4">
            <Lock className="h-5 w-5 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Analisador de Tráfego</h1>
          <p className="text-sm text-muted-foreground mt-1">Faça login para continuar</p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  E-mail
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Senha
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
              </div>
              {error && (
                <p className="text-sm text-destructive font-medium">{error}</p>
              )}
              <Button type="submit" className="w-full mt-2" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting ? 'Entrando...' : 'Entrar'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
