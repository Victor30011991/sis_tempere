import type { Product } from '../types';
import { norm } from './normalize';

/** Dados opcionais do produto que não têm coluna própria na planilha: viajam na aba oculta de configurações do Excel. */
export interface ProductExtra {
  estoque?: number | null;
  conteudoQtd?: number | null;
  conteudoUnidade?: string | null;
}

export type ExtrasMap = Record<string, ProductExtra>;

/** Mesma identidade usada na importação: nome + categoria + unidade (o ID muda quando o produto é reimportado). */
export const extraKey = (p: Pick<Product, 'nome' | 'categoria' | 'unidade'>) => `${norm(p.nome)}|${norm(p.categoria)}|${p.unidade}`;

export function buildExtras(produtos: Product[]): ExtrasMap {
  const out: ExtrasMap = {};
  for (const p of produtos) {
    const e: ProductExtra = {};
    if (p.estoque != null) e.estoque = p.estoque;
    if (p.conteudoQtd && p.conteudoUnidade) {
      e.conteudoQtd = p.conteudoQtd;
      e.conteudoUnidade = p.conteudoUnidade;
    }
    if (Object.keys(e).length) out[extraKey(p)] = e;
  }
  return out;
}

/** Devolve os produtos com estoque/conteúdo restaurados. Produtos sem registro ficam intactos. */
export function mergeExtras(produtos: Product[], extras: ExtrasMap | undefined | null): Product[] {
  if (!extras) return produtos;
  return produtos.map((p) => {
    const e = extras[extraKey(p)];
    return e ? { ...p, ...e } : p;
  });
}
