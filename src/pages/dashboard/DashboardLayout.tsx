import { useState } from 'react'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import {
  LogOut, BarChart2, TrendingUp, Users, Camera, Mail,
  Search, Zap, Menu, X, Target, Settings, PieChart, UserCheck,
  ShoppingCart, GitMerge, Activity, Tags, Link,
} from 'lucide-react'
import TabVisaoGeral from './TabVisaoGeral'
import TabLancamento from './TabLancamento'
import TabBA25 from './TabBA25'
import TabLeads from './TabLeads'
import TabInscritos from './TabInscritos'
import TabInstagram from './TabInstagram'
import TabEmailCampaigns from './TabEmailCampaigns'
import TabPaidTraffic from './TabPaidTraffic'
import TabPesquisa from './TabPesquisa'
import TabMetasMensais from './TabMetasMensais'
import TabInstagramGestor from './TabInstagramGestor'
import TabVendas from './TabVendas'
import TabCruzamento from './TabCruzamento'
import TabAnalisesCruzadas from './TabAnalisesCruzadas'
import TabPerpetuo from './TabPerpetuo'
import TabUtmLeads from './TabUtmLeads'
import TabReport from './TabReport'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardLayoutProps {
  token: string
  role: 'admin' | 'user'
  userName: string
  onLogout: () => void
}

interface NavItem {
  id: string
  label: string
  icon: React.FC<{ className?: string }>
  hidden?: boolean
}

// ─── Navigation config ────────────────────────────────────────────────────────

const USER_NAV: NavItem[] = [
  { id: 'ba25',        label: 'BA25 🚀',     icon: BarChart2    },
  { id: 'visao-geral', label: 'Visão Geral', icon: PieChart     },
  { id: 'campanhas',   label: 'Campanhas',   icon: TrendingUp,   hidden: true },
  { id: 'lancamento',  label: 'Lançamento',  icon: Zap,          hidden: true },
  { id: 'leads',       label: 'Leads',       icon: Users,        hidden: true },
  { id: 'inscritos',   label: 'Inscritos',   icon: UserCheck,    hidden: true },
  { id: 'instagram',   label: 'Instagram',   icon: Camera,       hidden: true },
  { id: 'email',       label: 'Email',       icon: Mail,         hidden: true },
  { id: 'pesquisa',    label: 'Pesquisa',    icon: Search,       hidden: true },
  { id: 'vendas',      label: 'Vendas',      icon: ShoppingCart, hidden: true },
  { id: 'cruzamento',  label: 'Cruzamento',  icon: GitMerge     },
  { id: 'analises',    label: 'Análises',    icon: Activity     },
  { id: 'perpetuo',    label: 'Perpétuo',    icon: Target       },
  { id: 'utm-leads',   label: 'UTMs Leads',  icon: Tags         },
  { id: 'report',      label: 'Relatório IA', icon: Link         },
]

const ADMIN_NAV: NavItem[] = [
  { id: 'metas-mensais',    label: 'Metas Mensais',    icon: Target   },
  { id: 'instagram-gestor', label: 'Instagram Gestor', icon: Settings },
]

// ─── Sidebar nav button ───────────────────────────────────────────────────────

function SidebarNavBtn({
  item,
  active,
  onClick,
}: {
  item: NavItem
  active: boolean
  onClick: () => void
}) {
  const Icon = item.icon
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 text-left ${
        active
          ? 'bg-primary/10 text-primary font-semibold'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground font-medium'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </button>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({
  activeTab,
  onTabChange,
  role,
  userName,
  onLogout,
  onClose,
}: {
  activeTab: string
  onTabChange: (tab: string) => void
  role: 'admin' | 'user'
  userName: string
  onLogout: () => void
  onClose?: () => void
}) {
  const initials = userName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase()

  const handleNav = (id: string) => {
    onTabChange(id)
    onClose?.()
  }

  return (
    <aside className="flex flex-col h-full bg-card border-r border-border">

      {/* ── Brand ── */}
      <div className="flex items-center gap-3 px-5 h-16 border-b border-border shrink-0">
        <div className="h-8 w-8 rounded-xl bg-primary flex items-center justify-center shrink-0 shadow-sm">
          <BarChart2 className="h-4 w-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-tight truncate">Analisador</p>
          <p className="text-[11px] text-muted-foreground leading-tight">de Tráfego</p>
        </div>
        {onClose && (
          <button
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors lg:hidden"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {USER_NAV.filter(item => !item.hidden).map(item => (
          <SidebarNavBtn
            key={item.id}
            item={item}
            active={activeTab === item.id}
            onClick={() => handleNav(item.id)}
          />
        ))}

        {role === 'admin' && (
          <>
            <div className="pt-5 pb-2 px-3">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Gestor
              </p>
            </div>
            {ADMIN_NAV.map(item => (
              <SidebarNavBtn
                key={item.id}
                item={item}
                active={activeTab === item.id}
                onClick={() => handleNav(item.id)}
              />
            ))}
          </>
        )}
      </nav>

      {/* ── User footer ── */}
      <div className="px-3 py-3 border-t border-border shrink-0">
        <div className="flex items-center gap-3 px-2 py-1.5">
          <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-primary">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-tight truncate">{userName}</p>
            <p className="text-[11px] text-muted-foreground leading-tight">
              {role === 'admin' ? 'Gestor' : 'Analista'}
            </p>
          </div>
          <button
            onClick={onLogout}
            title="Sair da conta"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}

// ─── Dashboard Layout ─────────────────────────────────────────────────────────

export default function DashboardLayout({ token, role, userName, onLogout }: DashboardLayoutProps) {
  const [activeTab, setActiveTab]   = useState('ba25')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const allNav     = [...USER_NAV, ...(role === 'admin' ? ADMIN_NAV : [])]
  const currentPage = allNav.find(n => n.id === activeTab)

  return (
    <div className="min-h-screen bg-background">

      {/* ── Mobile overlay ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-foreground/20 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar — fixed left ── */}
      <div
        className={`fixed inset-y-0 left-0 z-40 w-60 transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          role={role}
          userName={userName}
          onLogout={onLogout}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      {/* ── Main content ── */}
      <div className="lg:pl-60 flex flex-col min-h-screen">

        {/* Mobile topbar */}
        <header className="sticky top-0 z-20 h-14 bg-card/90 backdrop-blur-sm border-b border-border flex items-center px-4 gap-3 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="h-9 w-9 flex items-center justify-center rounded-xl hover:bg-muted transition-colors"
          >
            <Menu className="h-5 w-5 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-6 w-6 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <BarChart2 className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-semibold text-sm truncate">
              {currentPage?.label ?? 'Dashboard'}
            </span>
          </div>
        </header>

        {/* Page area */}
        <main className="flex-1 p-5 lg:p-8">

          {/* Desktop page title */}
          <div className="hidden lg:block mb-7">
            <h1 className="text-2xl font-bold tracking-tight">
              {currentPage?.label ?? 'Dashboard'}
            </h1>
          </div>

          {/* Tab content (no TabsList — sidebar is the nav) */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsContent value="ba25" className="mt-0">
              <TabBA25 token={token} enabled={activeTab === 'ba25'} />
            </TabsContent>
            <TabsContent value="visao-geral" className="mt-0">
              <TabVisaoGeral token={token} enabled={activeTab === 'visao-geral'} />
            </TabsContent>
            <TabsContent value="campanhas" className="mt-0">
              <TabPaidTraffic token={token} enabled={activeTab === 'campanhas'} />
            </TabsContent>
            <TabsContent value="lancamento" className="mt-0">
              <TabLancamento token={token} enabled={activeTab === 'lancamento'} />
            </TabsContent>
            <TabsContent value="leads" className="mt-0">
              <TabLeads token={token} enabled={activeTab === 'leads'} />
            </TabsContent>
            <TabsContent value="inscritos" className="mt-0">
              <TabInscritos token={token} enabled={activeTab === 'inscritos'} />
            </TabsContent>
            <TabsContent value="instagram" className="mt-0">
              <TabInstagram token={token} enabled={activeTab === 'instagram'} />
            </TabsContent>
            <TabsContent value="email" className="mt-0">
              <TabEmailCampaigns token={token} enabled={activeTab === 'email'} />
            </TabsContent>
            <TabsContent value="pesquisa" className="mt-0">
              <TabPesquisa token={token} enabled={activeTab === 'pesquisa'} />
            </TabsContent>
            <TabsContent value="vendas" className="mt-0">
              <TabVendas token={token} enabled={activeTab === 'vendas'} />
            </TabsContent>
            <TabsContent value="cruzamento" className="mt-0">
              <TabCruzamento token={token} enabled={activeTab === 'cruzamento'} />
            </TabsContent>
            <TabsContent value="analises" className="mt-0">
              <TabAnalisesCruzadas token={token} enabled={activeTab === 'analises'} />
            </TabsContent>
            <TabsContent value="perpetuo" className="mt-0">
              <TabPerpetuo token={token} enabled={activeTab === 'perpetuo'} />
            </TabsContent>
            <TabsContent value="utm-leads" className="mt-0">
              <TabUtmLeads token={token} enabled={activeTab === 'utm-leads'} />
            </TabsContent>
            <TabsContent value="report" className="mt-0">
              <TabReport dashboardToken={token} />
            </TabsContent>
            {role === 'admin' && (
              <>
                <TabsContent value="metas-mensais" className="mt-0">
                  <TabMetasMensais token={token} enabled={activeTab === 'metas-mensais'} />
                </TabsContent>
                <TabsContent value="instagram-gestor" className="mt-0">
                  <TabInstagramGestor token={token} enabled={activeTab === 'instagram-gestor'} />
                </TabsContent>
              </>
            )}
          </Tabs>
        </main>
      </div>
    </div>
  )
}
