import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Copy, Check, Link } from 'lucide-react'

// ─── Configuração das opções ──────────────────────────────────────────────────

const CONTA1_VIEWS = [
  { id: 'etapa1', label: 'Posts Impulsionados' },
  { id: 'etapa2', label: 'Captura' },
  { id: 'etapa3', label: 'Relacionamento' },
  { id: 'etapa4', label: 'Conversão' },
  { id: 'etapa5', label: 'Remarketing' },
]

const CONTA2_VIEWS = [
  { id: 'anatomia',         label: 'Pós-Grad. Anatomia'  },
  { id: 'patologia',        label: 'Pós-Grad. Patologia' },
  { id: 'lowticket-brasil', label: 'Low Ticket Brasil'   },
  { id: 'lowticket-latam',  label: 'Low Ticket Latam'    },
]

function firstOfMonthIso() {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().split('T')[0]
}

function todayIso() {
  return new Date().toISOString().split('T')[0]
}

// ─── Componente ───────────────────────────────────────────────────────────────

interface TabReportProps {
  dashboardToken: string
}

export default function TabReport({ dashboardToken }: TabReportProps) {
  const [account, setAccount]     = useState<'conta1' | 'conta2'>('conta1')
  const [views, setViews]         = useState<Set<string>>(new Set(['etapa2']))
  const [since, setSince]         = useState(firstOfMonthIso)
  const [until, setUntil]         = useState(todayIso)
  const [format, setFormat]       = useState<'csv' | 'json'>('csv')
  const [level, setLevel]         = useState<'campaign' | 'adset' | 'ad'>('adset')
  const [copied, setCopied]       = useState(false)

  const currentViews = account === 'conta1' ? CONTA1_VIEWS : CONTA2_VIEWS

  function toggleView(id: string) {
    setViews(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        if (next.size > 1) next.delete(id) // pelo menos 1 selecionada
      } else {
        next.add(id)
      }
      return next
    })
  }

  function selectAll() {
    setViews(new Set(currentViews.map(v => v.id)))
  }

  function handleAccountChange(acc: 'conta1' | 'conta2') {
    setAccount(acc)
    const firstView = acc === 'conta1' ? 'etapa2' : 'anatomia'
    setViews(new Set([firstView]))
  }

  // Monta a URL final
  const base    = typeof window !== 'undefined' ? window.location.origin : 'https://analisador-trafego.vercel.app'
  const viewsStr = [...views].join(',')
  const url = `${base}/api/report?token=${dashboardToken}&account=${account}&views=${viewsStr}&since=${since}&until=${until}&format=${format}&level=${level}`

  async function copyUrl() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Resumo legível do que está selecionado
  const selectedLabels = currentViews
    .filter(v => views.has(v.id))
    .map(v => v.label)

  const levelLabel  = { campaign: 'Campanhas (totais)', adset: 'Conjuntos de anúncios', ad: 'Anúncios (criativos)' }[level]
  const formatLabel = format === 'csv' ? 'CSV (Excel)' : 'JSON'

  return (
    <div className="space-y-6 max-w-2xl">

      <div>
        <h2 className="text-lg font-bold mb-1">Gerador de Relatório para IA</h2>
        <p className="text-sm text-muted-foreground">
          Configure o relatório, copie a URL e cole em qualquer IA (ChatGPT, Claude, Gemini…).
          A IA vai baixar os dados e fazer a análise automaticamente.
        </p>
      </div>

      {/* ── Conta ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">1. Conta</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button
            size="sm"
            variant={account === 'conta1' ? 'default' : 'outline'}
            onClick={() => handleAccountChange('conta1')}
          >
            GBS Launch — Lançamentos
          </Button>
          <Button
            size="sm"
            variant={account === 'conta2' ? 'default' : 'outline'}
            onClick={() => handleAccountChange('conta2')}
          >
            GBS — Pós-graduações
          </Button>
        </CardContent>
      </Card>

      {/* ── Etapas ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center justify-between">
            2. Etapas / Categorias
            <button
              onClick={selectAll}
              className="text-xs font-normal text-muted-foreground hover:text-foreground transition-colors"
            >
              Selecionar todas
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {currentViews.map(v => (
            <button
              key={v.id}
              onClick={() => toggleView(v.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                views.has(v.id)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:border-primary/50'
              }`}
            >
              {v.label}
            </button>
          ))}
        </CardContent>
      </Card>

      {/* ── Período ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">3. Período</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground w-12">De</span>
            <Input
              type="date"
              value={since}
              onChange={e => setSince(e.target.value)}
              className="w-36 h-8 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground w-12">Até</span>
            <Input
              type="date"
              value={until}
              onChange={e => setUntil(e.target.value)}
              className="w-36 h-8 text-sm"
            />
          </div>
          {/* Atalhos rápidos */}
          <div className="flex gap-1.5 ml-auto">
            {[
              { label: 'Hoje', fn: () => { const t = todayIso(); setSince(t); setUntil(t) } },
              { label: 'Últ. 7d', fn: () => { setSince(new Date(Date.now() - 7*86400000).toISOString().split('T')[0]); setUntil(todayIso()) } },
              { label: 'Últ. 30d', fn: () => { setSince(new Date(Date.now() - 30*86400000).toISOString().split('T')[0]); setUntil(todayIso()) } },
              { label: 'Este mês', fn: () => { setSince(firstOfMonthIso()); setUntil(todayIso()) } },
            ].map(({ label, fn }) => (
              <button
                key={label}
                onClick={fn}
                className="text-xs px-2 py-1 rounded border border-border hover:border-primary/50 text-muted-foreground hover:text-foreground transition-all"
              >
                {label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Nível de detalhe ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">4. Nível de detalhe</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          {([
            { id: 'campaign', label: 'Campanhas', desc: 'Totais por campanha' },
            { id: 'adset',    label: 'Conjuntos', desc: 'Por conjunto de anúncios' },
            { id: 'ad',       label: 'Anúncios',  desc: 'Por criativo (mais detalhado)' },
          ] as const).map(opt => (
            <button
              key={opt.id}
              onClick={() => setLevel(opt.id)}
              className={`flex-1 px-3 py-2.5 rounded-lg border text-left transition-all ${
                level === opt.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:border-primary/50'
              }`}
            >
              <div className="text-sm font-medium">{opt.label}</div>
              <div className={`text-xs mt-0.5 ${level === opt.id ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                {opt.desc}
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* ── Formato ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">5. Formato</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          {([
            { id: 'csv',  label: 'CSV',  desc: 'Recomendado para IA — tabela plana' },
            { id: 'json', label: 'JSON', desc: 'Estruturado, para integrações' },
          ] as const).map(opt => (
            <button
              key={opt.id}
              onClick={() => setFormat(opt.id)}
              className={`flex-1 px-3 py-2.5 rounded-lg border text-left transition-all ${
                format === opt.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:border-primary/50'
              }`}
            >
              <div className="text-sm font-medium">{opt.label}</div>
              <div className={`text-xs mt-0.5 ${format === opt.id ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                {opt.desc}
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* ── Resumo + URL ── */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Link className="h-4 w-4" />
            URL do Relatório
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Resumo do que vai no relatório */}
          <div className="text-xs text-muted-foreground space-y-1">
            <div><span className="font-medium text-foreground">Conta:</span> {account === 'conta1' ? 'GBS Launch' : 'GBS Pós-graduações'}</div>
            <div><span className="font-medium text-foreground">Etapas:</span> {selectedLabels.join(', ')}</div>
            <div><span className="font-medium text-foreground">Período:</span> {since} → {until}</div>
            <div><span className="font-medium text-foreground">Nível:</span> {levelLabel}</div>
            <div><span className="font-medium text-foreground">Formato:</span> {formatLabel}</div>
          </div>

          {/* URL */}
          <div className="flex items-center gap-2 bg-background border rounded-lg p-2">
            <code className="text-xs flex-1 text-muted-foreground break-all select-all font-mono">
              {url}
            </code>
          </div>

          {/* Botão copiar */}
          <Button onClick={copyUrl} className="w-full gap-2" size="sm">
            {copied
              ? <><Check className="h-4 w-4" /> URL copiada!</>
              : <><Copy className="h-4 w-4" /> Copiar URL</>
            }
          </Button>

          {/* Dica para IA */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1">
            <p className="font-semibold">Como usar com IA:</p>
            <p>Cole a URL copiada no chat e peça algo como:</p>
            <p className="italic">"Baixe o relatório dessa URL e me dê uma análise das campanhas com pior CPL e melhores oportunidades de otimização."</p>
          </div>

        </CardContent>
      </Card>

    </div>
  )
}
