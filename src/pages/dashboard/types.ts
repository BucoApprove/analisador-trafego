// ─── Tipos gerais ────────────────────────────────────────────────────────────

export interface DashboardData {
  inscritos: number
  compradores: number
  conversao: number
  inscritosPorDia: { date: string; count: number }[]
  inscritosPorProfissao: { name: string; value: number }[]
  inscritosPorFonte: { name: string; value: number }[]
  inscritosPorCampanha: { name: string; value: number }[]
}

// ─── Dados brutos da API ─────────────────────────────────────────────────────

export interface RawLeadRow {
  lead_email: string
  tag_name: string | null
  date: string
  utm_source: string | null
  utm_campaign: string | null
  utm_medium: string | null
  utm_content: string | null
}

export interface RawLaunchResponse {
  prefix: string
  rows: RawLeadRow[]
  since: string
  until: string
}

// ─── Análise de Lançamento ───────────────────────────────────────────────────

export interface LaunchTagCount {
  tag: string
  countAll: number    // total histórico (sem filtro de data)
  countPeriod: number // total no período selecionado
}

export interface LaunchData {
  prefix: string
  byTag: LaunchTagCount[]
  totalUniqueAll: number    // total histórico deduplicado (sem filtro de data)
  totalUnique: number       // total deduplicado no período selecionado
  sumByTag: number
  overlap: number
  leadsByDay: { date: string; count: number }[]
  bySource: { name: string; value: number }[]
  byCampaign: { name: string; value: number }[]
  byMedium: { name: string; value: number }[]
  byContent: { name: string; value: number }[]
  byTerm: { name: string; value: number }[]
  dateRange: { since: string; until: string }
  // Meta Ads spend (presente só quando spendFilter for passado)
  metaSpend?: number
  cpl?: number | null
  metaCampaigns?: { name: string; spend: number }[]
  dailyMeta?: { date: string; spend: number; clicks: number; linkClicks: number; pageViews: number }[]
  spendByUtm?: {
    source: Record<string, number>
    medium: Record<string, number>
    campaign: Record<string, number>
    content: Record<string, number>
    term: Record<string, number>
  }
}

export interface TagsListData {
  tags: string[]
}

export interface MetaGroup {
  spend: number
  leads: number
  cpl: number
  clicks: number
  impressions: number
  ctr: number
  cpc: number
  reach: number
  frequency: number
  cpa: number
  roas: number
  purchases: number
  revenue: number
  videoRetention?: number
  followers?: number
  campaigns: MetaCampaign[]
}

export interface MetaCampaign {
  id: string
  name: string
  status: string
  spend: number
  leads: number
  purchases: number
  clicks: number
  impressions: number
  reach: number
  ctr: number
  cpc: number
}

export interface MetaAdsData {
  captacao: MetaGroup
  vendaDireta: MetaGroup
  boosts: MetaGroup
  totalSpend: number
  totalLeads: number
  totalPurchases: number
  dateRange: { start: string; end: string }
}

export interface InstagramPost {
  id: string
  mediaType: string
  mediaUrl?: string
  thumbnailUrl?: string
  permalink: string
  caption?: string
  timestamp: string
  likeCount: number
  commentsCount: number
  reach: number
  saved: number
  shares: number
  videoViews?: number
  engagementRate: number
  saveRate: number
  shareRate: number
}

export interface InstagramData {
  profile: {
    username: string
    name: string
    biography: string
    followersCount: number
    followsCount: number
    mediaCount: number
    profilePictureUrl?: string
  }
  posts: InstagramPost[]
}

export interface EmailWave {
  tag: string
  label: string
  count: number
}

export interface EmailCampaignsData {
  waves: EmailWave[]
  totalInscritos: number
  totalCompradores: number
}

export interface Subscriber {
  id: string
  name: string
  email: string
  phone?: string
  profissao?: string
  fonte?: string
  inscricaoDate?: string
  tags: string[]
}

export interface SubscriberEmailsData {
  subscribers: Subscriber[]
  total: number
}

export interface Lead {
  id: string
  name: string
  email: string
  phone?: string
  tags: string[]
  dateAdded: string
  source?: string
  utmSource?: string
  utmCampaign?: string
}

export interface LeadsData {
  leads: Lead[]
  total: number
  nextCursor?: string
}

// ─── Metas (planilha Google Sheets) ─────────────────────────────────────────

export interface GoalsData {
  metaLeadsTrafico: number
  metaLeadsOrganico: number
  metaLeadsManychat: number
  orcamentoTotal: number
  inicioCaptacao: string
  finalCaptacao: string
  orcamentoPorFase: {
    captura: number
    descoberta: number
    aquecimento: number
    lembrete: number
    remarketing: number
  }
  tagsReferencia: {
    lancamento: string
    captura: string
    descoberta: string
    aquecimento: string
    lembrete: string
    remarketing: string
  }
}

// ─── Tipos de estado do hook ─────────────────────────────────────────────────

export type FetchStatus = 'idle' | 'loading' | 'success' | 'error'

export interface FetchState<T> {
  data: T | null
  status: FetchStatus
  error: string | null
  lastUpdated: Date | null
}
