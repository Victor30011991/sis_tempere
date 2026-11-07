import Decimal from 'decimal.js';
import type { Settings } from '../types';
import { formatBRL, formatPercent, roundCents } from './money';
import { convertQty } from './units';

const D = (n: number | string | Decimal) => new Decimal(n);

export interface PaymentOption {
  id: string;
  label: string;
  taxa: number;
}

export function paymentOptions(s: Settings): PaymentOption[] {
  const list: PaymentOption[] = [
    { id: 'pix', label: 'Dinheiro ou Pix', taxa: 0 },
    { id: 'debito', label: 'Cartão de débito', taxa: s.taxas.debito },
    { id: 'credito_vista', label: 'Crédito à vista', taxa: s.taxas.creditoVista },
  ];
  [...s.taxas.parcelado]
    .sort((a, b) => a.parcelas - b.parcelas)
    .forEach((p) => list.push({ id: `parcelado:${p.id}`, label: `Crédito em ${p.parcelas}x`, taxa: p.taxa }));
  return list;
}

export function paymentById(s: Settings, id: string): PaymentOption {
  const all = paymentOptions(s);
  return all.find((p) => p.id === id) ?? all.find((p) => p.id === 'credito_vista') ?? all[0];
}

export function totals(s: Settings) {
  const fixos = s.custosFixos.reduce((a, c) => a.plus(c.valor), D(0));
  const varPct = s.custosVariaveis.filter((c) => c.tipo === 'percentual').reduce((a, c) => a.plus(c.valor), D(0));
  const varValor = s.custosVariaveis.filter((c) => c.tipo === 'valor').reduce((a, c) => a.plus(c.valor), D(0));
  return { fixosCents: fixos.toNumber(), variaveisPct: varPct.toNumber(), variaveisCents: varValor.toNumber() };
}

/** Percentual de custos fixos sobre o preço (método faturamento). null = não aplicável/inválido. */
export function fixedPercentOfPrice(s: Settings): number | null {
  const { fixosCents } = totals(s);
  if (s.rateio.metodo !== 'faturamento' || fixosCents === 0) return 0;
  if (s.rateio.faturamentoPrevisto <= 0) return null;
  return D(fixosCents).div(s.rateio.faturamentoPrevisto).times(100).toNumber();
}

/** Margem sobre o preço (fração) equivalente ao que o usuário informou. */
export function marginFraction(m: Settings['margem']): Decimal | null {
  const v = D(m.valor).div(100);
  if (v.lt(0)) return null;
  if (m.modo === 'markup') return v.div(v.plus(1));
  if (v.gte(1)) return null;
  return v;
}

/** Converte entre margem e markup (ambos em pontos percentuais). */
export function marginToMarkup(marginPoints: number): number | null {
  if (marginPoints >= 100) return null;
  return D(marginPoints).div(D(100).minus(marginPoints)).times(100).toNumber();
}
export function markupToMargin(markupPoints: number): number {
  return D(markupPoints).div(D(100).plus(markupPoints)).times(100).toNumber();
}

export interface BreakdownLine {
  key: string;
  label: string;
  cents: number;
  /** % do preço de venda */
  pct: number;
  tipo: 'custo' | 'percentual' | 'lucro';
}

export type PriceResult =
  | {
      ok: true;
      precoCents: number;
      linhas: BreakdownLine[];
      margemPct: number;
      markupPct: number;
      lucroCents: number;
      denominador: string;
      formula: string;
    }
  | { ok: false; motivo: string };

export interface PriceInput {
  custo: number | null;
  custosAdicionais: number;
}

const fmtFrac = (d: Decimal) => d.toDecimalPlaces(6).toString().replace('.', ',');

/**
 * Preço = custo efetivo ÷ (1 − margem − taxa − variáveis% − fixos%)
 * (gross-up: taxas, margem e rateio incidem sobre o PREÇO, não sobre o custo).
 */
export function calcPrice(prod: PriceInput, s: Settings, taxaPct: number): PriceResult {
  if (prod.custo == null) return { ok: false, motivo: 'Este produto está sem custo de aquisição.' };
  const custo = D(prod.custo);

  const perda = D(s.perdaPct).div(100);
  if (perda.lt(0) || perda.gte(1)) return { ok: false, motivo: 'A perda deve ficar entre 0% e 100%.' };
  const custoComPerda = custo.div(D(1).minus(perda));

  const adic = D(prod.custosAdicionais || 0);
  const t = totals(s);
  const varValor = D(t.variaveisCents);
  const varFrac = D(t.variaveisPct).div(100);

  let fixosFrac = D(0);
  let fixosUnit = D(0);
  if (t.fixosCents > 0) {
    if (s.rateio.metodo === 'faturamento') {
      if (s.rateio.faturamentoPrevisto <= 0)
        return { ok: false, motivo: 'Informe o faturamento mensal previsto (aba “Margem e rateio”) para ratear os custos fixos.' };
      fixosFrac = D(t.fixosCents).div(s.rateio.faturamentoPrevisto);
    } else {
      if (s.rateio.quantidadePrevista <= 0)
        return { ok: false, motivo: 'Informe a quantidade mensal prevista (aba “Margem e rateio”) para ratear os custos fixos.' };
      fixosUnit = D(t.fixosCents).div(s.rateio.quantidadePrevista);
    }
  }

  const margem = marginFraction(s.margem);
  if (margem == null) return { ok: false, motivo: 'Margem inválida: use um valor entre 0% e 99,99% (ou markup maior ou igual a 0%).' };

  const taxa = D(taxaPct).div(100);
  const soma = margem.plus(taxa).plus(varFrac).plus(fixosFrac);
  const denom = D(1).minus(soma);
  if (denom.lte(0)) {
    return {
      ok: false,
      motivo: `Combinação inviável: margem (${formatPercent(margem.times(100).toNumber())}) + taxa (${formatPercent(taxaPct)}) + variáveis (${formatPercent(
        varFrac.times(100).toNumber(),
      )}) + fixos (${formatPercent(fixosFrac.times(100).toNumber())}) somam ${formatPercent(soma.times(100).toNumber())} do preço, sobra nada para o custo.`,
    };
  }

  const custoEf = custoComPerda.plus(adic).plus(varValor).plus(fixosUnit);
  const preco = custoEf.div(denom);
  const precoCents = roundCents(preco);
  if (precoCents <= 0) return { ok: false, motivo: 'O preço calculado ficou zerado.' };

  const pc = (c: number) => (precoCents ? (c / precoCents) * 100 : 0);
  const linhas: BreakdownLine[] = [];
  const push = (key: string, label: string, cents: number, tipo: BreakdownLine['tipo']) => {
    if (cents !== 0 || key === 'custo') linhas.push({ key, label, cents, pct: pc(cents), tipo });
  };
  push('custo', 'Custo de aquisição', prod.custo, 'custo');
  push('perda', `Perdas (${formatPercent(s.perdaPct)} do custo)`, roundCents(custoComPerda.minus(custo)), 'custo');
  push('adic', 'Custos adicionais do produto', roundCents(adic), 'custo');
  push('varvalor', 'Custos variáveis em R$ (embalagem etc.)', roundCents(varValor), 'custo');
  push('fixounit', 'Custos fixos por unidade vendida', roundCents(fixosUnit), 'custo');
  const fixosPctCents = roundCents(D(precoCents).times(fixosFrac));
  const varPctCents = roundCents(D(precoCents).times(varFrac));
  const taxaCents = roundCents(D(precoCents).times(taxa));
  push('fixopct', `Custos fixos rateados (${formatPercent(fixosFrac.times(100).toNumber())} do preço)`, fixosPctCents, 'percentual');
  push('varpct', `Custos variáveis (${formatPercent(varFrac.times(100).toNumber())} do preço)`, varPctCents, 'percentual');
  push('taxa', `Taxa do cartão (${formatPercent(taxaPct)} do preço)`, taxaCents, 'percentual');
  const somaOutros = linhas.reduce((a, l) => a + l.cents, 0);
  const lucro = precoCents - somaOutros; // o lucro absorve a diferença de arredondamento dos centavos
  linhas.push({ key: 'lucro', label: 'Lucro', cents: lucro, pct: pc(lucro), tipo: 'lucro' });

  const margemPct = pc(lucro);
  const custosTotais = precoCents - lucro;
  const markupPct = custosTotais > 0 ? (lucro / custosTotais) * 100 : 0;

  const partes = [`1 − ${fmtFrac(margem)}`];
  if (!taxa.isZero()) partes.push(`${fmtFrac(taxa)}`);
  if (!varFrac.isZero()) partes.push(`${fmtFrac(varFrac)}`);
  if (!fixosFrac.isZero()) partes.push(`${fmtFrac(fixosFrac)}`);
  const formula =
    `Preço = custo efetivo ÷ (1 − margem − taxa − variáveis − fixos) = ` +
    `${formatBRL(roundCents(custoEf))} ÷ (${partes.join(' − ')}) = ${formatBRL(roundCents(custoEf))} ÷ ${fmtFrac(denom)} = ${formatBRL(precoCents)}`;

  return { ok: true, precoCents, linhas, margemPct, markupPct, lucroCents: lucro, denominador: fmtFrac(denom), formula };
}

/** Preço sugerido (centavos) para um produto com as premissas e a forma de pagamento base. null = sem custo ou cálculo inviável. */
export function suggestedCents(prod: PriceInput, s: Settings): number | null {
  const r = calcPrice(prod, s, paymentById(s, s.pagamentoBase).taxa);
  return r.ok ? r.precoCents : null;
}

// ---------- Compra por lote (custo de aquisição) ----------

export interface PurchaseInput {
  /** quantidade comprada, na unidade `unidadeCompra` */
  qtd: number;
  unidadeCompra: string;
  /** unidade em que o custo do produto é informado */
  unidadeProduto: string;
  /** valor da mercadoria (centavos), sem frete e impostos */
  valorTotal: number;
  frete?: number;
  /** impostos de entrada em R$ (ICMS-ST, IPI…) */
  impostosValor?: number;
  /** impostos de entrada em % sobre o valor da mercadoria */
  impostosPct?: number;
  outras?: number;
  desconto?: number;
}

export type PurchaseResult =
  | { ok: true; qtdNaUnidade: number; totalCents: number; custoUnitCents: number; linhas: { label: string; cents: number }[] }
  | { ok: false; motivo: string };

/** Custo efetivo da compra: (mercadoria + frete + impostos + outras − desconto) ÷ quantidade, na unidade do produto. */
export function purchaseCost(i: PurchaseInput): PurchaseResult {
  if (!(i.qtd > 0)) return { ok: false, motivo: 'Informe a quantidade comprada.' };
  if (!(i.valorTotal >= 0)) return { ok: false, motivo: 'Informe o valor da compra.' };
  const q = convertQty(i.qtd, i.unidadeCompra, i.unidadeProduto);
  if (q == null) return { ok: false, motivo: `Não é possível converter ${i.unidadeCompra} em ${i.unidadeProduto}.` };
  const pct = D(i.impostosPct ?? 0);
  if (pct.lt(0)) return { ok: false, motivo: 'Imposto em % não pode ser negativo.' };
  const impPct = D(i.valorTotal).times(pct).div(100);
  const total = D(i.valorTotal)
    .plus(i.frete ?? 0)
    .plus(i.impostosValor ?? 0)
    .plus(impPct)
    .plus(i.outras ?? 0)
    .minus(i.desconto ?? 0);
  if (total.lte(0)) return { ok: false, motivo: 'O total da compra ficou zerado ou negativo.' };
  const linhas = [{ label: 'Mercadoria', cents: i.valorTotal }];
  if (i.frete) linhas.push({ label: 'Frete', cents: i.frete });
  if (i.impostosValor || !pct.isZero()) linhas.push({ label: 'Impostos de entrada', cents: roundCents(D(i.impostosValor ?? 0).plus(impPct)) });
  if (i.outras) linhas.push({ label: 'Outras despesas', cents: i.outras });
  if (i.desconto) linhas.push({ label: 'Desconto', cents: -i.desconto });
  return { ok: true, qtdNaUnidade: q.toNumber(), totalCents: roundCents(total), custoUnitCents: roundCents(total.div(q)), linhas };
}

/**
 * Custo médio ponderado: (estoque × custo atual + total da compra) ÷ (estoque + quantidade comprada).
 * Sem estoque ou sem custo atual, o custo médio é o próprio custo da compra.
 */
export function weightedAverageCost(estoque: number | null | undefined, custoAtual: number | null, qtdCompra: number, totalCompraCents: number): number | null {
  if (!(qtdCompra > 0)) return null;
  if (!estoque || estoque <= 0 || custoAtual == null) return roundCents(D(totalCompraCents).div(qtdCompra));
  return roundCents(D(estoque).times(custoAtual).plus(totalCompraCents).div(D(estoque).plus(qtdCompra)));
}
