// Aba de Pesquisa — busca avançada por tag em toda a base de leads
import { useState } from 'react'
import { useDashboardFetch } from './hooks'
import type { LeadsData } from './types'
import { TabLoading, TabError, KpiCard } from './components'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Search } from 'lucide-react'

interface Props { token: string; enabled: boolean }

export default function TabPesquisa({ token, enabled }: Props) {
  const [tag, setTag] = useState('')
  const [activeTag, setActiveTag] = useState('')

  const url = activeTag
    ? `/api/leads-data?${new URLSearchParams({ tag: activeTag }).toString()}`
    : '/api/leads-data'

  const { data, status, error, refetch } = useDashboardFetch<LeadsData>(
    url,
    token,
    { enabled }
  )

  function handleSearch() {
    setActiveTag(tag.trim())
  }

  if (!enabled) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filtrar por tag (ex: comprou-curso, masterclass-24-03-2026)"
            value={tag}
            onChange={e => setTag(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            className="pl-9"
          />
        </div>
        <Button onClick={handleSearch}>Buscar</Button>
        {activeTag && (
          <Button variant="ghost" onClick={() => { setTag(''); setActiveTag('') }}>Limpar</Button>
        )}
      </div>

      {activeTag && (
        <p className="text-sm text-muted-foreground">
          Filtrando por tag: <Badge variant="secondary">{activeTag}</Badge>
        </p>
      )}

      {(status === 'loading' || status === 'idle') && <TabLoading />}
      {status === 'error' && <TabError message={error ?? 'Erro ao carregar'} onRetry={refetch} />}

      {status === 'success' && data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <KpiCard label="Total de resultados" value={data.total.toLocaleString('pt-BR')} color="#d4a853" />
            <KpiCard label="Exibindo" value={data.leads.length.toLocaleString('pt-BR')} color="#7c9885" />
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Nome</th>
                  <th className="px-4 py-3 text-left font-medium">Email</th>
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
                    <td className="px-4 py-3">{lead.utmSource ?? lead.source ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {lead.dateAdded ? new Date(lead.dateAdded).toLocaleDateString('pt-BR') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {lead.tags.slice(0, 4).map(t => (
                          <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                        ))}
                        {lead.tags.length > 4 && (
                          <Badge variant="outline" className="text-xs">+{lead.tags.length - 4}</Badge>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
