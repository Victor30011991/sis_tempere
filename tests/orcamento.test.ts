import { describe, it, expect } from 'vitest';
import { installments, lineTotal, orcamentoTotais, paymentInfo } from '../src/core/orcamento';
import { buildOrcamentoPdf, type OrcamentoPdfData } from '../src/export/orcamentoPdf';
import { buildPdf } from '../src/export/pdf';
import { defaultSettings, defaultStore } from '../src/core/defaults';

describe('orçamento: cálculos', () => {
  const kg = { venda: 35000, unidade: 'kg' }; // R$ 350,00/kg
  it('subtotal converte a unidade (250 g de um produto vendido por kg)', () => {
    expect(lineTotal(kg, 2, 'kg')).toBe(70000);
    expect(lineTotal(kg, 250, 'g')).toBe(8750);
    expect(lineTotal({ venda: 1290, unidade: 'un' }, 3, 'un')).toBe(3870);
  });
  it('sem preço, sem quantidade ou unidade incompatível = sem subtotal', () => {
    expect(lineTotal({ venda: null, unidade: 'kg' }, 1, 'kg')).toBeNull();
    expect(lineTotal(kg, null, 'kg')).toBeNull();
    expect(lineTotal(kg, 0, 'kg')).toBeNull();
    expect(lineTotal(kg, 1, 'L')).toBeNull();
  });
  it('desconto em R$ ou %, limitado ao subtotal', () => {
    expect(orcamentoTotais(10000, { tipo: 'valor', valor: 1500 })).toEqual({ subtotal: 10000, desconto: 1500, total: 8500 });
    expect(orcamentoTotais(10000, { tipo: 'pct', valor: 10 })).toEqual({ subtotal: 10000, desconto: 1000, total: 9000 });
    expect(orcamentoTotais(10000, { tipo: 'valor', valor: 99999 }).total).toBe(0);
    expect(orcamentoTotais(10000, { tipo: 'pct', valor: 250 }).total).toBe(0);
    expect(orcamentoTotais(10000, { tipo: 'valor', valor: null }).total).toBe(10000);
  });
  it('pagamento usa as regras da loja e as parcelas somam o total', () => {
    const s = defaultSettings();
    expect(paymentInfo(s, 'pix')).toMatchObject({ label: 'Dinheiro ou Pix', parcelas: 1 });
    const p3 = s.taxas.parcelado.find((p) => p.parcelas === 3)!;
    expect(paymentInfo(s, `parcelado:${p3.id}`).parcelas).toBe(3);
    const parc = installments(10000, 3);
    expect(parc).toEqual([3333, 3333, 3334]);
    expect(parc.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(installments(10000, 1)).toEqual([10000]);
  });
});

describe('orçamento: PDF', () => {
  const data: OrcamentoPdfData = {
    cliente: { nome: 'Maria da Silva', telefone: '(11) 99999-0000', endereco: 'Rua das Flores, 10' },
    linhas: [{ nome: 'Acafrao Teste', qtd: '250 g', unitario: 'R$ 350,00 / kg', subtotal: 8750 }],
    subtotal: 8750, desconto: 750, descontoLabel: '', total: 8000,
    pagamento: { label: 'Crédito em 2x', parcelas: 2 }, observacoes: 'Entrega na sexta',
  };
  it('gera um PDF com cliente, itens, total, parcelas e observações', async () => {
    const buf = await buildOrcamentoPdf(data, defaultStore(), null);
    const t = Buffer.from(buf).toString('latin1');
    expect(t.startsWith('%PDF')).toBe(true);
    for (const x of ['Maria da Silva', 'Acafrao Teste', '80,00', '2 parcelas de R$', 'Entrega na sexta', 'sem valor fiscal']) expect(t).toContain(x);
  });
});

describe('PDF de inventário com todas as colunas cabe na página', () => {
  it('vira paisagem quando há 6 ou mais colunas e continua retrato no catálogo', async () => {
    const loja = defaultStore();
    const prod = [{ id: 'a', nome: 'Acafrao', categoria: 'Esp', unidade: 'kg', custo: 100, custosAdicionais: 0, venda: 200, propQtd: 100, propUnidade: 'g', observacoes: '', estoque: 2 }];
    const base = { titulo: 'L', modoPreco: 'ambos', ordem: 'az', mostrarCategoria: true, loja: { nome: true, razao: false, cnpj: false, endereco: false, telefone: false, informacoes: false }, rodape: '', mostrarData: false } as never;
    const full = Buffer.from(await buildPdf(prod as never, loja, null, { ...(base as object), layout: 'inventario', mostrarCusto: true, mostrarSugerido: true, mostrarEstoque: true } as never)).toString('latin1');
    const plain = Buffer.from(await buildPdf(prod as never, loja, null, base)).toString('latin1');
    expect(full).toMatch(/MediaBox \[0 0 841\.88/);
    expect(plain).toMatch(/MediaBox \[0 0 595\.27/);
  });
});
