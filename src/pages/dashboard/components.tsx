import { Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

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
