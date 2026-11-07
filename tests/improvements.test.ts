import { describe, it, expect } from 'vitest';
import { calcPrice, purchaseCost, suggestedCents, weightedAverageCost } from '../src/core/pricing';
import { contentOf, counterBasis, formatCounterQty, proportionalPrice, quantityForValue, valueForQuantity } from '../src/core/units';
import { buildExtras, mergeExtras } from '../src/core/extras';
import { buildPdf, type PdfOptions } from '../src/export/pdf';
import { buildWorkbook, readWorkbook } from '../src/export/excel';
import { defaultSettings, defaultStore } from '../src/core/defaults';
import type { Product } from '../src/types';

const p = (over: Partial<Product>): Product => ({
  id: 'x', nome: 'Produto', categoria: '', unidade: 'kg', custo: null, custosAdicionais: 0, venda: null, propQtd: 100, propUnidade: 'g', observacoes: '', ...over,
});

describe('custo de compra (lote)', () => {
  it('soma frete, impostos em R$ e em %, e divide pela quantidade', () => {
    const r = purchaseCost({ qtd: 10, unidadeCompra: 'kg', unidadeProduto: 'kg', valorTotal: 100000, frete: 5000, impostosPct: 5, impostosValor: 5000 });
    expect(r).toMatchObject({ ok: true, totalCents: 115000, custoUnitCents: 11500 });
  });
  it('converte a unidade da compra (5.000 g viram 5 kg)', () => {
    const r = purchaseCost({ qtd: 5000, unidadeCompra: 'g', unidadeProduto: 'kg', valorTotal: 50000 });
    expect(r).toMatchObject({ ok: true, qtdNaUnidade: 5, custoUnitCents: 10000 });
  });
  it('aplica desconto e recusa unidades incompatíveis ou total inválido', () => {
    expect(purchaseCost({ qtd: 2, unidadeCompra: 'kg', unidadeProduto: 'kg', valorTotal: 10000, desconto: 2000 })).toMatchObject({ ok: true, custoUnitCents: 4000 });
    expect(purchaseCost({ qtd: 2, unidadeCompra: 'L', unidadeProduto: 'kg', valorTotal: 10000 }).ok).toBe(false);
    expect(purchaseCost({ qtd: 0, unidadeCompra: 'kg', unidadeProduto: 'kg', valorTotal: 10000 }).ok).toBe(false);
    expect(purchaseCost({ qtd: 1, unidadeCompra: 'kg', unidadeProduto: 'kg', valorTotal: 1000, desconto: 5000 }).ok).toBe(false);
  });
  it('custo médio ponderado pelo estoque', () => {
    // 10 kg a R$ 20,00 + compra de 10 kg por R$ 300,00 (R$ 30,00/kg) = R$ 25,00/kg
    expect(weightedAverageCost(10, 2000, 10, 30000)).toBe(2500);
    expect(weightedAverageCost(0, 2000, 10, 30000)).toBe(3000); // sem estoque: custo da compra
    expect(weightedAverageCost(null, null, 4, 10000)).toBe(2500);
  });
  it('o custo da compra alimenta o motor sem alterá-lo (gross-up idêntico)', () => {
    const s = defaultSettings();
    const compra = purchaseCost({ qtd: 10, unidadeCompra: 'kg', unidadeProduto: 'kg', valorTotal: 100000, frete: 10000 });
    expect(compra.ok && compra.custoUnitCents).toBe(11000);
    const r = calcPrice({ custo: 11000, custosAdicionais: 0 }, s, 0);
    expect(r.ok && r.precoCents).toBe(Math.round(11000 / 0.7)); // margem padrão 30%
    expect(suggestedCents({ custo: 11000, custosAdicionais: 0 }, s)).toBe(r.ok ? r.precoCents : null);
    expect(suggestedCents({ custo: null, custosAdicionais: 0 }, s)).toBeNull();
  });
});

describe('embalagem com conteúdo (pacote, frasco)', () => {
  it('preço proporcional de um pacote de 250 g', () => {
    expect(proportionalPrice(1000, 'pacote', 100, 'g', { qtd: 250, unidade: 'g' })).toBe(400);
    expect(proportionalPrice(2500, 'frasco', 100, 'ml', { qtd: 500, unidade: 'ml' })).toBe(500);
    expect(proportionalPrice(1000, 'pacote', 100, 'g', { qtd: 1, unidade: 'kg' })).toBe(100);
  });
  it('sem conteúdo ou com unidade de massa, o cálculo antigo é o mesmo', () => {
    expect(proportionalPrice(5990, 'kg', 100, 'g')).toBe(599);
    expect(proportionalPrice(5990, 'kg', 100, 'g', { qtd: 250, unidade: 'g' })).toBe(599); // conteúdo ignorado em kg
    expect(proportionalPrice(1000, 'pacote', 100, 'g')).toBeNull();
    expect(proportionalPrice(1000, 'pacote', 100, 'ml', { qtd: 250, unidade: 'g' })).toBeNull(); // massa x volume
  });
  it('contentOf só vale para unidades de contagem', () => {
    expect(contentOf(p({ unidade: 'pacote', conteudoQtd: 250, conteudoUnidade: 'g' }))).toEqual({ qtd: 250, unidade: 'g' });
    expect(contentOf(p({ unidade: 'kg', conteudoQtd: 250, conteudoUnidade: 'g' }))).toBeNull();
    expect(contentOf(p({ unidade: 'pacote' }))).toBeNull();
  });
});

describe('balcão', () => {
  const acafrao = p({ unidade: 'kg', venda: 35000 }); // R$ 350,00/kg
  it('R$ 10 de açafrão e 100 g de açafrão', () => {
    const b = counterBasis(acafrao)!;
    expect(b.base).toBe('g');
    expect(quantityForValue(1000, b)).toBe(28.571);
    expect(formatCounterQty(quantityForValue(1000, b), b.base)).toBe('28,571 g');
    expect(valueForQuantity(100, b)).toBe(3500);
    expect(formatCounterQty(1250, 'g')).toBe('1,25 kg');
  });
  it('pacote com conteúdo funciona por peso; unidade simples por unidade; sem preço = nulo', () => {
    const pac = counterBasis(p({ unidade: 'pacote', venda: 1000, conteudoQtd: 250, conteudoUnidade: 'g' }))!;
    expect(pac.base).toBe('g');
    expect(valueForQuantity(100, pac)).toBe(400);
    const un = counterBasis(p({ unidade: 'un', venda: 1290 }))!;
    expect(un.base).toBe('un');
    expect(valueForQuantity(2, un)).toBe(2580);
    expect(counterBasis(p({ venda: null }))).toBeNull();
  });
});

describe('PDF: catálogo x inventário', () => {
  const loja = defaultStore();
  const lista = [
    p({ id: 'a', nome: 'Acafrao Teste', categoria: 'Esp', custo: 20000, venda: 35000, estoque: 7.5 }),
    p({ id: 'b', nome: 'SemPreco', categoria: 'Esp', custo: 4321, venda: null, estoque: 3 }),
  ];
  const base: PdfOptions = { titulo: 'Lista', modoPreco: 'ref', ordem: 'az', mostrarCategoria: true, loja: { nome: true, razao: false, cnpj: false, endereco: false, telefone: false, informacoes: false }, rodape: '', mostrarData: false };
  const text = async (o: Partial<PdfOptions>) => Buffer.from(await buildPdf(lista, loja, null, { ...base, ...o })).toString('latin1');

  it('catálogo (padrão) não mostra custo, sugerido nem estoque e omite quem não tem preço', async () => {
    const t = await text({ sugeridos: { a: 28571 } });
    expect(t).toContain('Acafrao Teste');
    expect(t).not.toContain('SemPreco');
    expect(t).not.toContain('200,00');
    expect(t).not.toContain('285,71');
    expect(t).not.toContain('Estoque');
  });
  it('inventário mostra custo, sugerido e estoque de todos os produtos', async () => {
    const t = await text({ layout: 'inventario', mostrarCusto: true, mostrarSugerido: true, mostrarEstoque: true, sugeridos: { a: 28571 } });
    expect(t).toContain('SemPreco');
    expect(t).toContain('200,00');
    expect(t).toContain('285,71');
    expect(t).toContain('7,5 kg');
    expect(t).toContain('Estoque');
  });
  it('dá para ocultar os preços de venda', async () => {
    const t = await text({ layout: 'inventario', mostrarPreco: false, mostrarEstoque: true });
    expect(t).not.toContain('350,00');
    expect(t).toContain('SemPreco');
  });
});

describe('Excel: estoque e conteúdo da embalagem sobrevivem ao salvar e reimportar', () => {
  it('ida e volta pela aba oculta de configurações', async () => {
    const original = [
      p({ id: 'a', nome: 'Cúrcuma', categoria: 'Esp', unidade: 'pacote', custo: 600, venda: 1000, conteudoQtd: 250, conteudoUnidade: 'g', estoque: 12, propQtd: 100, propUnidade: 'g' }),
      p({ id: 'b', nome: 'Pimenta', categoria: 'Esp', unidade: 'kg', custo: 3000, venda: 5000 }),
    ];
    const buf = await buildWorkbook({ nome: 'L', categorias: ['Esp'], produtos: original }, defaultStore(), defaultSettings());
    const lido = await readWorkbook(buf);
    expect(lido.config?.extras).toEqual({ 'curcuma|esp|pacote': { estoque: 12, conteudoQtd: 250, conteudoUnidade: 'g' } });
    // reimportado como produtos novos (IDs diferentes): os extras voltam pelo nome+categoria+unidade
    const novos = original.map((o) => ({ ...o, id: 'novo-' + o.id, estoque: undefined, conteudoQtd: undefined, conteudoUnidade: undefined }));
    const merged = mergeExtras(novos, lido.config?.extras);
    expect(merged[0]).toMatchObject({ estoque: 12, conteudoQtd: 250, conteudoUnidade: 'g' });
    expect(merged[1].estoque).toBeUndefined();
    expect(buildExtras(merged)).toEqual(lido.config?.extras);
  });
  it('arquivos antigos (sem extras) continuam abrindo', () => {
    const ps = [p({ nome: 'A' })];
    expect(mergeExtras(ps, undefined)).toBe(ps);
  });
});
