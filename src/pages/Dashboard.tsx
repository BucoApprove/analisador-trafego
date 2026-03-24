import { useState } from 'react'
import type { FormEvent } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Lock, Loader2 } from 'lucide-react'
import DashboardLayout from './dashboard/DashboardLayout'

export default function Dashboard() {
  const [token, setToken] = useState<string>(() => sessionStorage.getItem('dashboard-token') ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Se já tem token, renderiza o layout direto
  if (token) {
    return <DashboardLayout token={token} onLogout={() => { sessionStorage.removeItem('dashboard-token'); setToken('') }} />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!password.trim()) return

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/dashboard-data', {
        headers: { Authorization: `Bearer ${password}` },
      })

      if (res.status === 401) {
        setError('Senha incorreta. Tente novamente.')
        return
      }

      if (!res.ok && res.status !== 200) {
        // Aceita qualquer resposta não-401 como autenticação válida
        // (a API pode retornar erro de dados mas senha correta)
      }

      sessionStorage.setItem('dashboard-token', password)
      setToken(password)
    } catch {
      setError('Não foi possível conectar ao servidor.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl">Dashboard</CardTitle>
          <CardDescription>Insira a senha para continuar</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {loading ? 'Verificando...' : 'Entrar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
