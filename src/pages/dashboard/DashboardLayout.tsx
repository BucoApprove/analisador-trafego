import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { LogOut, BarChart2 } from 'lucide-react'
import TabVisaoGeral from './TabVisaoGeral'
import TabLancamento from './TabLancamento'
import TabBA25 from './TabBA25'
import TabLeads from './TabLeads'
import TabInscritos from './TabInscritos'
import TabInstagram from './TabInstagram'
import TabEmailCampaigns from './TabEmailCampaigns'
import TabPaidTraffic from './TabPaidTraffic'
import TabPesquisa from './TabPesquisa'

interface DashboardLayoutProps {
  token: string
  onLogout: () => void
}

const TABS = [
  { id: 'visao-geral', label: 'Visão Geral' },
  { id: 'campanhas', label: 'Campanhas' },
  { id: 'lancamento', label: 'Lançamento' },
  { id: 'ba25', label: 'BA25 🚀' },
  { id: 'leads', label: 'Leads' },
  { id: 'inscritos', label: 'Inscritos' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'email', label: 'Email' },
  { id: 'pesquisa', label: 'Pesquisa' },
]

export default function DashboardLayout({ token, onLogout }: DashboardLayoutProps) {
  const [activeTab, setActiveTab] = useState('visao-geral')

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <BarChart2 className="h-5 w-5 text-primary" />
            <span className="font-semibold">Analisador de Tráfego</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Sair
          </Button>
        </div>
        <Separator />
      </header>

      {/* Conteúdo com abas */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6 flex h-auto flex-wrap gap-1 bg-muted p-1">
            {TABS.map(tab => (
              <TabsTrigger key={tab.id} value={tab.id} className="text-xs sm:text-sm">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="visao-geral">
            <TabVisaoGeral token={token} enabled={activeTab === 'visao-geral'} />
          </TabsContent>
          <TabsContent value="campanhas">
            <TabPaidTraffic token={token} enabled={activeTab === 'campanhas'} />
          </TabsContent>
          <TabsContent value="lancamento">
            <TabLancamento token={token} enabled={activeTab === 'lancamento'} />
          </TabsContent>
          <TabsContent value="ba25">
            <TabBA25 token={token} enabled={activeTab === 'ba25'} />
          </TabsContent>
          <TabsContent value="leads">
            <TabLeads token={token} enabled={activeTab === 'leads'} />
          </TabsContent>
          <TabsContent value="inscritos">
            <TabInscritos token={token} enabled={activeTab === 'inscritos'} />
          </TabsContent>
          <TabsContent value="instagram">
            <TabInstagram token={token} enabled={activeTab === 'instagram'} />
          </TabsContent>
          <TabsContent value="email">
            <TabEmailCampaigns token={token} enabled={activeTab === 'email'} />
          </TabsContent>
          <TabsContent value="pesquisa">
            <TabPesquisa token={token} enabled={activeTab === 'pesquisa'} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
