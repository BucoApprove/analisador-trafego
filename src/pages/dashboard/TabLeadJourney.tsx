import { useState, useCallback, useRef, useEffect } from 'react'
import { Search, Loader2, ShoppingCart, Tag, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props { token: string; enabled: boolean }

interface LeadEvent {
  seq: number
  date: string
  type: 'lead' | 'sale'
  tagName: string | null
  utmSource: string | null
  utmCampaign: string | null
  utmMedium: string | null
  utmContent: string | null
  product: string | null
}

interface LeadJourneyResp {
  email: string
  name: string | null
  totalEvents: number
  totalSales: number
  events: LeadEvent[]
}

interface RecentSale {
  email: string
  name: string
  product: string
  date: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(s: string) {
  if (!s) return '—'
  try { return new Date(s + 'T12:00:00Z').toLocaleDateString('pt-BR') } catch { return s }
}

function UTMBadge({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono bg-muted border text-muted-foreground" title={`${label}: ${value}`}>
      <span className="text-[9px] uppercase opacity-60">{label}</span>
      <span className="font-medium text-foreground truncate max-w-[140px]">{value}</span>
    </span>
  )
}

// ─── Timeline de eventos ───────────────────────────────────────────────────────

function EventTimeline({ events }: { events: LeadEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">Nenhum evento encontrado.</p>
  }

  // Agrupa por data para mostrar a data como separador
  const byDate: { date: string; events: LeadEvent[] }[] = []
  for (const ev of events) {
    const last = byDate[byDate.length - 1]
    if (last && last.date === ev.date) {
      last.events.push(ev)
    } else {
      byDate.push({ date: ev.date, events: [ev] })
    }
  }

  return (
    <div className="relative">
      {/* Linha vertical da timeline */}
      <div className="absolute left-[18px] top-0 bottom-0 w-px bg-border" />

      <div className="space-y-0">
        {byDate.map(group => (
          <div key={group.date}>
            {/* Separador de data */}
            <div className="relative flex items-center gap-3 py-2">
              <div className="relative z-10 h-2 w-2 rounded-full bg-muted-foreground/30 border-2 border-background ml-[14px]" />
              <span className="text-[11px] font-semibold text-muted-foreground bg-background px-1">{fmtDate(group.date)}</span>
            </div>

            {/* Eventos do dia */}
            <div className="space-y-1.5 pb-2">
              {group.events.map((ev, i) => (
                <div key={i} className="relative flex items-start gap-3 pl-[38px]">
                  {/* Ícone do evento */}
                  <div className={`absolute left-[10px] top-2 z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-background ${
                    ev.type === 'sale'
                      ? 'bg-green-500'
                      : 'bg-blue-400'
                  }`}>
                    {ev.type === 'sale'
                      ? <ShoppingCart className="h-2.5 w-2.5 text-white" />
                      : <Tag className="h-2.5 w-2.5 text-white" />
                    }
                  </div>

                  {/* Conteúdo */}
                  <div className={`flex-1 rounded-lg border p-3 ${
                    ev.type === 'sale'
                      ? 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800'
                      : 'bg-card'
                  }`}>
                    {ev.type === 'sale' ? (
                      <div className="flex items-start gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-green-700 dark:text-green-400">Compra</span>
                        <span className="text-xs text-foreground font-medium">{ev.product ?? '—'}</span>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {/* Tag */}
                        {ev.tagName && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground">Tag</span>
                            <span className="text-xs font-medium">{ev.tagName}</span>
                          </div>
                        )}
                        {/* UTMs */}
                        {(ev.utmSource || ev.utmCampaign || ev.utmMedium || ev.utmContent) && (
                          <div className="flex flex-wrap gap-1">
                            <UTMBadge label="src" value={ev.utmSource} />
                            <UTMBadge label="camp" value={ev.utmCampaign} />
                            <UTMBadge label="med" value={ev.utmMedium} />
                            <UTMBadge label="cont" value={ev.utmContent} />
                          </div>
                        )}
                        {/* Se não tiver tag nem UTM */}
                        {!ev.tagName && !ev.utmSource && !ev.utmCampaign && !ev.utmMedium && !ev.utmContent && (
                          <span className="text-xs text-muted-foreground italic">Registro sem tag ou UTM</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Painel de resultado ────────────────────────────────────────────────────

function JourneyResult({ data }: { data: LeadJourneyResp }) {
  // Primeira e última interação de lead
  const leadEvents = data.events.filter(e => e.type === 'lead')
  const saleEvents = data.events.filter(e => e.type === 'sale')
  const firstLead = leadEvents[0]
  const lastLead = leadEvents[leadEvents.length - 1]

  // Tags únicas
  const tags = [...new Set(leadEvents.map(e => e.tagName).filter(Boolean) as string[])]

  // UTMs mais frequentes (source + campaign)
  const sources = leadEvents.map(e => e.utmSource).filter(Boolean) as string[]
  const campaigns = leadEvents.map(e => e.utmCampaign).filter(Boolean) as string[]
  const countMap = (arr: string[]) => {
    const m = new Map<string, number>()
    for (const v of arr) m.set(v, (m.get(v) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }
  const topSources = countMap(sources).slice(0, 3)
  const topCampaigns = countMap(campaigns).slice(0, 3)

  return (
    <div className="space-y-5">
      {/* Cabeçalho do lead */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <p className="font-semibold text-base">{data.name || data.email}</p>
            {data.name && <p className="text-sm text-muted-foreground">{data.email}</p>}
          </div>
        </div>

        {/* KPIs resumo */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <div className="rounded-md bg-muted/40 p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Registros</p>
            <p className="text-xl font-bold tabular-nums text-blue-600">{data.totalEvents}</p>
          </div>
          <div className="rounded-md bg-muted/40 p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Compras</p>
            <p className="text-xl font-bold tabular-nums text-green-600">{data.totalSales}</p>
          </div>
          <div className="rounded-md bg-muted/40 p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">1ª entrada</p>
            <p className="text-sm font-semibold">{firstLead ? fmtDate(firstLead.date) : '—'}</p>
          </div>
          <div className="rounded-md bg-muted/40 p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Último reg.</p>
            <p className="text-sm font-semibold">{lastLead ? fmtDate(lastLead.date) : '—'}</p>
          </div>
        </div>
      </div>

      {/* Tags + UTMs frequentes */}
      {(tags.length > 0 || topSources.length > 0 || topCampaigns.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-3">
          {tags.length > 0 && (
            <div className="rounded-lg border p-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Tags ({tags.length})</p>
              <div className="flex flex-wrap gap-1">
                {tags.map(t => (
                  <span key={t} className="inline-block rounded bg-blue-50 border border-blue-200 text-blue-700 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-300 px-2 py-0.5 text-xs">{t}</span>
                ))}
              </div>
            </div>
          )}
          {topSources.length > 0 && (
            <div className="rounded-lg border p-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Fontes (utm_source)</p>
              <div className="space-y-1">
                {topSources.map(([v, n]) => (
                  <div key={v} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-mono text-[11px]">{v}</span>
                    <span className="tabular-nums text-muted-foreground">{n}×</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {topCampaigns.length > 0 && (
            <div className="rounded-lg border p-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Campanhas top</p>
              <div className="space-y-1">
                {topCampaigns.map(([v, n]) => (
                  <div key={v} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-mono text-[11px]" title={v}>{v.length > 28 ? v.slice(0, 28) + '…' : v}</span>
                    <span className="tabular-nums text-muted-foreground">{n}×</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Compras */}
      {saleEvents.length > 0 && (
        <div className="rounded-lg border p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Compras ({saleEvents.length})</p>
          <div className="space-y-1.5">
            {saleEvents.map((e, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <ShoppingCart className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                <span className="text-muted-foreground text-xs tabular-nums">{fmtDate(e.date)}</span>
                <span className="font-medium">{e.product}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Linha do tempo completa */}
      <div className="rounded-lg border p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
          Linha do tempo — {data.events.length} eventos
        </p>
        <EventTimeline events={data.events} />
      </div>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function TabLeadJourney({ token, enabled }: Props) {
  const [emailInput, setEmailInput] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [recentSales, setRecentSales] = useState<RecentSale[]>([])
  const [salesLoading, setSalesLoading] = useState(false)
  const [journey, setJourney] = useState<LeadJourneyResp | null>(null)
  const [journeyLoading, setJourneyLoading] = useState(false)
  const [journeyError, setJourneyError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const headers = { Authorization: `Bearer ${token}` }

  const loadRecentSales = useCallback(async (product: string) => {
    setSalesLoading(true)
    try {
      const qs = new URLSearchParams({ recentSales: '1', limit: '60' })
      if (product.trim()) qs.set('product', product.trim())
      const r = await fetch(`/api/lead-journey?${qs}`, { headers })
      if (r.ok) {
        const j = await r.json()
        setRecentSales(j.sales ?? [])
      }
    } catch { /* silencioso */ } finally {
      setSalesLoading(false)
    }
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  // Carrega ao montar e quando filtro de produto muda (com debounce)
  useEffect(() => {
    if (!enabled) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => loadRecentSales(productFilter), 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [enabled, productFilter, loadRecentSales])

  const fetchJourney = useCallback(async (email: string) => {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) return
    setJourneyLoading(true)
    setJourneyError(null)
    setJourney(null)
    try {
      const r = await fetch(`/api/lead-journey?email=${encodeURIComponent(trimmed)}`, { headers })
      if (r.status === 401) { sessionStorage.removeItem('dashboard-token'); window.location.reload(); return }
      if (!r.ok) throw new Error(`Erro ${r.status}: ${await r.text()}`)
      const data: LeadJourneyResp = await r.json()
      setJourney(data)
    } catch (e) {
      setJourneyError((e as Error).message)
    } finally {
      setJourneyLoading(false)
    }
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  function selectSale(sale: RecentSale) {
    setEmailInput(sale.email)
    fetchJourney(sale.email)
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    fetchJourney(emailInput)
  }

  if (!enabled) return null

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">Análise de Lead</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Histórico completo de um lead na base — cadastros, tags, UTMs e compras em ordem cronológica.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">

        {/* ── Coluna esquerda: lista de vendas recentes + busca ──────────── */}
        <div className="space-y-4">

          {/* Busca por email */}
          <form onSubmit={handleSearch} className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Buscar por email</label>
            <div className="flex gap-2">
              <input
                type="email"
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                placeholder="lead@exemplo.com"
                className="flex-1 rounded border px-3 py-2 text-sm bg-background"
              />
              <Button type="submit" size="sm" disabled={journeyLoading || !emailInput.trim()}>
                {journeyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
          </form>

          {/* Filtro de produto para a lista */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Últimas vendas (filtrar por produto)</label>
            <input
              type="text"
              value={productFilter}
              onChange={e => setProductFilter(e.target.value)}
              placeholder="ex: buco approve"
              className="w-full rounded border px-3 py-2 text-sm bg-background"
            />
          </div>

          {/* Lista de vendas recentes */}
          <div className="rounded-lg border overflow-hidden">
            <div className="px-3 py-2 bg-muted/50 border-b flex items-center justify-between">
              <p className="text-xs font-semibold">Vendas recentes</p>
              {salesLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
            <div className="divide-y max-h-[520px] overflow-y-auto">
              {recentSales.length === 0 && !salesLoading && (
                <p className="text-xs text-muted-foreground text-center py-6">Nenhuma venda encontrada.</p>
              )}
              {recentSales.map((sale, i) => {
                const isActive = journey?.email === sale.email
                return (
                  <button
                    key={i}
                    onClick={() => selectSale(sale)}
                    className={`w-full text-left px-3 py-2.5 hover:bg-muted/60 transition-colors ${isActive ? 'bg-primary/8 border-l-2 border-l-primary' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{sale.name || sale.email}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{sale.email}</p>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">{sale.product}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-[10px] text-muted-foreground">{fmtDate(sale.date)}</span>
                        {isActive && <ExternalLink className="h-3 w-3 text-primary" />}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* ── Coluna direita: resultado da jornada ───────────────────────── */}
        <div>
          {journeyLoading && (
            <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Buscando jornada…</span>
            </div>
          )}

          {journeyError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {journeyError}
            </div>
          )}

          {!journeyLoading && !journeyError && journey === null && (
            <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
              <Search className="h-10 w-10 opacity-20 mb-3" />
              <p className="text-sm">Selecione uma venda ao lado ou busque pelo email do lead.</p>
            </div>
          )}

          {!journeyLoading && journey !== null && (
            <>
              {journey.totalEvents === 0 && journey.totalSales === 0 ? (
                <div className="rounded-lg border bg-card p-6 text-center text-muted-foreground">
                  <p className="text-sm font-medium">Nenhum registro encontrado para</p>
                  <p className="text-sm font-mono mt-1">{journey.email}</p>
                  <p className="text-xs mt-2 opacity-70">O email não consta na base de leads nem na base de vendas.</p>
                </div>
              ) : (
                <JourneyResult data={journey} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
