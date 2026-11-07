import type { Product } from '../types';
import { norm } from './normalize';

export type SortMode = 'az' | 'za' | 'menor' | 'maior' | 'categoria';

export const SORT_LABELS: Record<SortMode, string> = {
  az: 'Ordem alfabética (A → Z)',
  za: 'Ordem alfabética (Z → A)',
  menor: 'Menor preço para o maior',
  maior: 'Maior preço para o menor',
  categoria: 'Separado por categoria',
};

const cmpName = (a: Product, b: Product) => norm(a.nome).localeCompare(norm(b.nome), 'pt-BR', { numeric: true });
const priceOf = (p: Product) => p.venda ?? p.custo ?? Number.POSITIVE_INFINITY;

export function sortProducts(list: Product[], mode: SortMode): Product[] {
  const out = [...list];
  switch (mode) {
    case 'az':
      return out.sort(cmpName);
    case 'za':
      return out.sort((a, b) => cmpName(b, a));
    case 'menor':
      return out.sort((a, b) => priceOf(a) - priceOf(b) || cmpName(a, b));
    case 'maior':
      return out.sort((a, b) => {
        const pa = a.venda ?? a.custo ?? Number.NEGATIVE_INFINITY;
        const pb = b.venda ?? b.custo ?? Number.NEGATIVE_INFINITY;
        return pb - pa || cmpName(a, b);
      });
    case 'categoria':
      return out.sort((a, b) => {
        if (!a.categoria !== !b.categoria) return a.categoria ? -1 : 1; // sem categoria por último
        return norm(a.categoria).localeCompare(norm(b.categoria), 'pt-BR') || cmpName(a, b);
      });
  }
}

export function groupByCategory(sorted: Product[]): { categoria: string; itens: Product[] }[] {
  const groups: { categoria: string; itens: Product[] }[] = [];
  for (const p of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.categoria === p.categoria) last.itens.push(p);
    else groups.push({ categoria: p.categoria, itens: [p] });
  }
  return groups;
}
