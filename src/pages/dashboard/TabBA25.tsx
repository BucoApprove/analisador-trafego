import { useState, useCallback, useEffect } from 'react'
import type { LaunchData, GoalsData, RawLaunchResponse } from './types'
import {
  SectionHeader, TabLoading, TabError,
  ChartTooltip, CHART_COLORS,
} from './components'
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props { token: string; enabled: boolean }

const FIXED_PREFIX = 'BA25'
const FIXED_SPEND_FILTER = 'BA25'
const FIXED_OR_FILTER = 'instagram,engajamento,lembrete,remarketing'
const FIXED_SINCE = '2026-03-01'

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function makeGetCpl(map: Record<string, number> | undefined) {
  if (!map) return undefined
  return (name: string, leads: number): number | null => {
    const spend = map[name]
    if (spend == null || leads === 0) return null
    return Math.round((spend / leads) * 100) / 100
  }
}

function UtmTable({
  title,
  rows,
  total,
  color,
  hint,
  getCpl,
  cplNote,
}: {
  title: string
  rows: { name: string; value: number }[]
  total: number
  color: string
  hint?: string
  getCpl?: (name: string, leads: number) => number | null
  cplNote?: string
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
              {getCpl && <th className="px-3 py-2 text-right font-medium">CPL</th>}
              <th className="px-3 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(r => {
              const pct = total > 0 ? (r.value / total) * 100 : 0
              const cpl = getCpl ? getCpl(r.name, r.value) : null
              return (
                <tr key={r.name} className="hover:bg-muted/40">
                  <td className="px-3 py-1.5 truncate max-w-[200px] font-medium" title={r.name}>{r.name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.value.toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{pct.toFixed(1)}%</td>
                  {getCpl && (
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {cpl != null
                        ? <span className="font-medium" style={{ color: CHART_COLORS[4] }}>R$ {cpl.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                  )}
                  <td className="px-3 py-1.5">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(r.value / maxVal) * 100}%`, backgroundColor: color }} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {getCpl && cplNote && (
        <p className="mt-1 text-[10px] text-muted-foreground">{cplNote}</p>
      )}
    </div>
  )
}

export default function TabBA25({ token, enabled }: Props) {
  const [since, setSince] = useState(FIXED_SINCE)
  const [until, setUntil] = useState(todayStr)
  const [data, setData] = useState<LaunchData | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [goals, setGoals] = useState<GoalsData | null>(null)

  const loadGoals = useCallback(async () => {
    try {
      const res = await fetch('/api/goals-data', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setGoals(await res.json())
    } catch {
      // silencioso — metas são complementares
    }
  }, [token])

  const load = useCallback(async () => {
    setStatus('loading')
    setErrorMsg(null)
    try {
      const headers = { Authorization: `Bearer ${token}` }
      const bqUrl = `/api/launch-data?prefix=${encodeURIComponent(FIXED_PREFIX)}&since=${since}&until=${until}&broadSearch=true`
      const metaUrl = `/api/meta-spend?since=${since}&until=${until}&spendFilter=${encodeURIComponent(FIXED_SPEND_FILTER)}&orFilter=${encodeURIComponent(FIXED_OR_FILTER)}`

      const t0 = Date.now()
      const [bqRes, metaRes] = await Promise.all([
        fetch(bqUrl, { headers }),
        fetch(metaUrl, { headers }),
      ])
      console.log(`[BA25] BQ: ${bqRes.status} | Meta: ${metaRes.status} | ${Date.now() - t0}ms`)

      if (!bqRes.ok) {
        const body = await bqRes.json().catch(() => ({}))
        throw new Error(`[launch-data ${bqRes.status}] ${body.detail ?? body.error ?? 'sem detalhe'}`)
      }

      const t1 = Date.now()
      const raw: RawLaunchResponse = await bqRes.json()
      console.log(`[BA25] BQ parse: ${Date.now() - t1}ms | rows: ${raw.rows?.length ?? 0}`)

      // ── Processa dados brutos no frontend ──────────────────────────────────
      const sinceDate = since
      const untilDate = until

      // Agrupa por tag: histórico e período
      const tagAll = new Map<string, Set<string>>()
      const tagPeriod = new Map<string, Set<string>>()
      const emailsAll = new Set<string>()
      const emailsPeriod = new Set<string>()
      const dayEmails = new Map<string, Set<string>>()
      const sourceMap = new Map<string, Set<string>>()
      const campaignMap = new Map<string, Set<string>>()
      const mediumMap = new Map<string, Set<string>>()
      const contentMap = new Map<string, Set<string>>()

      const inPeriod = (d: string) => d >= sinceDate && d <= untilDate

      for (const row of raw.rows) {
        const email = row.lead_email
        const tag = row.tag_name ?? ''
        const date = row.date?.slice(0, 10) ?? ''
        if (!email) continue

        emailsAll.add(email)
        if (tag) {
          if (!tagAll.has(tag)) tagAll.set(tag, new Set())
          tagAll.get(tag)!.add(email)
        }

        if (date && inPeriod(date)) {
          emailsPeriod.add(email)
          if (tag) {
            if (!tagPeriod.has(tag)) tagPeriod.set(tag, new Set())
            tagPeriod.get(tag)!.add(email)
          }
          // primeiro dia do lead no período
          const prev = dayEmails.get(date)
          if (!prev) dayEmails.set(date, new Set())
          dayEmails.get(date)!.add(email)

          const addUtm = (map: Map<string, Set<string>>, val: string | null) => {
            const k = val ?? ''
            if (!map.has(k)) map.set(k, new Set())
            map.get(k)!.add(email)
          }
          addUtm(sourceMap, row.utm_source)
          addUtm(campaignMap, row.utm_campaign)
          addUtm(mediumMap, row.utm_medium)
          addUtm(contentMap, row.utm_content)
        }
      }

      const mapToArr = (m: Map<string, Set<string>>, label: string, limit = 15) =>
        [...m.entries()]
          .map(([name, s]) => ({ name: name || label, value: s.size }))
          .sort((a, b) => b.value - a.value)
          .slice(0, limit)

      const byTag = [...tagAll.entries()].map(([tag, s]) => ({
        tag,
        countAll: s.size,
        countPeriod: tagPeriod.get(tag)?.size ?? 0,
      })).sort((a, b) => b.countAll - a.countAll)

      const totalUniqueAll = emailsAll.size
      const totalUnique = emailsPeriod.size
      const sumByTag = byTag.reduce((s, t) => s + t.countAll, 0)
      const overlap = sumByTag - totalUniqueAll

      const leadsByDay = [...dayEmails.entries()]
        .map(([date, s]) => ({ date, count: s.size }))
        .sort((a, b) => a.date.localeCompare(b.date))

      const processed: LaunchData = {
        prefix: raw.prefix,
        byTag,
        totalUniqueAll,
        totalUnique,
        sumByTag,
        overlap,
        leadsByDay,
        bySource: mapToArr(sourceMap, '(direto)'),
        byCampaign: mapToArr(campaignMap, '(sem campanha)'),
        byMedium: mapToArr(mediumMap, '(não informado)'),
        byContent: mapToArr(contentMap, '(não informado)'),
        byTerm: [],
        dateRange: { since, until },
      }
      // ──────────────────────────────────────────────────────────────────────

      if (metaRes.ok) {
        const metaData = await metaRes.json()
        const cpl = totalUnique > 0 && metaData.metaSpend > 0
          ? Math.round((metaData.metaSpend / totalUnique) * 100) / 100
          : null
        setData({ ...processed, ...metaData, cpl })
      } else {
        const metaBody = await metaRes.json().catch(() => ({}))
        console.warn(`[BA25] Meta falhou ${metaRes.status}:`, metaBody)
        setData(processed)
      }

      setStatus('idle')
    } catch (e) {
      setStatus('error')
      setErrorMsg((e as Error).message)
    }
  }, [since, until, token])

  // Auto-load quando a aba fica ativa
  useEffect(() => {
    if (enabled) {
      load()
      loadGoals()
    }
  }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  const maxTagCount = data ? Math.max(...data.byTag.map(t => t.countAll), 1) : 1

  return (
    <div className="space-y-6">

      {/* Cabeçalho fixo com controles de data */}
      <div className="rounded-lg border bg-card p-4">
        <SectionHeader
          title="BA25 — Lançamento Bolsa Aprígio 2025"
          description="Análise completa do lançamento BA25. Inclui todos os leads captados via tags BA25 e campanhas Meta Ads com filtro BA25 + CAPTURA."
        />
        <div className="flex flex-wrap items-end gap-3 mt-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">De</label>
            <input
              type="date"
              value={since}
              onChange={e => setSince(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
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
            onClick={load}
            disabled={status === 'loading'}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${status === 'loading' ? 'animate-spin' : ''}`} />
            {status === 'loading' ? 'Carregando…' : 'Atualizar'}
          </button>
          <div className="flex gap-2 ml-auto text-xs text-muted-foreground items-center">
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono">Prefixo: {FIXED_PREFIX}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono">Meta: todas campanhas BA25</span>
            <span className="rounded-full bg-muted px-2 py-0.5">Busca ampliada ✓</span>
          </div>
        </div>
      </div>

      {status === 'loading' && <TabLoading />}
      {status === 'error' && <TabError message={errorMsg ?? 'Erro ao carregar'} onRetry={load} />}

      {status === 'idle' && data && (
        <>
          {/* KPIs + Tags + Gráfico */}
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-x-4 px-4 py-2 border-b bg-muted/40">
              <span className="text-sm font-semibold">
                Lançamento: <span style={{ color: CHART_COLORS[1] }}>BA25</span>
              </span>
              <span className="text-xs text-muted-foreground">{data.dateRange.since} → {data.dateRange.until}</span>
            </div>

            <div className="flex flex-wrap gap-px border-b">
              {([
                { label: 'Total leads', value: data.totalUniqueAll.toLocaleString('pt-BR'), color: CHART_COLORS[1], sub: 'histórico (tags + UTM)' },
                { label: 'No período', value: data.totalUnique.toLocaleString('pt-BR'), color: CHART_COLORS[0], sub: data.dateRange.since + ' → ' + data.dateRange.until },
                { label: 'Soma bruta', value: data.sumByTag.toLocaleString('pt-BR'), color: '#888', sub: 'c/ duplicatas (tags)' },
                { label: 'Sobreposição', value: data.overlap > 0 ? data.overlap.toLocaleString('pt-BR') : '0', color: data.overlap > 0 ? '#c17c74' : '#7c9885', sub: 'em múltiplas tags' },
              ] as const).map(s => (
                <div key={s.label} className="flex-1 min-w-[100px] px-4 py-2">
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  <p className="text-lg font-bold tabular-nums leading-tight" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-[9px] text-muted-foreground truncate">{s.sub}</p>
                </div>
              ))}
            </div>

            <div className="grid lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x">
              {/* Tags */}
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

              {/* Gráfico */}
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

          {/* Meta Ads spend */}
          {data.metaSpend !== undefined && (() => {
            const brl2 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            const campaigns = data.metaCampaigns ?? []

            // Gasto Captura: campanhas com ba25 E captura, sem engajamento
            const gastoCaptura = campaigns
              .filter(c => { const n = c.name.toLowerCase(); return n.includes('ba25') && n.includes('captura') && !n.includes('engajamento') })
              .reduce((s, c) => s + c.spend, 0)

            const leadsCaptura = data.byTag.find(t => t.tag === 'BA25-Captura-Tráfego')?.countPeriod ?? 0
            const totalLeads = data.totalUnique

            const cpl  = totalLeads > 0 && gastoCaptura > 0 ? gastoCaptura / totalLeads : null
            const cplc = leadsCaptura > 0 && gastoCaptura > 0 ? gastoCaptura / leadsCaptura : null

            return (
              <div className="rounded-lg border bg-card overflow-hidden">
                <div className="flex flex-wrap gap-px">
                  {[
                    { label: 'Gasto Meta Ads', value: `R$ ${brl2(data.metaSpend)}`, sub: `${campaigns.length} campanha(s)`, color: CHART_COLORS[3] },
                    { label: 'Gasto Captura', value: `R$ ${brl2(gastoCaptura)}`, sub: 'BA25 + Captura, sem Engajamento', color: CHART_COLORS[0] },
                    { label: 'CPL', value: cpl != null ? `R$ ${brl2(cpl)}` : '—', sub: 'gasto captura ÷ total leads', color: CHART_COLORS[4] },
                    { label: 'CPLC', value: cplc != null ? `R$ ${brl2(cplc)}` : '—', sub: 'gasto captura ÷ leads captura', color: CHART_COLORS[2] },
                  ].map(k => (
                    <div key={k.label} className="flex-1 min-w-[140px] px-4 py-3">
                      <p className="text-[10px] text-muted-foreground">{k.label}</p>
                      <p className="text-lg font-bold tabular-nums leading-tight" style={{ color: k.color }}>{k.value}</p>
                      <p className="text-[9px] text-muted-foreground">{k.sub}</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Metas × Realizado */}
          {goals && (() => {
            // Leads realizados por tag exata (metas de leads)
            function leadsForTag(tag: string) {
              return data!.byTag.find(t => t.tag === tag)?.countPeriod ?? 0
            }
            const leadsTrafico  = leadsForTag('BA25-Captura-Tráfego')
            const leadsOrganico = leadsForTag('BA25-Captura-Orgânico')
            const leadsManychat = leadsForTag('BA25-Captura-Manychat')
            const totalLeadsRealizados = leadsTrafico + leadsOrganico + leadsManychat
            const totalMetaLeads = goals.metaLeadsTrafico + goals.metaLeadsOrganico + goals.metaLeadsManychat

            // Gasto por fase: filtragem composta case-insensitive sobre utm_campaign
            function spendFor(predicate: (name: string) => boolean) {
              if (!data!.spendByUtm?.campaign) return null
              return Object.entries(data!.spendByUtm.campaign)
                .filter(([k]) => predicate(k.toLowerCase()))
                .reduce((s, [, v]) => s + v, 0)
            }

            // Leads por tag keyword (coluna "Leads (tag)" da tabela de fases)
            function leadsForKeyword(keyword: string) {
              return data!.byTag
                .filter(t => t.tag.toLowerCase().includes(keyword.toLowerCase()))
                .reduce((s, t) => s + t.countPeriod, 0)
            }

            const fases = [
              {
                label: 'Captura',
                keyword: goals.tagsReferencia.captura,
                orcamento: goals.orcamentoPorFase.captura,
                leads: leadsForKeyword(goals.tagsReferencia.captura),
                spendFn: (k: string) => k.includes('ba25') && k.includes('captura') && !k.includes('engajamento'),
              },
              {
                label: 'Descoberta',
                keyword: goals.tagsReferencia.descoberta,
                orcamento: goals.orcamentoPorFase.descoberta,
                leads: leadsForKeyword(goals.tagsReferencia.descoberta),
                spendFn: (k: string) => k.includes('instagram'),
              },
              {
                label: 'Aquecimento',
                keyword: goals.tagsReferencia.aquecimento,
                orcamento: goals.orcamentoPorFase.aquecimento,
                leads: leadsForKeyword(goals.tagsReferencia.aquecimento),
                spendFn: (k: string) => k.includes('engajamento'),
              },
              {
                label: 'Lembrete',
                keyword: goals.tagsReferencia.lembrete,
                orcamento: goals.orcamentoPorFase.lembrete,
                leads: leadsForKeyword(goals.tagsReferencia.lembrete),
                spendFn: (k: string) => k.includes('lembrete'),
              },
              {
                label: 'Remarketing',
                keyword: goals.tagsReferencia.remarketing,
                orcamento: goals.orcamentoPorFase.remarketing,
                leads: leadsForKeyword(goals.tagsReferencia.remarketing),
                spendFn: (k: string) => k.includes('remarketing'),
              },
            ]

            const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            const pct = (real: number, meta: number) => meta > 0 ? Math.min((real / meta) * 100, 999) : 0

            function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
              const p = Math.min((value / Math.max(max, 1)) * 100, 100)
              return (
                <div className="h-1.5 rounded-full bg-muted overflow-hidden w-full">
                  <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, backgroundColor: color }} />
                </div>
              )
            }

            function StatusBadge({ value, max }: { value: number; max: number }) {
              const p = max > 0 ? (value / max) * 100 : 0
              if (p >= 100) return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Atingido</span>
              if (p >= 70) return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">Em curso</span>
              return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Abaixo</span>
            }

            // Dias restantes até fim da captação (inclusive hoje)
            const parseFinalDate = (s: string) => {
              const [d, m, y] = s.split('/').map(Number)
              return new Date(y, m - 1, d)
            }
            const today = new Date(); today.setHours(0,0,0,0)
            const finalDate = parseFinalDate(goals.finalCaptacao)
            const diasRestantes = Math.max(1, Math.ceil((finalDate.getTime() - today.getTime()) / 86400000) + 1)

            return (
              <div className="space-y-4">
                <SectionHeader
                  title="Metas × Realizado"
                  description={`Planilha de metas: ${goals.inicioCaptacao} → ${goals.finalCaptacao} · ${diasRestantes} dia(s) restante(s)`}
                />

                {/* Leads: metas gerais */}
                <div className="rounded-lg border bg-card overflow-hidden">
                  <div className="px-4 py-2 border-b bg-muted/40">
                    <p className="text-xs font-semibold">Metas de Leads</p>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-xs">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Categoria</th>
                        <th className="px-3 py-2 text-right font-medium">Meta</th>
                        <th className="px-3 py-2 text-right font-medium">Realizado</th>
                        <th className="px-3 py-2 text-right font-medium">%</th>
                        <th className="px-3 py-2 text-right font-medium">Faltam</th>
                        <th className="px-3 py-2 text-right font-medium">Meta/dia</th>
                        <th className="px-3 py-2 w-28"></th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {[
                        { label: 'Total (tráfego + orgânico + manychat)', meta: totalMetaLeads, real: totalLeadsRealizados, color: CHART_COLORS[0] },
                        { label: 'Tráfego pago (Meta Ads)', meta: goals.metaLeadsTrafico, real: leadsTrafico, color: CHART_COLORS[1] },
                        { label: 'Orgânico', meta: goals.metaLeadsOrganico, real: leadsOrganico, color: CHART_COLORS[2] },
                        { label: 'ManyChat', meta: goals.metaLeadsManychat, real: leadsManychat, color: CHART_COLORS[3] },
                      ].map(row => (
                        <tr key={row.label} className="hover:bg-muted/40">
                          <td className="px-3 py-2 font-medium">{row.label}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.meta.toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: row.color }}>{row.real.toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{pct(row.real, row.meta).toFixed(1)}%</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {row.real >= row.meta ? <span className="text-green-600 dark:text-green-400">—</span> : (row.meta - row.real).toLocaleString('pt-BR')}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.real >= row.meta
                              ? <span className="text-green-600 dark:text-green-400">—</span>
                              : <span className="font-medium" style={{ color: row.color }}>{Math.ceil((row.meta - row.real) / diasRestantes).toLocaleString('pt-BR')}/dia</span>}
                          </td>
                          <td className="px-3 py-2"><ProgressBar value={row.real} max={row.meta} color={row.color} /></td>
                          <td className="px-3 py-2"><StatusBadge value={row.real} max={row.meta} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Orçamento por fase */}
                <div className="rounded-lg border bg-card overflow-hidden">
                  <div className="px-4 py-2 border-b bg-muted/40">
                    <p className="text-xs font-semibold">Orçamento por Fase × Gasto Real (Meta Ads)</p>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-xs">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Fase</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Tag/Campanha</th>
                        <th className="px-3 py-2 text-right font-medium">Orçamento</th>
                        <th className="px-3 py-2 text-right font-medium">Investido</th>
                        <th className="px-3 py-2 text-right font-medium">%</th>
                        <th className="px-3 py-2 text-right font-medium">Leads (tag)</th>
                        <th className="px-3 py-2 text-right font-medium">CPL</th>
                        <th className="px-3 py-2 w-24"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {fases.map((fase, i) => {
                        const gasto = spendFor(fase.spendFn) ?? 0
                        const cplFase = gasto > 0 && fase.leads > 0 ? gasto / fase.leads : null
                        return (
                          <tr key={fase.label} className="hover:bg-muted/40">
                            <td className="px-3 py-2 font-medium">{fase.label}</td>
                            <td className="px-3 py-2 text-muted-foreground text-xs font-mono">{fase.keyword}</td>
                            <td className="px-3 py-2 text-right tabular-nums">R$ {brl(fase.orcamento)}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}>
                              {data!.spendByUtm?.campaign ? `R$ ${brl(gasto)}` : '—'}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {data!.spendByUtm?.campaign ? `${pct(gasto, fase.orcamento).toFixed(1)}%` : '—'}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{fase.leads > 0 ? fase.leads.toLocaleString('pt-BR') : <span className="text-muted-foreground">0</span>}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {cplFase != null ? `R$ ${brl(cplFase)}` : '—'}
                            </td>
                            <td className="px-3 py-2">
                              {data!.spendByUtm?.campaign && <ProgressBar value={gasto} max={fase.orcamento} color={CHART_COLORS[i % CHART_COLORS.length]} />}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="border-t-2 bg-muted/30 font-semibold text-xs">
                      <tr>
                        <td className="px-3 py-2" colSpan={2}>Total</td>
                        <td className="px-3 py-2 text-right tabular-nums">R$ {brl(goals.orcamentoTotal)}</td>
                        <td className="px-3 py-2 text-right tabular-nums" style={{ color: CHART_COLORS[0] }}>
                          {data!.metaSpend !== undefined ? `R$ ${brl(data!.metaSpend)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {data!.metaSpend !== undefined ? `${pct(data!.metaSpend, goals.orcamentoTotal).toFixed(1)}%` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{data!.totalUnique.toLocaleString('pt-BR')}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {data!.cpl != null ? `R$ ${brl(data!.cpl)}` : '—'}
                        </td>
                        <td className="px-3 py-2" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )
          })()}

          {/* UTM breakdown */}
          <div>
            <SectionHeader
              title="Análise de UTMs"
              description="Leads únicos no período por canal, público, campanha e criativo. A coluna CPL usa o gasto real do anúncio via Meta Ads API."
            />
            <div className="grid gap-6 lg:grid-cols-2">
              {data.bySource.length > 0 && (
                <UtmTable
                  title="Fonte (utm_source)"
                  rows={data.bySource}
                  total={data.totalUnique}
                  color={CHART_COLORS[0]}
                  getCpl={makeGetCpl(data.spendByUtm?.source)}
                  cplNote="CPL calculado a partir do gasto real dos anúncios com esse utm_source no período."
                />
              )}
              {data.byMedium.length > 0 && (
                <UtmTable
                  title="Público (utm_medium)"
                  rows={data.byMedium}
                  total={data.totalUnique}
                  color={CHART_COLORS[1]}
                  hint="No BA25 corresponde ao nome do conjunto de anúncios (adset), ex: Env7d_Visitantes180d."
                  getCpl={makeGetCpl(data.spendByUtm?.medium)}
                  cplNote="CPL calculado a partir do gasto real por conjunto de anúncios (adset) no período."
                />
              )}
              {data.byCampaign.length > 0 && (
                <UtmTable
                  title="Campanha (utm_campaign)"
                  rows={data.byCampaign}
                  total={data.totalUnique}
                  color={CHART_COLORS[2]}
                  getCpl={makeGetCpl(data.spendByUtm?.campaign)}
                  cplNote="CPL calculado a partir do gasto real da campanha no período."
                />
              )}
              {data.byContent.filter(r => r.name !== '(não informado)').length > 0 && (
                <UtmTable
                  title="Criativo (utm_content)"
                  rows={data.byContent}
                  total={data.totalUnique}
                  color={CHART_COLORS[3]}
                  hint="No BA25 corresponde ao nome do anúncio (ad), ex: BA25_Ad_Captura_22."
                  getCpl={makeGetCpl(data.spendByUtm?.content)}
                  cplNote="CPL calculado a partir do gasto real por anúncio no período."
                />
              )}
            </div>
          </div>

          {/* Evolução diária */}
          {(data.leadsByDay.length > 0 || (data.dailyMeta?.length ?? 0) > 0) && (() => {
            const leadsMap = new Map(data.leadsByDay.map(d => [d.date, d.count]))
            const metaMap = new Map((data.dailyMeta ?? []).map(d => [d.date, d]))
            const allDates = [...new Set([...leadsMap.keys(), ...metaMap.keys()])].sort()
            const hasMeta = (data.dailyMeta?.length ?? 0) > 0

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

          {/* Lista de campanhas */}
          {(data.metaCampaigns?.length ?? 0) > 0 && (
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="px-4 py-2 border-b bg-muted/40">
                <p className="text-xs font-semibold">Campanhas Meta Ads</p>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="px-3 py-1 text-left font-medium">Campanha</th>
                    <th className="px-3 py-1 text-right font-medium">Gasto</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.metaCampaigns!.map(c => (
                    <tr key={c.name + c.spend} className="hover:bg-muted/40">
                      <td className="px-3 py-1">{c.name}</td>
                      <td className="px-3 py-1 text-right tabular-nums">
                        R$ {c.spend.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
