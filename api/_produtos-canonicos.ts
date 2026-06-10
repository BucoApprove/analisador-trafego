/**
 * Mapa canônico de produtos Hotmart — fonte única de verdade da aba "Placar".
 *
 * Mapeamento por product.id (nunca por nome): agrupar por nome junta produtos
 * distintos (ex: "Pós Anatomia" curso vs "Livro de Anatomia" R$10).
 *
 * Regra de classificação:
 *   - ID na lista CORE → produto canônico próprio + categoria.
 *   - BucoApprove (2016048) é separado por offer.code em "Intensivo ENARE" vs
 *     "Buco Approve" (ver classifyBuco).
 *   - Qualquer ID fora da lista → "Low ticket" automaticamente (à prova de
 *     futuro: livros/packs/testes novos entram sozinhos).
 */

export type Categoria = 'core' | 'porta' | 'low'

export interface ProdutoCanonico {
  nome: string
  categoria: Categoria
}

export const BUCO_PID = 2016048

// Ofertas do BucoApprove que são o Intensivo ENARE (resto = Buco core).
//   wgmh3qg1 = "INTENSIVO ENARE" (R$1400)
//   32ypw9pk = "Intensivo 2 Meses" (R$297)
export const INTENSIVO_OFFERS = new Set(['wgmh3qg1', '32ypw9pk'])

// Produtos core mapeados por ID. Tudo que não estiver aqui vira Low ticket.
export const PRODUTOS_CORE: Record<number, ProdutoCanonico> = {
  2016048: { nome: 'BucoApprove',             categoria: 'core' },  // separado por oferta em classifyProduto
  3811518: { nome: 'Mentoria CTBMF',          categoria: 'core' },
  5694443: { nome: 'Pós Patologia',           categoria: 'core' },
  6115663: { nome: 'Pós Anatomia',            categoria: 'core' },
  6739963: { nome: 'Planejamento ImpulsoR+',  categoria: 'core' },
  3510472: { nome: 'Renovação de acesso',     categoria: 'core' },
  4739673: { nome: 'Rota Enare',              categoria: 'core' },
  2286372: { nome: 'BucoApp',                 categoria: 'core' },
  7737553: { nome: 'Imersão ENARE',           categoria: 'porta' },
  7812483: { nome: 'Segurança Clínica por Casos', categoria: 'core' },
}

export const LOW_TICKET = 'Low ticket'

/**
 * Classifica uma venda no produto canônico, considerando id e oferta.
 * @param productId  product.id da Hotmart
 * @param offerCode  purchase.offer.code (só relevante para o BucoApprove)
 */
export function classifyProduto(productId: number, offerCode?: string): ProdutoCanonico {
  if (productId === BUCO_PID) {
    return offerCode && INTENSIVO_OFFERS.has(offerCode)
      ? { nome: 'Intensivo ENARE', categoria: 'core' }
      : { nome: 'Buco Approve', categoria: 'core' }
  }
  return PRODUTOS_CORE[productId] ?? { nome: LOW_TICKET, categoria: 'low' }
}
