import { useState } from 'react'
import { useDashboardFetch } from './hooks'
import type { SubscriberEmailsData } from './types'
import { TabLoading, TabError, KpiCard } from './components'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Search, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props { token: string; enabled: boolean }

export default function TabInscritos({ token, enabled }: Props) {
  const [search, setSearch] = useState('')

  const { data, status, error, refetch } = useDashboardFetch<SubscriberEmailsData>(
    '/api/subscriber-emails',
    token,
    { enabled }
  )

  if (status === 'loading' || status === 'idle') return <TabLoading />
  if (status === 'error') return <TabError message={error ?? 'Erro ao carregar'} onRetry={refetch} />
  if (!data) return null

  const filtered = data.subscribers.filter(s =>
    !search ||
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.email.toLowerCase().includes(search.toLowerCase())
  )

  function exportCSV() {
    const headers = 'Nome,Email,Telefone,Profissão,Fonte,Data'
    const rows = data!.subscribers.map(s =>
      `"${s.name}","${s.email}","${s.phone ?? ''}","${s.profissao ?? ''}","${s.fonte ?? ''}","${s.inscricaoDate ?? ''}"`
    )
    const csv = [headers, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'inscritos.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Total de Inscritos" value={data.total.toLocaleString('pt-BR')} color="#d4a853" />
        <KpiCard label="Exibindo" value={filtered.length.toLocaleString('pt-BR')} color="#7c9885" />
        <KpiCard label="Com Telefone" value={data.subscribers.filter(s => s.phone).length.toLocaleString('pt-BR')} color="#5b8fb9" />
      </div>

      {/* Busca + Export */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={exportCSV}>
          <Download className="mr-2 h-4 w-4" /> CSV
        </Button>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Nome</th>
              <th className="px-4 py-3 text-left font-medium">Email</th>
              <th className="px-4 py-3 text-left font-medium">Profissão</th>
              <th className="px-4 py-3 text-left font-medium">Fonte</th>
              <th className="px-4 py-3 text-left font-medium">Data</th>
              <th className="px-4 py-3 text-left font-medium">Tags</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map(subscriber => (
              <tr key={subscriber.id} className="hover:bg-muted/50">
                <td className="px-4 py-3 font-medium">{subscriber.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{subscriber.email}</td>
                <td className="px-4 py-3">{subscriber.profissao ?? '—'}</td>
                <td className="px-4 py-3">{subscriber.fonte ?? '—'}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {subscriber.inscricaoDate
                    ? new Date(subscriber.inscricaoDate).toLocaleDateString('pt-BR')
                    : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {subscriber.tags.slice(0, 2).map(tag => (
                      <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                    ))}
                    {subscriber.tags.length > 2 && (
                      <Badge variant="outline" className="text-xs">+{subscriber.tags.length - 2}</Badge>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
