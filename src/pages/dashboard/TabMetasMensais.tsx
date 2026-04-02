import { useState, useCallback, useEffect } from 'react'
import { RefreshCw, ChevronDown, ChevronUp, ClipboardList, X, ExternalLink, MessageSquare, Plus, Link2, FileText, ChevronRight } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props { token: string; enabled: boolean }
interface GoalItem { name: string; meta: number }
interface MonthlyGoalsResp { month: string; goals: GoalItem[]; totalMeta: number; configured: boolean }
interface HotmartProduct { id: number; name: string; total: number; count: number }
interface HotmartResp { month: string; products: HotmartProduct[]; grandTotal: number; totalTransactions: number }

// ─── Static mock data (será substituído por DB) ───────────────────────────────

interface ActivityLink { label: string; url: string; type: 'drive' | 'sheet' | 'link' }
interface ActivityComment { author: string; date: string; text: string }
interface Activity {
  id: string
  title: string
  description: string
  status: 'pendente' | 'em andamento' | 'concluída'
  links: ActivityLink[]
  comments: ActivityComment[]
}

const MOCK_ACTIVITIES: Record<string, Activity[]> = {
  'Buco Approve': [
    {
      id: 'ba-1',
      title: 'Estratégia de precificação BA25',
      description: 'Definir as ofertas e preços para o lançamento BA25. Incluir versões parceladas e à vista, além de order bumps e upsells planejados para o período.',
      status: 'concluída',
      links: [
        { label: 'Planilha de precificação', url: '#', type: 'sheet' },
        { label: 'Apresentação de ofertas', url: '#', type: 'drive' },
      ],
      comments: [
        { author: 'Gustavo', date: '28/03/2026', text: 'Ofertas definidas: R$930 (pix), R$1.585 (6x), R$2.243 (12x). Order bump: Etapa Final por R$47.' },
        { author: 'Bianco', date: '29/03/2026', text: 'Aprovado. Subir na Hotmart até 30/03.' },
      ],
    },
    {
      id: 'ba-2',
      title: 'Follow-up pós-webinar',
      description: 'Sequência de e-mails e mensagens de follow-up para leads que assistiram ao webinar mas não converteram. Incluir quebras de objeção e depoimentos.',
      status: 'em andamento',
      links: [
        { label: 'Sequência de e-mails', url: '#', type: 'drive' },
      ],
      comments: [
        { author: 'Bianco', date: '01/04/2026', text: 'Primeira sequência disparada. Taxa de abertura 42%. Aguardando resultado das próximas 48h.' },
      ],
    },
    {
      id: 'ba-3',
      title: 'Página de vendas — revisão final',
      description: 'Revisar copy, depoimentos e CTAs da página de vendas antes do lançamento. Checar versão mobile e velocidade de carregamento.',
      status: 'concluída',
      links: [
        { label: 'Página de vendas', url: '#', type: 'link' },
        { label: 'Checklist de revisão', url: '#', type: 'sheet' },
      ],
      comments: [
        { author: 'Gustavo', date: '27/03/2026', text: 'Revisão concluída. 3 depoimentos adicionados, CTA do hero atualizado.' },
      ],
    },
    {
      id: 'ba-4',
      title: 'Recuperação de carrinho abandonado',
      description: 'Configurar automação de recuperação para quem iniciou o checkout mas não finalizou. Meta: recuperar 10% dos carrinhos abandonados.',
      status: 'pendente',
      links: [],
      comments: [],
    },
  ],
  'Renovação BA': [
    {
      id: 'rba-1',
      title: 'Lista de alunos elegíveis para renovação',
      description: 'Levantar alunos com acesso expirando nos próximos 30 dias e criar fluxo de comunicação personalizado.',
      status: 'em andamento',
      links: [
        { label: 'Planilha de alunos', url: '#', type: 'sheet' },
      ],
      comments: [
        { author: 'Bianco', date: '30/03/2026', text: '47 alunos elegíveis identificados. Iniciando contato via WhatsApp.' },
      ],
    },
  ],
  'Mentoria': [
    {
      id: 'men-1',
      title: 'Turma Mentoria Futuro CTBMF — Abril',
      description: 'Abertura de vagas para a turma de abril da Mentoria Futuro CTBMF. Definir número de vagas, preço e cronograma de aulas.',
      status: 'em andamento',
      links: [
        { label: 'Cronograma de aulas', url: '#', type: 'sheet' },
        { label: 'Material da turma', url: '#', type: 'drive' },
      ],
      comments: [
        { author: 'Gustavo', date: '01/04/2026', text: 'Turma aberta com 20 vagas. 17 já preenchidas.' },
      ],
    },
  ],
}

const STATUS_STYLE: Record<Activity['status'], string> = {
  'pendente':     'bg-gray-100 text-gray-600',
  'em andamento': 'bg-blue-100 text-blue-700',
  'concluída':    'bg-green-100 text-green-700',
}

const LINK_ICON: Record<ActivityLink['type'], React.ReactNode> = {
  drive: <FileText className="h-3.5 w-3.5" />,
  sheet: <FileText className="h-3.5 w-3.5 text-green-600" />,
  link:  <Link2 className="h-3.5 w-3.5" />,
}

// ─── Activity Detail Modal ────────────────────────────────────────────────────

function ActivityDetailModal({ activity, onClose }: { activity: Activity; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative z-10 bg-background rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col border"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b">
          <div className="flex-1">
            <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium mb-1.5 ${STATUS_STYLE[activity.status]}`}>
              {activity.status}
            </span>
            <h3 className="font-semibold text-base leading-snug">{activity.title}</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground mt-0.5">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
          {/* Instrução */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Instrução</p>
            <p className="text-sm leading-relaxed">{activity.description}</p>
          </div>

          {/* Links */}
          {activity.links.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Links</p>
              <div className="space-y-1.5">
                {activity.links.map((l, i) => (
                  <a
                    key={i}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm px-3 py-2 rounded-md border hover:bg-muted/50 transition-colors"
                  >
                    {LINK_ICON[l.type]}
                    <span className="flex-1">{l.label}</span>
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </a>
                ))}
              </div>
              {/* Placeholder para adicionar link */}
              <button className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md hover:bg-muted/50 transition-colors w-full">
                <Plus className="h-3.5 w-3.5" />
                Adicionar link
              </button>
            </div>
          )}

          {/* Atualizações */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Atualizações ({activity.comments.length})
            </p>
            {activity.comments.length === 0 && (
              <p className="text-xs text-muted-foreground italic">Nenhuma atualização ainda.</p>
            )}
            <div className="space-y-3">
              {activity.comments.map((c, i) => (
                <div key={i} className="flex gap-2.5">
                  <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0">
                    {c.author[0]}
                  </div>
                  <div className="flex-1 bg-muted/40 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-semibold">{c.author}</span>
                      <span className="text-xs text-muted-foreground">{c.date}</span>
                    </div>
                    <p className="text-sm leading-snug">{c.text}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Input para nova atualização (estático — aguarda DB) */}
            <div className="mt-3 flex gap-2 items-start">
              <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0">
                V
              </div>
              <div className="flex-1 border rounded-lg bg-muted/20 px-3 py-2 text-sm text-muted-foreground italic cursor-not-allowed">
                Adicionar atualização... (em breve)
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Activities Panel Modal ───────────────────────────────────────────────────

function ActivitiesModal({ productName, onClose }: { productName: string; onClose: () => void }) {
  const [selected, setSelected] = useState<Activity | null>(null)
  const activities = MOCK_ACTIVITIES[productName] ?? []

  if (selected) {
    return <ActivityDetailModal activity={selected} onClose={() => setSelected(null)} />
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative z-10 bg-background rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col border"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <p className="text-xs text-muted-foreground">{productName}</p>
            <h3 className="font-semibold">Atividades</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border bg-background hover:bg-muted transition-colors opacity-50 cursor-not-allowed"
              disabled
              title="Disponível após integração com banco de dados"
            >
              <Plus className="h-3.5 w-3.5" />
              Nova atividade
            </button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {activities.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <ClipboardList className="h-8 w-8 opacity-30" />
              <p className="text-sm">Nenhuma atividade cadastrada</p>
              <p className="text-xs opacity-60">Disponível após integração com banco de dados</p>
            </div>
          )}
          {activities.map(a => (
            <button
              key={a.id}
              onClick={() => setSelected(a)}
              className="w-full text-left rounded-lg border bg-card hover:bg-muted/30 transition-colors px-4 py-3 group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[a.status]}`}>
                      {a.status}
                    </span>
                    {a.comments.length > 0 && (
                      <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                        <MessageSquare className="h-3 w-3" />
                        {a.comments.length}
                      </span>
                    )}
                    {a.links.length > 0 && (
                      <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                        <Link2 className="h-3 w-3" />
                        {a.links.length}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium leading-snug">{a.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{a.description}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </button>
          ))}
        </div>

        {activities.length > 0 && (
          <div className="px-5 py-3 border-t text-xs text-muted-foreground text-center">
            Dados estáticos — integração com banco de dados em breve
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Expandable row (Hotmart sources) ─────────────────────────────────────────

function ExpandableRow({ children, stripe, sources, onActivities }: {
  children: React.ReactNode
  stripe: boolean
  sources: HotmartProduct[]
  onActivities: () => void
}) {
  const [open, setOpen] = useState(false)
  const cols = 7
  return (
    <>
      <tr className={`border-b ${stripe ? 'bg-muted/20' : ''}`}>
        {children}
        <td className="pr-2">
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={onActivities}
              title="Ver atividades"
              className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ClipboardList className="h-3.5 w-3.5" />
            </button>
            {sources.length > 0 && (
              <button
                onClick={() => setOpen(o => !o)}
                className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                title="Ver fontes Hotmart"
              >
                {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        </td>
      </tr>
      {open && sources.map(p => (
        <tr key={p.id} className="border-b bg-muted/5 text-xs text-muted-foreground">
          <td className="pl-8 py-1.5 italic">{p.name}</td>
          <td />
          <td className="px-4 py-1.5 text-right">{fmtBRL(p.total)}</td>
          <td colSpan={cols - 3} className="px-4 py-1.5 text-right">{p.count} venda{p.count !== 1 ? 's' : ''}</td>
        </tr>
      ))}
    </>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Manual mapping: planilha name → keywords
// Prefix "=" for exact match (case-insensitive), plain string for substring match
const PRODUCT_MAP: Record<string, string[]> = {
  'Buco Approve':   ['=bucoapprove'],
  'Renovação BA':   ['renovação ba', 'renovacao ba', 'renovação buco', 'renovação de tempo'],
  'Mentoria':       ['mentoria'],
  'Planejamento':   ['planejamento'],
  'Pós Pato':       ['pós pato', 'pos pato', 'patologia oral', 'pós-graduação em patologia'],
  'Pós Anato':      ['pós anato', 'pos anato', 'anatomia de cabeça'],
  'Low tickets':    [
    'low ticket', 'bucoapp', 'pack', 'livro digital', 'libro digital',
    'treino intensivo', 'etapa final do sistema', 'resumo:', 'questões comentadas', '500 questões',
  ],
  'Outros': [],
}

function matchHotmart(hotmartName: string): string | null {
  const lower = hotmartName.toLowerCase().trim()
  for (const [planilhaName, keywords] of Object.entries(PRODUCT_MAP)) {
    if (planilhaName === 'Outros') continue
    for (const k of keywords) {
      if (k.startsWith('=')) { if (lower === k.slice(1)) return planilhaName }
      else { if (lower.includes(k)) return planilhaName }
    }
  }
  return null
}

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function currentMonthStr() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
}

function daysLeftInMonth(month: string) {
  const [y, m] = month.split('-').map(Number)
  const today = new Date()
  const lastDay = new Date(y, m, 0).getDate()
  const todayDay = today.getFullYear() === y && today.getMonth() + 1 === m ? today.getDate() : lastDay
  return Math.max(lastDay - todayDay + 1, 1)
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TabMetasMensais({ token, enabled }: Props) {
  const [month, setMonth] = useState(currentMonthStr)
  const [goalsData, setGoalsData] = useState<MonthlyGoalsResp | null>(null)
  const [hotmartData, setHotmartData] = useState<HotmartResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showUnmapped, setShowUnmapped] = useState(false)
  const [activitiesProduct, setActivitiesProduct] = useState<string | null>(null)

  const headers = { Authorization: `Bearer ${token}` }

  const load = useCallback(async (m: string) => {
    setLoading(true)
    setError('')
    try {
      const [gr, hr] = await Promise.all([
        fetch(`/api/monthly-goals?month=${m}`, { headers }),
        fetch(`/api/hotmart-sales?month=${m}`, { headers }),
      ])
      if (!gr.ok) throw new Error(`monthly-goals: ${gr.status}`)
      if (!hr.ok) throw new Error(`hotmart-sales: ${hr.status}`)
      const [gd, hd]: [MonthlyGoalsResp, HotmartResp] = await Promise.all([gr.json(), hr.json()])
      setGoalsData(gd)
      setHotmartData(hd)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { if (enabled) load(month) }, [enabled, month, load])

  const faturadoMap: Record<string, number> = {}
  const sourcesMap: Record<string, HotmartProduct[]> = {}
  const unmappedProducts: HotmartProduct[] = []

  if (hotmartData) {
    for (const p of hotmartData.products) {
      const planilhaName = matchHotmart(p.name)
      if (planilhaName) {
        faturadoMap[planilhaName] = (faturadoMap[planilhaName] ?? 0) + p.total
        sourcesMap[planilhaName] = [...(sourcesMap[planilhaName] ?? []), p]
      } else {
        unmappedProducts.push(p)
        faturadoMap['Outros'] = (faturadoMap['Outros'] ?? 0) + p.total
        sourcesMap['Outros'] = [...(sourcesMap['Outros'] ?? []), p]
      }
    }
  }

  const goals = goalsData?.goals ?? []
  const diasRestantes = daysLeftInMonth(month)
  const totalMeta = goals.reduce((s, g) => s + g.meta, 0)
  const totalFaturado = Object.values(faturadoMap).reduce((s, v) => s + v, 0)
  const totalRestante = totalMeta - totalFaturado

  const monthOptions: string[] = []
  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    monthOptions.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  return (
    <div className="space-y-6">
      {activitiesProduct && (
        <ActivitiesModal productName={activitiesProduct} onClose={() => setActivitiesProduct(null)} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">Metas Mensais</h2>
          <p className="text-xs text-muted-foreground">Faturamento Hotmart vs. metas da planilha</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="text-sm border rounded px-2 py-1.5 bg-background"
          >
            {monthOptions.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button
            onClick={() => load(month)}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border bg-background hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      {!goalsData?.configured && goalsData && (
        <div className="rounded-md bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800">
          Planilha de metas não configurada para {month}. Configure <code>GOALS_SHEET_GIDS</code> no Vercel.
        </div>
      )}

      {/* KPI cards */}
      {(goalsData || hotmartData) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Meta Total',  value: fmtBRL(totalMeta),    sub: null },
            { label: 'Faturado',    value: fmtBRL(totalFaturado), sub: `${hotmartData?.totalTransactions ?? 0} vendas` },
            { label: 'Restante',    value: fmtBRL(totalRestante), sub: totalMeta > 0 ? `${Math.round((totalFaturado / totalMeta) * 100)}% atingido` : null },
            { label: 'Meta/Dia',    value: fmtBRL(Math.max(totalRestante, 0) / diasRestantes), sub: `${diasRestantes} dias restantes` },
          ].map(card => (
            <div key={card.label} className="rounded-lg border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">{card.label}</p>
              <p className="text-xl font-bold">{card.value}</p>
              {card.sub && <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Main table */}
      {goals.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-2.5 font-medium">Produto</th>
                <th className="text-right px-4 py-2.5 font-medium">Meta</th>
                <th className="text-right px-4 py-2.5 font-medium">Faturado</th>
                <th className="text-right px-4 py-2.5 font-medium">Restante</th>
                <th className="text-right px-4 py-2.5 font-medium">Meta/Dia</th>
                <th className="text-right px-4 py-2.5 font-medium">% Meta</th>
                <th className="text-center px-4 py-2.5 font-medium">Status</th>
                <th className="w-16 px-2" />
              </tr>
            </thead>
            <tbody>
              {goals.map((g, i) => {
                const fat = faturadoMap[g.name] ?? 0
                const restante = g.meta - fat
                const pct = g.meta > 0 ? (fat / g.meta) * 100 : null
                const metaDia = g.meta > 0 ? Math.max(restante, 0) / diasRestantes : 0
                const status = pct === null ? '—' : pct >= 100 ? '✅ Atingido' : pct >= 70 ? '🟡 Em andamento' : '🔴 Abaixo'
                const sources = sourcesMap[g.name] ?? []
                return (
                  <ExpandableRow
                    key={g.name}
                    stripe={i % 2 !== 0}
                    sources={sources}
                    onActivities={() => setActivitiesProduct(g.name)}
                  >
                    <td className="px-4 py-2.5 font-medium">{g.name}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{g.meta > 0 ? fmtBRL(g.meta) : '—'}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{fat > 0 ? fmtBRL(fat) : '—'}</td>
                    <td className={`px-4 py-2.5 text-right ${restante > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                      {g.meta > 0 ? fmtBRL(restante) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      {g.meta > 0 && metaDia > 0 ? fmtBRL(metaDia) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {pct !== null ? (
                        <span className={pct >= 100 ? 'text-green-600 font-semibold' : pct >= 70 ? 'text-yellow-600' : 'text-red-600'}>
                          {pct.toFixed(1)}%
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs">{status}</td>
                  </ExpandableRow>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/50 font-semibold">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right">{fmtBRL(totalMeta)}</td>
                <td className="px-4 py-2.5 text-right">{fmtBRL(totalFaturado)}</td>
                <td className={`px-4 py-2.5 text-right ${totalRestante > 0 ? 'text-orange-600' : 'text-green-600'}`}>{fmtBRL(totalRestante)}</td>
                <td className="px-4 py-2.5 text-right">{fmtBRL(Math.max(totalRestante, 0) / diasRestantes)}</td>
                <td className="px-4 py-2.5 text-right">
                  {totalMeta > 0 ? (
                    <span className={(totalFaturado / totalMeta) * 100 >= 100 ? 'text-green-600' : ''}>
                      {((totalFaturado / totalMeta) * 100).toFixed(1)}%
                    </span>
                  ) : '—'}
                </td>
                <td /><td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {loading && goals.length === 0 && (
        <div className="flex justify-center py-12 text-muted-foreground text-sm">Carregando...</div>
      )}

      {/* Unmapped products */}
      {unmappedProducts.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <button
            onClick={() => setShowUnmapped(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/40 transition-colors"
          >
            <span>Produtos Hotmart não mapeados ({unmappedProducts.length})</span>
            {showUnmapped ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showUnmapped && (
            <div className="border-t overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="text-left px-4 py-2 font-medium">Nome no Hotmart</th>
                    <th className="text-right px-4 py-2 font-medium">Faturado</th>
                    <th className="text-right px-4 py-2 font-medium">Vendas</th>
                  </tr>
                </thead>
                <tbody>
                  {unmappedProducts.map(p => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="px-4 py-2 text-muted-foreground">{p.name}</td>
                      <td className="px-4 py-2 text-right">{fmtBRL(p.total)}</td>
                      <td className="px-4 py-2 text-right">{p.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
