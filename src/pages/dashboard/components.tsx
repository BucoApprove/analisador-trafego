import { useState } from 'react'
import { Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { UtmSalesAttribution, BA25ProfileEntry } from './types'

// ─── Paleta de cores ──────────────────────────────────────────────────────────
export const CHART_COLORS = ['#d4a853', '#7c9885', '#5b8fb9', '#c17c74', '#9b7cc1', '#6b8e8e']

// ─── KPI Card ─────────────────────────────────────────────────────────────────
interface KpiCardProps {
  label: string
  value: string | number
  sub?: string
  color?: string
}

export function KpiCard({ label, value, sub, color = '#d4a853' }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          {label}
        </p>
        <p className="text-3xl font-bold tracking-tight" style={{ color }}>
          {value}
        </p>
        {sub && <p className="mt-2 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}

// ─── Section Header ───────────────────────────────────────────────────────────
interface SectionHeaderProps {
  title: string
  description?: string
}

export function SectionHeader({ title, description }: SectionHeaderProps) {
  return (
    <div className="mb-5">
      <h2 className="text-base font-bold tracking-tight">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      )}
    </div>
  )
}

// ─── Health Banner ────────────────────────────────────────────────────────────
interface HealthBannerProps {
  messages: string[]
}

export function HealthBanner({ messages }: HealthBannerProps) {
  if (!messages.length) return null
  return (
    <div className="mb-5 flex items-start gap-3 rounded-2xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <ul className="list-disc space-y-1 pl-3">
        {messages.map((m, i) => <li key={i}>{m}</li>)}
      </ul>
    </div>
  )
}

// ─── Tab Loading ──────────────────────────────────────────────────────────────
export function TabLoading() {
  return (
    <div className="flex h-72 items-center justify-center">
      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground/50" />
    </div>
  )
}

// ─── Tab Error ────────────────────────────────────────────────────────────────
interface TabErrorProps {
  message: string
  onRetry?: () => void
}

export function TabError({ message, onRetry }: TabErrorProps) {
  return (
    <div className="flex h-72 flex-col items-center justify-center gap-3 text-center px-6">
      <div className="h-12 w-12 rounded-2xl bg-destructive/10 flex items-center justify-center">
        <AlertTriangle className="h-6 w-6 text-destructive" />
      </div>
      <p className="text-sm text-muted-foreground max-w-xs">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          Tentar novamente
        </Button>
      )}
    </div>
  )
}

// ─── Chart Tooltip ────────────────────────────────────────────────────────────
interface ChartTooltipProps {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: string
  formatter?: (value: number) => string
}

export function ChartTooltip({ active, payload, label, formatter }: ChartTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border bg-card px-3 py-2 text-sm shadow-lg">
      {label && <p className="mb-1.5 font-semibold text-xs text-muted-foreground">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}:{' '}
          <span className="font-bold">
            {formatter ? formatter(entry.value) : entry.value}
          </span>
        </p>
      ))}
    </div>
  )
}

// ─── Formatadores ─────────────────────────────────────────────────────────────
export function formatBRL(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

export function formatPercent(value: number, decimals = 1) {
  return `${value.toFixed(decimals)}%`
}

// ─── UtmTable ─────────────────────────────────────────────────────────────────

export function UtmTable({
  title,
  rows,
  total,
  color,
  hint,
  getCpl,
  cplNote,
  getCpv,
  getCpvMeta,
  salesRows,
  totalBuyers,
}: {
  title: string
  rows: { name: string; value: number }[]
  total: number
  color: string
  hint?: string
  getCpl?: (name: string, leads: number) => number | null
  cplNote?: string
  getCpv?: (name: string) => number | null     // CPV cruzado: gasto ÷ vendas com lead
  getCpvMeta?: (name: string) => number | null  // CPV Meta: gasto ÷ compras atribuídas pelo Meta
  salesRows?: UtmSalesAttribution[]
  totalBuyers?: number
}) {
  const [filter, setFilter] = useState('')
  const filtered = filter ? rows.filter(r => r.name.toLowerCase().includes(filter.toLowerCase())) : rows
  const maxVal = Math.max(...rows.map(r => r.value), 1)
  const hasSales = salesRows && salesRows.length > 0

  const salesMap = new Map<string, UtmSalesAttribution>()
  if (salesRows) {
    for (const s of salesRows) salesMap.set(s.name.toLowerCase(), s)
  }

  return (
    <div>
      <SectionHeader title={title} description={hint} />
      {hasSales && totalBuyers != null && (
        <p className="mb-1 text-[10px] text-muted-foreground">
          {totalBuyers} comprador(es) encontrado(s) no período
          {' · '}
          <span title="Em algum momento tiveram essa UTM">Todos</span>
          {' / '}
          <span title="Última UTM registrada antes da compra">Última UTM</span>
          {' / '}
          <span title="UTM de origem do lead na base">Origem</span>
        </p>
      )}
      <div className="mb-2">
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filtrar..."
          className="w-full rounded-md border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Valor</th>
              <th className="px-3 py-2 text-right font-medium">Leads</th>
              <th className="px-3 py-2 text-right font-medium">%</th>
              {getCpl && <th className="px-3 py-2 text-right font-medium">CPL</th>}
              {hasSales && (
                <th className="px-3 py-2 text-right font-medium text-xs" title="Vendas: Qualquer interação / Última UTM antes da compra / UTM de origem">
                  Vendas
                </th>
              )}
              {getCpv && <th className="px-3 py-2 text-right font-medium" title="CPV cruzado: gasto da UTM ÷ vendas com lead atribuído">CPV</th>}
              {getCpvMeta && <th className="px-3 py-2 text-right font-medium" title="CPV Meta: gasto da UTM ÷ compras atribuídas pelo Meta (cobre venda direta)">CPV Meta</th>}
              <th className="px-3 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map(r => {
              const pct = total > 0 ? (r.value / total) * 100 : 0
              const cpl = getCpl ? getCpl(r.name, r.value) : null
              const cpv = getCpv ? getCpv(r.name) : null
              const cpvMeta = getCpvMeta ? getCpvMeta(r.name) : null
              const sales = hasSales ? salesMap.get(r.name.toLowerCase()) : null
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
                  {hasSales && (
                    <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                      {sales
                        ? (
                          <span className="inline-flex items-center gap-1 text-xs">
                            <span className="font-semibold" style={{ color: CHART_COLORS[0] }} title="Em algum momento tiveram essa UTM">{sales.anyTime}</span>
                            <span className="text-muted-foreground">/</span>
                            <span className="font-semibold" style={{ color: CHART_COLORS[2] }} title="Última UTM antes da compra">{sales.lastBefore}</span>
                            <span className="text-muted-foreground">/</span>
                            <span className="font-semibold" style={{ color: CHART_COLORS[3] }} title="UTM de origem">{sales.origin}</span>
                          </span>
                        )
                        : <span className="text-muted-foreground">— / — / —</span>}
                    </td>
                  )}
                  {getCpv && (
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {cpv != null
                        ? <span className="font-medium" style={{ color: CHART_COLORS[3] }}>R$ {cpv.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                  )}
                  {getCpvMeta && (
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {cpvMeta != null
                        ? <span className="font-medium" style={{ color: CHART_COLORS[0] }}>R$ {cpvMeta.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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

// ─── RevenueTable ─────────────────────────────────────────────────────────────

export function RevenueTable({
  rows,
  spendMap,
  leadsMap,
}: {
  rows: BA25ProfileEntry[]
  spendMap?: Record<string, number>
  leadsMap?: Record<string, number>
}) {
  const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const hasSpend = spendMap && Object.keys(spendMap).length > 0

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/60">
          <tr>
            <th className="px-3 py-2 text-left font-medium">UTM</th>
            <th className="px-3 py-2 text-right font-medium">Vendas</th>
            <th className="px-3 py-2 text-right font-medium">Receita</th>
            <th className="px-3 py-2 text-right font-medium">Ticket Médio</th>
            {hasSpend && <th className="px-3 py-2 text-right font-medium">Investido</th>}
            {hasSpend && <th className="px-3 py-2 text-right font-medium">ROAS</th>}
            {hasSpend && leadsMap && <th className="px-3 py-2 text-right font-medium">CPL</th>}
            {hasSpend && <th className="px-3 py-2 text-right font-medium">CPV</th>}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(r => {
            const spend  = spendMap?.[r.name] ?? null
            const leads  = leadsMap?.[r.name] ?? null
            const roas   = spend != null && spend > 0 && r.revenue > 0 ? r.revenue / spend : null
            const cpl    = spend != null && leads != null && leads > 0 ? spend / leads : null
            const cpv    = spend != null && spend > 0 && r.buyers > 0 ? spend / r.buyers : null
            const roasColor = roas == null ? undefined : roas >= 3 ? CHART_COLORS[1] : roas >= 1.5 ? CHART_COLORS[2] : '#c17c74'
            return (
              <tr key={r.name} className="hover:bg-muted/40">
                <td className="px-3 py-1.5 font-medium truncate max-w-[220px]" title={r.name}>{r.name}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.buyers}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: CHART_COLORS[1] }}>
                  R$ {brl(r.revenue)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">R$ {brl(r.avgTicket)}</td>
                {hasSpend && (
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {spend != null ? `R$ ${brl(spend)}` : '—'}
                  </td>
                )}
                {hasSpend && (
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: roasColor }}>
                    {roas != null ? `${roas.toFixed(2)}x` : '—'}
                  </td>
                )}
                {hasSpend && leadsMap && (
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {cpl != null ? `R$ ${brl(cpl)}` : '—'}
                  </td>
                )}
                {hasSpend && (
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {cpv != null ? `R$ ${brl(cpv)}` : '—'}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
