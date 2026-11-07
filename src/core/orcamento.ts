import Decimal from 'decimal.js';
import type { Product, Settings } from '../types';
import { roundCents } from './money';
import { convertQty } from './units';
import { paymentById } from './pricing';

export interface OrcamentoItem {
  key: string;
  produtoId: string;
  qtd: number | null;
  /** unidade em que a quantidade foi informada (a do produto ou uma compatível: g para kg, ml para L) */
  unidade: string;
}

export interface Desconto {
  tipo: 'valor' | 'pct';
  /** valor: centavos · pct: pontos percentuais */
  valor: number | null;
}

/** Subtotal de uma linha: preço de venda × quantidade convertida para a unidade do preço. null = sem preço, sem quantidade ou unidade incompatível. */
export function lineTotal(p: Pick<Product, 'venda' | 'unidade'>, qtd: number | null, unidade: string): number | null {
  if (p.venda == null || !qtd || qtd <= 0) return null;
  const q = convertQty(qtd, unidade, p.unidade);
  if (q == null) return null;
  return roundCents(new Decimal(p.venda).times(q));
}

export interface Totais {
  subtotal: number;
  desconto: number;
  total: number;
}

/** Desconto em R$ ou %, nunca maior que o subtotal. */
export function orcamentoTotais(subtotal: number, d: Desconto): Totais {
  let desc = 0;
  if (d.valor && d.valor > 0) {
    desc = d.tipo === 'pct' ? roundCents(new Decimal(subtotal).times(Math.min(d.valor, 100)).div(100)) : d.valor;
  }
  desc = Math.min(desc, subtotal);
  return { subtotal, desconto: desc, total: subtotal - desc };
}

export interface Pagamento {
  id: string;
  label: string;
  /** 1 = à vista */
  parcelas: number;
}

/** Forma de pagamento escolhida, com o nº de parcelas definido nas taxas da loja (Crédito em 3x = 3). */
export function paymentInfo(s: Settings, id: string): Pagamento {
  const opt = paymentById(s, id);
  const parc = s.taxas.parcelado.find((p) => `parcelado:${p.id}` === opt.id);
  return { id: opt.id, label: opt.label, parcelas: parc?.parcelas ?? 1 };
}

/** Valor de cada parcela (a última absorve o centavo que sobrar). */
export function installments(total: number, parcelas: number): number[] {
  if (parcelas <= 1) return [total];
  const base = Math.floor(total / parcelas);
  const out = Array<number>(parcelas).fill(base);
  out[parcelas - 1] += total - base * parcelas;
  return out;
}
