import { useState, useCallback, useEffect } from 'react'
import type { LaunchData, TagsListData } from './types'
import {
  SectionHeader, TabLoading, TabError,
  formatPercent, ChartTooltip, CHART_COLORS,
} from './components'
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { Search, AlertTriangle } from 'lucide-react'

interface Props { token: string; enabled: boolean }

// ---------- helper local ----------
function UtmTable({
  title,
  rows,
  total,
  color,
  hint,
}: {
  title: string
  rows: { name: string; value: number }[]
  total: number
  color: string
  hint?: string
}) {
  const maxVal = Math.max(...rows.map(r => r.value), 1)
  return (
    <div>
      <SectionHeader title={title} description={hint} />
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Valor</th>
              <th className="px-3 py-2 text-right font-medium">Leads</th>
              <th className="px-3 py-2 text-right font-medium">%</th>
              <th className="px-3 py-2 w-28"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(r => (
              <tr key={r.name} className="hover:bg-muted/50">
                <td className="px-3 py-2 max-w-[180px] truncate" title={r.name}>{r.name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.value.toLocaleString('pt-BR')}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {total > 0 ? formatPercent((r.value / total) * 100) : '—'}
                </td>
                <td className="px-3 py-2">
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(r.value / maxVal) * 100}%`, backgroundColor: color }}
                    />
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
// ----------------------------------

function todayStr() {
  return new Date().toISOString().split('T')[0]
}
function firstOfMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export default function TabLancamento({ token, enabled }: Props) {
  const [prefix, setPrefix] = useState('')
  const [since, setSince] = useState(firstOfMonthStr)
  const [until, setUntil] = useState(todayStr)
  const [spendFilter, setSpendFilter] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [data, setData] = useState<LaunchData | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Carrega lista de tags disponíveis para sugestão
  useEffect(() => {
    if (!enabled) return
    fetch('/api/launch-data', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((d: TagsListData) => setSuggestions(d.tags ?? []))
      .catch(() => {/* silencia — sugestões são opcionais */})
  }, [enabled, token])

  const search = useCallback(async () => {
    const trimmed = prefix.trim()
    if (!trimmed) return
    setStatus('loading')
    setErrorMsg(null)
    try {
      const spendParam = spendFilter.trim()
        ? `&spendFilter=${encodeURIComponent(spendFilter.trim())}`
        : ''
      const url = `/api/launch-data?prefix=${encodeURIComponent(trimmed)}&since=${since}&until=${until}${spendParam}`
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Erro ${res.status}`)
      }
      const json: LaunchData = await res.json()
      setData(json)
      setStatus('idle')
    } catch (e) {
      setStatus('error')
      setErrorMsg((e as Error).message)
    }
  }, [prefix, since, until, spendFilter, token])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') search()
  }

  // Prefixos únicos das sugestões (parte antes do primeiro espaço)
  const prefixSuggestions = [...new Set(
    suggestions
      .map(t => t.split(' ')[0])
      .filter(Boolean)
  )].slice(0, 12)

  const maxTagCount = data ? Math.max(...data.byTag.map(t => t.countAll), 1) : 1

  return (
    <div className="space-y-6">

      {/* Barra de busca */}
      <div className="rounded-lg border bg-card p-4">
        <SectionHeader
          title="Análise de Lançamento"
          description="Digite o prefixo do lançamento (ex: BA25) para ver todos os leads agrupados pelas suas tags."
        />

        <div className="flex flex-wrap items-end gap-3">
          {/* Prefix input */}
          <div className="flex-1 min-w-[180px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Prefixo do lançamento
            </label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={prefix}
                onChange={e => setPrefix(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="ex: BA25 (busca por similaridade)"
                className="w-full rounded-md border bg-background pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Data início */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">De</label>
            <input
              type="date"
              value={since}
              onChange={e => setSince(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Data fim */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Até</label>
            <input
              type="date"
              value={until}
              onChange={e => setUntil(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <button
            onClick={search}
            disabled={!prefix.trim() || status === 'loading'}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
          >
            {status === 'loading' ? 'Buscando…' : 'Buscar'}
          </button>
        </div>

        {/* Filtro Meta Ads spend (opcional) */}
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Filtro campanhas Meta Ads <span className="font-normal opacity-60">(opcional — calcular CPL)</span>
            </label>
            <input
              type="text"
              value={spendFilter}
              onChange={e => setSpendFilter(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="ex: BA25, CAPTURA  (palavras separadas por vírgula)"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <p className="text-xs text-muted-foreground pb-2">
            Todas as palavras devem aparecer no nome da campanha (sem distinguir maiúsculas).
          </p>
        </div>

        {/* Sugestões de prefixos */}
        {prefixSuggestions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="text-xs text-muted-foreground">Lançamentos encontrados:</span>
            {prefixSuggestions.map(p => (
              <button
                key={p}
                onClick={() => { setPrefix(p) }}
                className="rounded-full border px-2.5 py-0.5 text-xs font-medium hover:bg-muted transition-colors"
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Loading */}
      {status === 'loading' && <TabLoading />}

      {/* Erro */}
      {status === 'error' && (
        <TabError message={errorMsg ?? 'Erro ao carregar'} onRetry={search} />
      )}

      {/* Resultados */}
      {status === 'idle' && data && (
        <>
          {/* Painel resumo — KPIs + tags + gráfico agrupados */}
          <div className="rounded-lg border bg-card overflow-hidden">

            {/* Cabeçalho + stat strip */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 px-4 py-2 border-b bg-muted/40">
              <span className="text-sm font-semibold">
                Lançamento: <span style={{ color: CHART_COLORS[1] }}>{data.prefix}</span>
              </span>
              <span className="text-xs text-muted-foreground">{data.dateRange.since} → {data.dateRange.until}</span>
            </div>
            <div className="flex flex-wrap gap-px border-b">
              {([
                { label: 'Total leads', value: data.totalUniqueAll.toLocaleString('pt-BR'), color: CHART_COLORS[1], sub: 'histórico' },
                { label: 'No período', value: data.totalUnique.toLocaleString('pt-BR'), color: CHART_COLORS[0], sub: data.dateRange.since + ' → ' + data.dateRange.until },
                { label: 'Soma bruta', value: data.sumByTag.toLocaleString('pt-BR'), color: '#888', sub: 'c/ duplicatas' },
                { label: 'Sobreposição', value: data.overlap > 0 ? data.overlap.toLocaleString('pt-BR') : '0', color: data.overlap > 0 ? '#c17c74' : '#7c9885', sub: 'em múltiplas tags' },
              ] as const).map(s => (
                <div key={s.label} className="flex-1 min-w-[100px] px-4 py-2">
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  <p className="text-lg font-bold tabular-nums leading-tight" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-[9px] text-muted-foreground truncate">{s.sub}</p>
                </div>
              ))}
            </div>

            {/* Tags + gráfico lado a lado */}
            <div className="grid lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x">

              {/* Tabela de tags */}
              <table className="w-full text-xs">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="px-3 py-1 text-left font-medium">Tag</th>
                    <th className="px-3 py-1 text-right font-medium">Período</th>
                    <th className="px-3 py-1 text-right font-medium">Histórico</th>
                    <th className="px-2 py-1 w-20"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.byTag.map((t, i) => (
                    <tr key={t.tag} className="hover:bg-muted/40">
                      <td className="px-3 py-1 font-medium truncate max-w-[160px]" title={t.tag}>{t.tag}</td>
                      <td className="px-3 py-1 text-right tabular-nums">
                        {t.countPeriod > 0 ? t.countPeriod.toLocaleString('pt-BR') : <span className="text-muted-foreground">0</span>}
                      </td>
                      <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">{t.countAll.toLocaleString('pt-BR')}</td>
                      <td className="px-2 py-1">
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${(t.countAll / maxTagCount) * 100}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data.overlap > 0 && (
                    <tr className="bg-muted/20">
                      <td className="px-3 py-1 text-[10px] text-muted-foreground italic" colSpan={4}>
                        sobreposição −{data.overlap.toLocaleString('pt-BR')} · único período: <strong style={{ color: CHART_COLORS[1] }}>{data.totalUnique.toLocaleString('pt-BR')}</strong>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Gráfico captação diária */}
              {data.leadsByDay.length > 0 ? (
                <div className="p-3">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Captação diária</p>
                  <ResponsiveContainer width="100%" height={120}>
                    <LineChart data={data.leadsByDay} margin={{ top: 2, right: 8, left: -24, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={v => v.slice(5)} />
                      <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Line type="monotone" dataKey="count" name="Leads" stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex items-center justify-center p-6 text-xs text-muted-foreground">Sem dados de captação no período</div>
              )}

            </div>
          </div>

          {/* CPL row — só aparece quando spendFilter foi usado */}
          {data.metaSpend !== undefined && (
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="flex flex-wrap gap-px border-b">
                <div className="flex-1 min-w-[130px] px-4 py-2">
                  <p className="text-[10px] text-muted-foreground">Gasto Meta Ads</p>
                  <p className="text-lg font-bold tabular-nums" style={{ color: CHART_COLORS[3] }}>
                    R$ {data.metaSpend.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-[9px] text-muted-foreground">{data.metaCampaigns?.length ?? 0} campanha(s)</p>
                </div>
                <div className="flex-1 min-w-[130px] px-4 py-2">
                  <p className="text-[10px] text-muted-foreground">CPL</p>
                  <p className="text-lg font-bold tabular-nums" style={{ color: CHART_COLORS[4] }}>
                    {data.cpl != null ? `R$ ${data.cpl.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                  </p>
                  <p className="text-[9px] text-muted-foreground">gasto ÷ leads únicos</p>
                </div>
                {data.metaSpend === 0 && (
                  <div className="flex items-center gap-2 px-4 py-2 text-xs text-yellow-700 dark:text-yellow-300">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Nenhuma campanha encontrada. Verifique o filtro ou o período.
                  </div>
                )}
              </div>
              {(data.metaCampaigns?.length ?? 0) > 0 && (
                <table className="w-full text-xs">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="px-3 py-1 text-left font-medium">Campanha</th>
                      <th className="px-3 py-1 text-right font-medium">Gasto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.metaCampaigns!.map(c => (
                      <tr key={c.name} className="hover:bg-muted/40">
                        <td className="px-3 py-1">{c.name}</td>
                        <td className="px-3 py-1 text-right tabular-nums">
                          R$ {c.spend.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {/* UTM breakdown */}
          <div>
            <SectionHeader
              title="Análise de UTMs"
              description="Todos os breakdowns usam leads únicos do período. Útil para identificar quais canais, formatos e criativos geram mais captação."
            />

            <div className="grid gap-6 lg:grid-cols-2">

              {/* utm_source */}
              {data.bySource.length > 0 && (
                <UtmTable
                  title="Fonte (utm_source)"
                  rows={data.bySource}
                  total={data.totalUnique}
                  color={CHART_COLORS[0]}
                />
              )}

              {/* utm_medium */}
              {data.byMedium.length > 0 && (
                <UtmTable
                  title="Mídia (utm_medium)"
                  rows={data.byMedium}
                  total={data.totalUnique}
                  color={CHART_COLORS[1]}
                  hint="Identifica o tipo de canal: cpc, social, email, organic…"
                />
              )}

              {/* utm_campaign */}
              {data.byCampaign.length > 0 && (
                <UtmTable
                  title="Campanha (utm_campaign)"
                  rows={data.byCampaign}
                  total={data.totalUnique}
                  color={CHART_COLORS[2]}
                />
              )}

              {/* utm_content */}
              {data.byContent.filter(r => r.name !== '(não informado)').length > 0 && (
                <UtmTable
                  title="Conteúdo (utm_content)"
                  rows={data.byContent}
                  total={data.totalUnique}
                  color={CHART_COLORS[3]}
                  hint="Diferencia criativos ou links dentro da mesma campanha."
                />
              )}

              {/* utm_term */}
              {data.byTerm.filter(r => r.name !== '(não informado)').length > 0 && (
                <UtmTable
                  title="Termo (utm_term)"
                  rows={data.byTerm}
                  total={data.totalUnique}
                  color={CHART_COLORS[4]}
                  hint="Palavras-chave pagas ou termos de pesquisa."
                />
              )}

            </div>
          </div>
          {/* Evolução diária */}
          {(data.leadsByDay.length > 0 || (data.dailyMeta?.length ?? 0) > 0) && (() => {
            // Mescla dados BQ (leads) + Meta (spend/clicks)
            const leadsMap = new Map(data.leadsByDay.map(d => [d.date, d.count]))
            const metaMap = new Map((data.dailyMeta ?? []).map(d => [d.date, d]))
            const allDates = [...new Set([...leadsMap.keys(), ...metaMap.keys()])].sort()
            const hasMeta = (data.dailyMeta?.length ?? 0) > 0

            // Totais para linha de rodapé
            const totLeads = allDates.reduce((s, d) => s + (leadsMap.get(d) ?? 0), 0)
            const totSpend = allDates.reduce((s, d) => s + (metaMap.get(d)?.spend ?? 0), 0)
            const totClicks = allDates.reduce((s, d) => s + (metaMap.get(d)?.linkClicks ?? 0), 0)
            const totPv = allDates.reduce((s, d) => s + (metaMap.get(d)?.pageViews ?? 0), 0)

            return (
              <div>
                <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Evolução diária {hasMeta ? '— Investimento + Leads' : '— Leads'}
                </p>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-xs tabular-nums">
                    <thead className="bg-muted/60 text-[11px]">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-medium">Data</th>
                        {hasMeta && <th className="px-3 py-1.5 text-right font-medium">Investimento</th>}
                        <th className="px-3 py-1.5 text-right font-medium">Leads</th>
                        {hasMeta && <th className="px-3 py-1.5 text-right font-medium">CPL</th>}
                        {hasMeta && <th className="px-3 py-1.5 text-right font-medium">Cliques link</th>}
                        {hasMeta && <th className="px-3 py-1.5 text-right font-medium">Conv. %</th>}
                        {hasMeta && <th className="px-3 py-1.5 text-right font-medium">Page views</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {allDates.map(date => {
                        const leads = leadsMap.get(date) ?? 0
                        const m = metaMap.get(date)
                        const cplDay = m && leads > 0 ? m.spend / leads : null
                        const conv = m && m.linkClicks > 0 ? (leads / m.linkClicks) * 100 : null
                        return (
                          <tr key={date} className="hover:bg-muted/40">
                            <td className="px-3 py-1">{date.slice(5)}</td>
                            {hasMeta && (
                              <td className="px-3 py-1 text-right">
                                {m ? `R$ ${m.spend.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                              </td>
                            )}
                            <td className="px-3 py-1 text-right" style={{ color: leads > 0 ? CHART_COLORS[1] : undefined }}>
                              {leads > 0 ? leads.toLocaleString('pt-BR') : <span className="text-muted-foreground">0</span>}
                            </td>
                            {hasMeta && (
                              <td className="px-3 py-1 text-right text-muted-foreground">
                                {cplDay != null ? `R$ ${cplDay.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                              </td>
                            )}
                            {hasMeta && (
                              <td className="px-3 py-1 text-right">{m ? m.linkClicks.toLocaleString('pt-BR') : '—'}</td>
                            )}
                            {hasMeta && (
                              <td className="px-3 py-1 text-right text-muted-foreground">
                                {conv != null ? `${conv.toFixed(1)}%` : '—'}
                              </td>
                            )}
                            {hasMeta && (
                              <td className="px-3 py-1 text-right">{m ? m.pageViews.toLocaleString('pt-BR') : '—'}</td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="border-t-2 bg-muted/30 font-semibold">
                      <tr>
                        <td className="px-3 py-1.5 text-xs">Total</td>
                        {hasMeta && (
                          <td className="px-3 py-1.5 text-right">
                            R$ {totSpend.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        )}
                        <td className="px-3 py-1.5 text-right" style={{ color: CHART_COLORS[1] }}>
                          {totLeads.toLocaleString('pt-BR')}
                        </td>
                        {hasMeta && (
                          <td className="px-3 py-1.5 text-right text-muted-foreground">
                            {totLeads > 0 ? `R$ ${(totSpend / totLeads).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                          </td>
                        )}
                        {hasMeta && <td className="px-3 py-1.5 text-right">{totClicks.toLocaleString('pt-BR')}</td>}
                        {hasMeta && (
                          <td className="px-3 py-1.5 text-right text-muted-foreground">
                            {totClicks > 0 ? `${((totLeads / totClicks) * 100).toFixed(1)}%` : '—'}
                          </td>
                        )}
                        {hasMeta && <td className="px-3 py-1.5 text-right">{totPv.toLocaleString('pt-BR')}</td>}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )
          })()}
        </>
      )}

      {/* Estado inicial */}
      {status === 'idle' && !data && (
        <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
          <Search className="h-8 w-8 opacity-30" />
          <p className="text-sm">Digite o prefixo do lançamento e clique em Buscar</p>
          <p className="text-xs opacity-70">Ex: BA25, CB24, MC2025</p>
        </div>
      )}
    </div>
  )
}
