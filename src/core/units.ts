import Decimal from 'decimal.js';
import { norm } from './normalize';
import { roundCents } from './money';

export type Family = 'massa' | 'volume' | 'contagem';

const MASS: Record<string, number> = { kg: 1000, g: 1 };
const VOLUME: Record<string, number> = { L: 1000, ml: 1 };

export const BASE_UNITS = ['kg', 'g', 'L', 'ml', 'un', 'pacote', 'caixa', 'frasco'];

const ALIASES: Record<string, string> = {
  kg: 'kg', kgs: 'kg', quilo: 'kg', quilos: 'kg', kilo: 'kg', kilos: 'kg', quilograma: 'kg', quilogramas: 'kg',
  g: 'g', gr: 'g', grs: 'g', grama: 'g', gramas: 'g',
  l: 'L', lt: 'L', lts: 'L', litro: 'L', litros: 'L',
  ml: 'ml', mililitro: 'ml', mililitros: 'ml',
  un: 'un', und: 'un', unid: 'un', unidade: 'un', unidades: 'un', unit: 'un', pc: 'un', pç: 'un', peca: 'un', pecas: 'un',
  pct: 'pacote', pac: 'pacote', pacote: 'pacote', pacotes: 'pacote',
  cx: 'caixa', caixa: 'caixa', caixas: 'caixa',
};

/** Texto livre -> unidade padrão do sistema. Desconhecida = unidade personalizada (mantém o texto). */
export function normalizeUnit(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const key = norm(text).replace(/[.\s]/g, '');
  if (ALIASES[key]) return ALIASES[key];
  return text;
}

export function familyOf(unit: string): Family {
  if (unit in MASS) return 'massa';
  if (unit in VOLUME) return 'volume';
  return 'contagem';
}

function factorOf(unit: string): number | null {
  if (unit in MASS) return MASS[unit];
  if (unit in VOLUME) return VOLUME[unit];
  return null;
}

/** Converte uma quantidade entre unidades da MESMA família. Incompatível (ex.: kg -> L) = null. */
export function convertQty(qty: number | Decimal, from: string, to: string): Decimal | null {
  if (from === to) return new Decimal(qty);
  if (familyOf(from) !== familyOf(to)) return null;
  const f = factorOf(from);
  const t = factorOf(to);
  if (f == null || t == null) return null; // unidades personalizadas não convertem entre si
  return new Decimal(qty).times(f).div(t);
}

export function compatibleUnits(unit: string): string[] {
  const fam = familyOf(unit);
  if (fam === 'massa') return Object.keys(MASS);
  if (fam === 'volume') return Object.keys(VOLUME);
  return [];
}

export function defaultProportional(unit: string): { qtd: number; unidade: string } | null {
  if (unit === 'kg') return { qtd: 100, unidade: 'g' };
  if (unit === 'L') return { qtd: 100, unidade: 'ml' };
  return null;
}

/**
 * Preço proporcional a partir do preço de venda JÁ ARREDONDADO.
 * R$ 59,90/kg -> R$ 5,99 por 100 g. Conversão incompatível -> null.
 */
export function proportionalPrice(
  priceCents: number | null,
  unit: string,
  propQtd: number | null,
  propUnidade: string | null,
  conteudo?: Content | null,
): number | null {
  if (priceCents == null || propQtd == null || !propUnidade || propQtd <= 0) return null;
  // preço por embalagem (pacote, frasco…) com conteúdo informado: R$ 10,00 / pacote de 250 g -> R$ 4,00 por 100 g
  if (conteudo && conteudo.qtd > 0 && familyOf(unit) === 'contagem') {
    const q = convertQty(propQtd, propUnidade, conteudo.unidade);
    if (q == null) return null;
    return roundCents(new Decimal(priceCents).times(q).div(conteudo.qtd));
  }
  const qtyInRefUnit = convertQty(propQtd, propUnidade, unit);
  if (qtyInRefUnit == null) return null;
  return roundCents(new Decimal(priceCents).times(qtyInRefUnit));
}

/** Conteúdo de uma embalagem (ex.: pacote de 250 g). */
export interface Content {
  qtd: number;
  unidade: string;
}

/** Lê o conteúdo da embalagem de um produto (só vale para unidades de contagem: pacote, frasco, caixa…). */
export function contentOf(p: { unidade: string; conteudoQtd?: number | null; conteudoUnidade?: string | null }): Content | null {
  if (!p.conteudoQtd || p.conteudoQtd <= 0 || !p.conteudoUnidade) return null;
  if (familyOf(p.unidade) !== 'contagem') return null;
  if (familyOf(p.conteudoUnidade) === 'contagem') return null;
  return { qtd: p.conteudoQtd, unidade: p.conteudoUnidade };
}

/** Base proporcional padrão para um conteúdo: 100 g / 100 ml. */
export function defaultProportionalForContent(c: Content | null): { qtd: number; unidade: string } | null {
  if (!c) return null;
  const fam = familyOf(c.unidade);
  if (fam === 'massa') return { qtd: 100, unidade: 'g' };
  if (fam === 'volume') return { qtd: 100, unidade: 'ml' };
  return null;
}

// ---------- Balcão: valor em R$ <-> quantidade ----------

export interface CounterBasis {
  /** unidade em que a quantidade é dada: g, ml ou a própria unidade de contagem */
  base: string;
  /** preço (em centavos, sem arredondar) de 1 unidade de `base` */
  perBase: Decimal;
}

/** Preço de 1 g / 1 ml (ou de 1 unidade) a partir do preço de venda. Sem preço = null. */
export function counterBasis(p: { unidade: string; venda: number | null; conteudoQtd?: number | null; conteudoUnidade?: string | null }): CounterBasis | null {
  if (p.venda == null || p.venda <= 0) return null;
  const price = new Decimal(p.venda);
  const fam = familyOf(p.unidade);
  if (fam === 'massa') return { base: 'g', perBase: price.div(MASS[p.unidade]) };
  if (fam === 'volume') return { base: 'ml', perBase: price.div(VOLUME[p.unidade]) };
  const c = contentOf(p);
  if (c) {
    const inBase = convertQty(c.qtd, c.unidade, familyOf(c.unidade) === 'massa' ? 'g' : 'ml');
    if (inBase && inBase.gt(0)) return { base: familyOf(c.unidade) === 'massa' ? 'g' : 'ml', perBase: price.div(inBase) };
  }
  return { base: p.unidade, perBase: price };
}

/** "R$ 10 de açafrão": quanto (em g / ml / unidades) cabe no valor. */
export function quantityForValue(valueCents: number, basis: CounterBasis): number {
  return new Decimal(valueCents).div(basis.perBase).toDecimalPlaces(3).toNumber();
}

/** "250 g de açafrão": quanto custa (centavos, arredondado). */
export function valueForQuantity(qty: number, basis: CounterBasis): number {
  return roundCents(new Decimal(qty).times(basis.perBase));
}

/** 1250 g -> "1,25 kg"; 80 g -> "80 g". */
export function formatCounterQty(qty: number, base: string): string {
  const n = (v: number) => String(Number(v.toFixed(3))).replace('.', ',');
  if (base === 'g' && qty >= 1000) return `${n(qty / 1000)} kg`;
  if (base === 'ml' && qty >= 1000) return `${n(qty / 1000)} L`;
  return `${n(qty)} ${base}`;
}

export function formatQtyUnit(qtd: number, unidade: string): string {
  return `${String(qtd).replace('.', ',')} ${unidade}`;
}

/** "100 g" / "250 ml" -> {qtd, unidade} */
export function parseBase(text: unknown): { qtd: number; unidade: string } | null {
  const m = String(text ?? '')
    .trim()
    .match(/^([\d.,]+)\s*([^\d\s].*)$/);
  if (!m) return null;
  const qtd = Number(m[1].replace(/\./g, '').replace(',', '.'));
  const unidade = normalizeUnit(m[2]);
  if (!Number.isFinite(qtd) || qtd <= 0 || !unidade) return null;
  return { qtd, unidade };
}
