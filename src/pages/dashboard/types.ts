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

// ─── Atribuição de UTMs por vendas ───────────────────────────────────────────

export interface UtmSalesAttribution {
  name: string
  anyTime: number     // compradores que em algum momento tiveram essa UTM
  lastBefore: number  // compradores cuja última UTM antes da compra foi essa
  origin: number      // compradores cuja primeira UTM na base foi essa
}

export interface SalesUtmData {
  totalBuyers: number
  since: string
  until: string
  bySource:   UtmSalesAttribution[]
  byMedium:   UtmSalesAttribution[]
  byCampaign: UtmSalesAttribution[]
  byContent:  UtmSalesAttribution[]
}

// ─── Vendas (Hotmart/Greenn) ─────────────────────────────────────────────────

export interface VendaRow {
  txnId: string
  dataPedido: string | null
  dataAprovacao: string | null
  nomeComprador: string
  emailComprador: string
  telefone: string | null
  cidade: string | null
  estado: string | null
  produto: string
  valorProduto: number | null
  valorPago: number | null
  status: string
  metodoPagamento: string | null
  parcelas: string | null
}

export interface VendasMetrics {
  total: number
  uniqueBuyers: number
  revenue: number
  distinctProducts: number
}

export interface VendasFilters {
  statuses: string[]
  products: string[]
  states: string[]
  paymentMethods: string[]
}

export interface VendasData {
  vendas: VendaRow[]
  total: number
  nextCursor: string | null
  metrics: VendasMetrics
  filters: VendasFilters
}

// ─── Cruzamento de Produtos ──────────────────────────────────────────────────

export interface CruzamentoSummary {
  totalGrupoA: number
  totalProdutoB: number
  compraramAmbos: number
  bPrimeiro: number
  mesmaDia: number
  taxaConversao: string
  mediaDiasAtoB: number | null
}

export interface CruzamentoRow {
  nome: string
  email: string
  produtoA: string
  dataA: string | null
  dataB: string | null
  diasEntre: number | null
  sequencia: string
}

export interface CruzamentoData {
  summary: CruzamentoSummary
  intersection: CruzamentoRow[]
  bFirst: CruzamentoRow[]
  onlyACount: number
  onlyBCount: number
  products: string[]
}

// ─── Análises Cruzadas ───────────────────────────────────────────────────────

export interface LeadToCompraRow {
  nome: string
  email: string
  dataLead: string
  dataCompra: string
  dias: number
}

export interface LeadToCompraResult {
  count: number
  media: number | null
  mediana: number | null
  min: number | null
  max: number | null
  rows: LeadToCompraRow[]
}

export interface AllProductsLTCRow {
  produto: string
  leadsQueCompraram: number
  mediana: number
  minimo: number
  maximo: number
  media: number
}

export interface AvgTagsResult {
  count: number
  media: number
  mediana: number
  max: number
  distribution: { tags: number; count: number }[]
}

export interface UtmContentRow {
  utmContent: string
  leadsUnicos: number
}

export interface FirstEntryResult {
  byTag: { category: string; compradores: number }[]
  byForm: { category: string; compradores: number }[]
}

export interface UtmFunnelRow {
  utm: string
  leads: number
  compradores: number
  taxaConversao: number
}

export interface BuyerTagRow {
  tag: string
  compradores: number
  pct: number
}

export interface BehaviorTagResult {
  count: number
  soAntes: number
  soDepois: number
  ambos: number
  nenhum: number
  mediaAntes: number
  mediaDepois: number
  products: { product: string; antes: number; depois: number }[]
}

export interface CrossAnalysisData {
  leadToCompra: LeadToCompraResult
  allProductsLTC: AllProductsLTCRow[]
  avgTags: AvgTagsResult
  utmContent: UtmContentRow[]
  firstEntry: FirstEntryResult
  utmFunnel: Record<string, UtmFunnelRow[]>
  buyerTags: BuyerTagRow[]
  availableTags: string[]
  availableProducts: string[]
}

// ─── Análise de Leads (UTM + Comportamento) ──────────────────────────────────

export interface LeadsUTMRow {
  value: string
  count: number
}

export interface LeadsUTMData {
  utmSource: LeadsUTMRow[]
  utmCampaign: LeadsUTMRow[]
  utmMedium: LeadsUTMRow[]
  utmContent: LeadsUTMRow[]
}

export interface LeadsBehaviorData {
  total: number
  soAntes: number
  soDepois: number
  ambos: number
  nenhum: number
  mediaAntes: number
  mediaDepois: number
  products: { product: string; antes: number; depois: number }[]
}

// ─── Tipos de estado do hook ─────────────────────────────────────────────────

export type FetchStatus = 'idle' | 'loading' | 'success' | 'error'

export interface FetchState<T> {
  data: T | null
  status: FetchStatus
  error: string | null
  lastUpdated: Date | null
}
