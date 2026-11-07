import { describe, it, expect } from 'vitest';
import { formatBRL, formatPlain, parseMoney, parseNumberBR, toCents } from '../src/core/money';
import { convertQty, normalizeUnit, proportionalPrice, defaultProportional, familyOf, parseBase } from '../src/core/units';
import { norm } from '../src/core/normalize';
import { calcPrice, marginToMarkup, markupToMargin, paymentOptions } from '../src/core/pricing';
import { defaultSettings } from '../src/core/defaults';
import { sortProducts } from '../src/core/sort';
import type { Product, Settings } from '../src/types';

const prod = (nome: string, venda: number | null, categoria = '', extra: Partial<Product> = {}): Product => ({
  id: nome,
  nome,
  categoria,
  unidade: 'kg',
  custo: null,
  custosAdicionais: 0,
  venda,
  propQtd: 100,
  propUnidade: 'g',
  observacoes: '',
  ...extra,
});

describe('dinheiro', () => {
  it('formata em reais', () => {
    expect(formatBRL(5990)).toBe('R$ 59,90');
    expect(formatBRL(123456789)).toBe('R$ 1.234.567,89');
    expect(formatBRL(5)).toBe('R$ 0,05');
    expect(formatBRL(null)).toBe('—');
    expect(formatPlain(0)).toBe('0,00');
  });
  it('interpreta números brasileiros e americanos', () => {
    expect(parseNumberBR('35,00')).toBe(35);
    expect(parseNumberBR('1.234,50')).toBe(1234.5);
    expect(parseNumberBR('R$ 1.234,50')).toBe(1234.5);
    expect(parseNumberBR('1,234.50')).toBe(1234.5);
    expect(parseNumberBR('35.5')).toBe(35.5);
    expect(parseNumberBR('0.500')).toBe(0.5);
    expect(parseNumberBR('1.234')).toBe(1234);
    expect(parseNumberBR('abc')).toBeNull();
    expect(parseNumberBR('')).toBeNull();
    expect(parseNumberBR('12abc')).toBeNull();
    expect(parseMoney('59,90')).toBe(5990);
  });
  it('arredonda meio para cima em centavos', () => {
    expect(toCents(0.005)).toBe(1);
    expect(toCents(1.005)).toBe(101); // decimal.js, sem erro de ponto flutuante
    expect(toCents(16.2602)).toBe(1626);
  });
});

describe('unidades e preço proporcional', () => {
  it('normaliza variações de unidade', () => {
    expect(normalizeUnit('KG')).toBe('kg');
    expect(normalizeUnit('Quilo')).toBe('kg');
    expect(normalizeUnit('lt')).toBe('L');
    expect(normalizeUnit('Und.')).toBe('un');
    expect(normalizeUnit('pct')).toBe('pacote');
    expect(normalizeUnit('Fardo')).toBe('Fardo');
    expect(normalizeUnit('  ')).toBeNull();
  });
  it('converte só dentro da mesma família', () => {
    expect(convertQty(100, 'g', 'kg')?.toNumber()).toBe(0.1);
    expect(convertQty(2, 'L', 'ml')?.toNumber()).toBe(2000);
    expect(convertQty(1, 'kg', 'L')).toBeNull(); // massa -> volume bloqueado
    expect(convertQty(1, 'un', 'caixa')).toBeNull(); // contagem não converte sem fator
    expect(familyOf('ml')).toBe('volume');
  });
  it('R$ 59,90/kg vira R$ 5,99 por 100 g; R$ 24,90/L vira R$ 2,49 por 100 ml', () => {
    expect(proportionalPrice(5990, 'kg', 100, 'g')).toBe(599);
    expect(proportionalPrice(2490, 'L', 100, 'ml')).toBe(249);
    expect(proportionalPrice(1626, 'kg', 100, 'g')).toBe(163);
    expect(proportionalPrice(5990, 'kg', 100, 'ml')).toBeNull();
    expect(proportionalPrice(null, 'kg', 100, 'g')).toBeNull();
    expect(defaultProportional('kg')).toEqual({ qtd: 100, unidade: 'g' });
    expect(defaultProportional('un')).toBeNull();
  });
  it('lê base proporcional escrita em texto', () => {
    expect(parseBase('100 g')).toEqual({ qtd: 100, unidade: 'g' });
    expect(parseBase('250 ml')).toEqual({ qtd: 250, unidade: 'ml' });
    expect(parseBase('abc')).toBeNull();
  });
});

describe('texto', () => {
  it('ignora acento, caixa e espaços', () => {
    expect(norm('  Contrafilé   BOVINO ')).toBe('contrafile bovino');
    expect(norm('Açúcar')).toBe(norm('acucar'));
  });
});

function settings(over: Partial<Settings> = {}): Settings {
  const s = defaultSettings();
  s.taxas.creditoVista = 3.5;
  s.margem = { modo: 'margem', valor: 20 };
  s.custosFixos = [{ id: 'a', descricao: 'Aluguel', valor: 480000 }];
  s.rateio = { metodo: 'faturamento', faturamentoPrevisto: 4000000, quantidadePrevista: 0 }; // 12%
  s.custosVariaveis = [{ id: 'v', descricao: 'Comissão', tipo: 'percentual', valor: 3 }];
  return { ...s, ...over };
}

describe('motor de preço (gross-up)', () => {
  it('exemplo do planejamento: custo 10, fixos 12%, variáveis 3%, cartão 3,5%, margem 20% = R$ 16,26', () => {
    const r = calcPrice({ custo: 1000, custosAdicionais: 0 }, settings(), 3.5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.denominador).toBe('0,615');
    expect(r.precoCents).toBe(1626);
    // conferência: preço × denominador ≈ custo
    expect(Math.abs((1626 * 0.615) - 1000)).toBeLessThan(1);
  });
  it('as linhas do detalhamento somam exatamente o preço', () => {
    const r = calcPrice({ custo: 1000, custosAdicionais: 150 }, settings({ perdaPct: 5 }), 3.5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.linhas.reduce((a, l) => a + l.cents, 0)).toBe(r.precoCents);
    const lucro = r.linhas.find((l) => l.key === 'lucro')!;
    expect(lucro.cents).toBe(r.lucroCents);
    expect(r.margemPct).toBeGreaterThan(19.5);
    expect(r.margemPct).toBeLessThan(20.5);
  });
  it('mostra os valores do detalhamento do exemplo', () => {
    const r = calcPrice({ custo: 1000, custosAdicionais: 0 }, settings(), 3.5);
    if (!r.ok) throw new Error('falhou');
    const by = Object.fromEntries(r.linhas.map((l) => [l.key, l.cents]));
    expect(by.custo).toBe(1000);
    expect(by.fixopct).toBe(195); // 12% de 16,26
    expect(by.varpct).toBe(49); // 3%
    expect(by.taxa).toBe(57); // 3,5%
    expect(by.lucro).toBe(325);
  });
  it('perdas aumentam o custo efetivo', () => {
    const s = settings();
    s.custosFixos = [];
    s.custosVariaveis = [];
    s.taxas.creditoVista = 0;
    s.margem = { modo: 'margem', valor: 0 };
    s.perdaPct = 10;
    const r = calcPrice({ custo: 900, custosAdicionais: 0 }, s, 0);
    if (!r.ok) throw new Error('falhou');
    expect(r.precoCents).toBe(1000);
  });
  it('markup 25% equivale a margem 20% (sem taxas)', () => {
    const s = defaultSettings();
    s.margem = { modo: 'markup', valor: 25 };
    const r = calcPrice({ custo: 1000, custosAdicionais: 0 }, s, 0);
    if (!r.ok) throw new Error('falhou');
    expect(r.precoCents).toBe(1250);
    expect(r.markupPct).toBeCloseTo(25, 5);
    expect(r.margemPct).toBeCloseTo(20, 5);
    expect(marginToMarkup(20)).toBeCloseTo(25, 8);
    expect(markupToMargin(25)).toBeCloseTo(20, 8);
  });
  it('margem 30% sobre o preço NÃO é 30% de acréscimo sobre o custo', () => {
    const s = defaultSettings();
    s.margem = { modo: 'margem', valor: 30 };
    const r = calcPrice({ custo: 1000, custosAdicionais: 0 }, s, 0);
    if (!r.ok) throw new Error('falhou');
    expect(r.precoCents).toBe(1429); // 10 / 0,7
  });
  it('rateio por quantidade vendida soma valor por unidade', () => {
    const s = defaultSettings();
    s.custosFixos = [{ id: 'a', descricao: 'Aluguel', valor: 300000 }];
    s.rateio = { metodo: 'quantidade', faturamentoPrevisto: 0, quantidadePrevista: 1000 }; // R$ 3,00 por unidade
    s.margem = { modo: 'margem', valor: 0 };
    const r = calcPrice({ custo: 1000, custosAdicionais: 0 }, s, 0);
    if (!r.ok) throw new Error('falhou');
    expect(r.precoCents).toBe(1300);
  });
  it('custos variáveis em R$ entram no custo efetivo', () => {
    const s = defaultSettings();
    s.custosVariaveis = [{ id: 'e', descricao: 'Embalagem', tipo: 'valor', valor: 50 }];
    s.margem = { modo: 'margem', valor: 0 };
    const r = calcPrice({ custo: 1000, custosAdicionais: 0 }, s, 0);
    if (!r.ok) throw new Error('falhou');
    expect(r.precoCents).toBe(1050);
  });
  it('bloqueia combinações inviáveis e entradas incompletas', () => {
    const s = settings();
    s.margem = { modo: 'margem', valor: 90 };
    const r = calcPrice({ custo: 1000, custosAdicionais: 0 }, s, 3.5);
    expect(r.ok).toBe(false);
    expect(calcPrice({ custo: null, custosAdicionais: 0 }, settings(), 0).ok).toBe(false);
    const semFat = settings();
    semFat.rateio.faturamentoPrevisto = 0;
    expect(calcPrice({ custo: 1000, custosAdicionais: 0 }, semFat, 0).ok).toBe(false);
    const m100 = settings();
    m100.margem = { modo: 'margem', valor: 100 };
    expect(calcPrice({ custo: 1000, custosAdicionais: 0 }, m100, 0).ok).toBe(false);
  });
  it('lista as formas de pagamento com suas taxas', () => {
    const opts = paymentOptions(settings());
    expect(opts.map((o) => o.id).slice(0, 3)).toEqual(['pix', 'debito', 'credito_vista']);
    expect(opts.find((o) => o.id === 'credito_vista')?.taxa).toBe(3.5);
    expect(opts.length).toBe(5);
  });
});

describe('ordenação', () => {
  const list = [prod('Zimbro', 500, 'B'), prod('Açafrão', 9000, 'A'), prod('Canela', 1200, 'A'), prod('Sem preço', null, '')];
  it('alfabética', () => {
    expect(sortProducts(list, 'az').map((p) => p.nome)).toEqual(['Açafrão', 'Canela', 'Sem preço', 'Zimbro']);
    expect(sortProducts(list, 'za').map((p) => p.nome)).toEqual(['Zimbro', 'Sem preço', 'Canela', 'Açafrão']);
  });
  it('por preço', () => {
    expect(sortProducts(list, 'menor').map((p) => p.nome)).toEqual(['Zimbro', 'Canela', 'Açafrão', 'Sem preço']);
    expect(sortProducts(list, 'maior').map((p) => p.nome)).toEqual(['Açafrão', 'Canela', 'Zimbro', 'Sem preço']);
  });
  it('por categoria, sem categoria por último', () => {
    expect(sortProducts(list, 'categoria').map((p) => p.nome)).toEqual(['Açafrão', 'Canela', 'Zimbro', 'Sem preço']);
  });
});
