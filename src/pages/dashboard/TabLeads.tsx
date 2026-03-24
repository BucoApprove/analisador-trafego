import { useState } from 'react'
import { useDashboardFetch } from './hooks'
import type { LeadsData } from './types'
import { TabLoading, TabError } from './components'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Search } from 'lucide-react'

interface Props { token: string; enabled: boolean }

export default function TabLeads({ token, enabled }: Props) {
  const [search, setSearch] = useState('')
  const [cursor, setCursor] = useState<string | undefined>(undefined)

  const url = `/api/leads-data?${new URLSearchParams({
    ...(search ? { query: search } : {}),
    ...(cursor ? { cursor } : {}),
  }).toString()}`

  const { data, status, error, refetch } = useDashboardFetch<LeadsData>(url, token, { enabled })

  if (status === 'loading' || status === 'idle') return <TabLoading />
  if (status === 'error') return <TabError message={error ?? 'Erro ao carregar'} onRetry={refetch} />
  if (!data) return null

  return (
    <div className="space-y-4">
      {/* Busca */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, email..."
            value={search}
            onChange={e => { setSearch(e.target.value); setCursor(undefined) }}
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground whitespace-nowrap">{data.total} leads</span>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Nome</th>
              <th className="px-4 py-3 text-left font-medium">Email</th>
              <th className="px-4 py-3 text-left font-medium">Telefone</th>
              <th className="px-4 py-3 text-left font-medium">Fonte</th>
              <th className="px-4 py-3 text-left font-medium">Data</th>
              <th className="px-4 py-3 text-left font-medium">Tags</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.leads.map(lead => (
              <tr key={lead.id} className="hover:bg-muted/50">
                <td className="px-4 py-3 font-medium">{lead.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{lead.email}</td>
                <td className="px-4 py-3 text-muted-foreground">{lead.phone ?? '—'}</td>
                <td className="px-4 py-3">{lead.utmSource ?? lead.source ?? '—'}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {lead.dateAdded ? new Date(lead.dateAdded).toLocaleDateString('pt-BR') : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {lead.tags.slice(0, 3).map(tag => (
                      <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                    ))}
                    {lead.tags.length > 3 && (
                      <Badge variant="outline" className="text-xs">+{lead.tags.length - 3}</Badge>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {data.nextCursor && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setCursor(data.nextCursor)}>
            Carregar mais
          </Button>
        </div>
      )}
    </div>
  )
}
