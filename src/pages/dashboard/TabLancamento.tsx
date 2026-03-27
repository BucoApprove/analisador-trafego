import { useState, useCallback, useEffect } from 'react'
import type { LaunchData, TagsListData } from './types'
import {
  KpiCard, SectionHeader, TabLoading, TabError,
  formatPercent, ChartTooltip, CHART_COLORS,
} from './components'
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { Search, AlertTriangle, Info } from 'lucide-react'

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
          {/* KPI principal */}
          <div>
            <SectionHeader
              title={`Lançamento: ${data.prefix}`}
              description={`${data.dateRange.since} → ${data.dateRange.until}`}
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Total leads únicos"
                value={data.totalUnique.toLocaleString('pt-BR')}
                color={CHART_COLORS[1]}
                sub="deduplicados entre todas as tags"
              />
              <KpiCard
                label="Tags encontradas"
                value={data.byTag.length}
                color={CHART_COLORS[0]}
              />
              <KpiCard
                label="Soma bruta (c/ duplicatas)"
                value={data.sumByTag.toLocaleString('pt-BR')}
                color="#888"
                sub="contando o mesmo lead em cada tag"
              />
              <KpiCard
                label="Sobreposição"
                value={data.overlap > 0 ? data.overlap.toLocaleString('pt-BR') : '0'}
                color={data.overlap > 0 ? '#c17c74' : '#7c9885'}
                sub="leads em mais de uma tag"
              />
            </div>

            {/* CPL row — só aparece quando spendFilter foi usado */}
            {data.metaSpend !== undefined && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <KpiCard
                  label="Gasto Meta Ads"
                  value={`R$ ${data.metaSpend.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  color={CHART_COLORS[3]}
                  sub={`${data.metaCampaigns?.length ?? 0} campanha(s) encontrada(s)`}
                />
                <KpiCard
                  label="CPL (custo por lead)"
                  value={
                    data.cpl != null
                      ? `R$ ${data.cpl.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : '—'
                  }
                  color={CHART_COLORS[4]}
                  sub="gasto ÷ leads únicos no período"
                />
                {data.metaSpend === 0 && (
                  <div className="flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Nenhuma campanha encontrada com os termos informados. Verifique o filtro ou o período.
                  </div>
                )}
              </div>
            )}

            {/* Lista das campanhas que casaram */}
            {(data.metaCampaigns?.length ?? 0) > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Campanhas incluídas no cálculo:</p>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-medium">Campanha</th>
                        <th className="px-3 py-1.5 text-right font-medium">Gasto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.metaCampaigns!.map(c => (
                        <tr key={c.name} className="hover:bg-muted/50">
                          <td className="px-3 py-1.5">{c.name}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            R$ {c.spend.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Detalhamento por tag */}
          <div>
            <SectionHeader
              title="Leads únicos por tag"
              description="Cada tag conta seus próprios leads únicos, independentemente. A soma pode ser maior que o total único por causa da sobreposição."
            />

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Tag</th>
                    <th className="px-4 py-2 text-right font-medium w-28">No período</th>
                    <th className="px-4 py-2 text-right font-medium w-24">Histórico</th>
                    <th className="px-4 py-2 text-right font-medium w-20">% período</th>
                    <th className="px-4 py-2 text-left font-medium">Distribuição (histórico)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.byTag.map((t, i) => (
                    <tr key={t.tag} className="hover:bg-muted/50">
                      <td className="px-4 py-3 font-medium">{t.tag}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {t.countPeriod > 0
                          ? t.countPeriod.toLocaleString('pt-BR')
                          : <span className="text-muted-foreground">0</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {t.countAll.toLocaleString('pt-BR')}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {data.totalUnique > 0 && t.countPeriod > 0
                          ? formatPercent((t.countPeriod / data.totalUnique) * 100)
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${(t.countAll / maxTagCount) * 100}%`,
                              backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}

                  {/* Linha de soma + sobreposição */}
                  <tr className="bg-muted/30 font-medium">
                    <td className="px-4 py-2 text-muted-foreground">Soma bruta (período)</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {data.sumByTag.toLocaleString('pt-BR')}
                    </td>
                    <td colSpan={3} />
                  </tr>
                  {data.overlap > 0 && (
                    <tr className="text-destructive/80">
                      <td className="px-4 py-2 flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Sobreposição (leads em múltiplas tags)
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        -{data.overlap.toLocaleString('pt-BR')}
                      </td>
                      <td colSpan={3} />
                    </tr>
                  )}
                  <tr className="border-t-2 font-bold text-base">
                    <td className="px-4 py-2">Total único (período)</td>
                    <td className="px-4 py-2 text-right tabular-nums" style={{ color: CHART_COLORS[1] }}>
                      {data.totalUnique.toLocaleString('pt-BR')}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tbody>
              </table>
            </div>

            {data.overlap > 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {data.overlap.toLocaleString('pt-BR')} leads aparecem em mais de uma tag. O total único ({data.totalUnique.toLocaleString('pt-BR')}) usa <strong>DISTINCT lead_id</strong> para evitar essa contagem dupla.
              </p>
            )}
          </div>

          {/* Gráfico de leads por dia */}
          {data.leadsByDay.length > 0 && (
            <div>
              <SectionHeader
                title="Captação diária (leads únicos)"
                description="Data do primeiro registro do lead em qualquer tag deste lançamento."
              />
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data.leadsByDay}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickFormatter={v => v.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="count"
                    name="Leads"
                    stroke={CHART_COLORS[1]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
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
