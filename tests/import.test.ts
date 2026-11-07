import { describe, it, expect } from 'vitest';
import { decodeText, detectDelimiter, parseDelimited, type Rows } from '../src/import/text';
import { buildDetection, detectHeaderRow, duplicateTargets } from '../src/import/detect';
import { extractRows } from '../src/import/extract';
import { applyPlan, buildPlan, DEFAULT_UPDATE_FIELDS, undoImport, type Decision, type UpdateFields } from '../src/import/plan';
import type { Product } from '../src/types';

const p = (over: Partial<Product>): Product => ({
  id: 'P1',
  nome: 'Alcatra',
  categoria: 'Bovinos',
  unidade: 'kg',
  custo: 3500,
  custosAdicionais: 0,
  venda: 5500,
  propQtd: 100,
  propUnidade: 'g',
  observacoes: '',
  ...over,
});

const supplier: Rows = [
  ['AÇOUGUE BOM CORTE LTDA', null, null, null],
  ['Rua das Flores, 123 - Centro', null, null, null],
  ['Tel: (11) 4000-0000', null, null, null],
  [null, null, null, null],
  ['Produto', 'Categoria', 'Custo/kg', 'Obs'],
  ['Alcatra', 'Bovinos', '35,00', null],
  ['Picanha', 'Bovinos', '55,00', null],
  ['Contrafilé', 'Bovinos', '38,00', 'maturado'],
  ['BOVINOS ESPECIAIS', null, null, null],
  ['Fraldinha', 'Bovinos', 'abc', null],
  ['Maminha', 'Bovinos', null, null],
  [null, null, null, null],
  ['Total geral', null, '128,00', null],
  ['Observação: preços sujeitos a alteração', null, null, null],
];

describe('detecção da tabela real', () => {
  it('acha o cabeçalho ignorando título, endereço e telefone', () => {
    expect(detectHeaderRow(supplier)).toBe(4);
  });
  it('reconhece variações de nomes de colunas e a unidade no cabeçalho', () => {
    const det = buildDetection(supplier, 4);
    expect(det.mapping).toEqual(['nome', 'categoria', 'custo', 'observacoes']);
    expect(det.unitHint).toBe('kg');
    expect(det.ambiguas).toEqual([]);
  });
  it('reconhece sinônimos (Descrição / Grupo / Preço de compra / Valor / Medida)', () => {
    const rows: Rows = [['Descrição', 'Grupo', 'Preço de compra', 'Valor', 'Medida'], ['Canela', 'Temperos', '10,00', '18,00', 'pct']];
    const det = buildDetection(rows, detectHeaderRow(rows)!);
    expect(det.mapping).toEqual(['nome', 'categoria', 'custo', 'venda', 'unidade']);
    expect(det.ambiguas).toEqual([]);
  });
  it('marca coluna genérica "Preço" como ambígua quando não há coluna de custo', () => {
    const rows: Rows = [['Item', 'Preço'], ['Sal', '3,50']];
    const det = buildDetection(rows, detectHeaderRow(rows)!);
    expect(det.mapping).toEqual(['nome', 'venda']);
    expect(det.ambiguas).toEqual([1]);
  });
  it('não aceita arquivo sem tabela reconhecível', () => {
    expect(detectHeaderRow([['Olá mundo'], ['bla bla'], ['123']])).toBeNull();
  });
  it('detecta colunas mapeadas duas vezes', () => {
    expect(duplicateTargets(['nome', 'custo', 'custo'])).toEqual(['custo']);
  });
});

describe('extração de linhas', () => {
  const det = buildDetection(supplier, 4);
  const ex = extractRows(supplier, 4, det.mapping);
  const by = (n: number) => ex.linhas.find((l) => l.linha === n)!;

  it('só vira produto o que pertence à tabela', () => {
    const ok = ex.linhas.filter((l) => l.status === 'ok').map((l) => l.data!.nome);
    expect(ok).toEqual(['Alcatra', 'Picanha', 'Contrafilé']);
  });
  it('ignora título, endereço, telefone, seção, total e rodapé', () => {
    [1, 2, 3, 9, 13, 14].forEach((n) => expect(by(n).status).toBe('ignorada'));
  });
  it('linha com valor inválido vira inválida; sem custo vira incompleta', () => {
    expect(by(10).status).toBe('invalida');
    expect(by(10).motivo).toContain('abc');
    expect(by(11).status).toBe('incompleta');
  });
  it('converte custo para centavos', () => {
    expect(by(6).data!.custo).toBe(3500);
    expect(by(8).data!.observacoes).toBe('maturado');
  });
  it('conta linhas analisadas (não vazias)', () => {
    expect(ex.linhasAnalisadas).toBe(12);
  });
});

describe('leitura de CSV/TXT', () => {
  it('detecta ponto e vírgula, vírgula, tabulação e barra', () => {
    expect(detectDelimiter('a;b;c\n1;2;3\n4;5;6').delimiter).toBe(';');
    expect(detectDelimiter('a,b,c\n1,2,3\n4,5,6').delimiter).toBe(',');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3\n4\t5\t6').delimiter).toBe('\t');
    expect(detectDelimiter('a|b|c\n1|2|3\n4|5|6').delimiter).toBe('|');
  });
  it('não confunde a vírgula decimal com separador quando o arquivo usa ponto e vírgula', () => {
    const { rows, detected } = parseDelimited('Produto;Custo\nAlcatra;35,00\nPicanha;55,00');
    expect(detected.delimiter).toBe(';');
    expect(rows[1]).toEqual(['Alcatra', '35,00']);
  });
  it('lê tabela alinhada com espaços', () => {
    const { rows } = parseDelimited('Produto        Custo\nAlcatra        35,00\nPicanha        55,00');
    expect(rows[1]).toEqual(['Alcatra', '35,00']);
  });
  it('decodifica Windows-1252 (acentos de arquivo ANSI) e UTF-8 com BOM', () => {
    const ansi = new Uint8Array([0x43, 0x6f, 0x6e, 0x74, 0x72, 0x61, 0x66, 0x69, 0x6c, 0xe9]); // "Contrafilé" em ANSI
    expect(decodeText(ansi.buffer)).toBe('Contrafilé');
    const utf = new TextEncoder().encode('﻿Açúcar');
    expect(decodeText(utf.buffer as ArrayBuffer)).toBe('Açúcar');
  });
  it('CSV completo ponta a ponta', () => {
    const csv = 'Lista da loja\n\nProduto;Categoria;Custo;Venda\nChia;Sementes;21,50;34,90\nLinhaça;Sementes;"1.234,50";19,90\n';
    const { rows } = parseDelimited(csv);
    const h = detectHeaderRow(rows)!;
    const det = buildDetection(rows, h);
    const ex = extractRows(rows, h, det.mapping);
    const ok = ex.linhas.filter((l) => l.status === 'ok');
    expect(ok.map((l) => l.data!.nome)).toEqual(['Chia', 'Linhaça']);
    expect(ok[1].data!.custo).toBe(123450);
  });
});

const rowsOf = (lines: string[][], unit = 'kg') => {
  const rows: Rows = [['Produto', 'Categoria', 'Unidade', 'Custo', 'Preço de venda'], ...lines.map((l) => [...l])];
  void unit;
  const det = buildDetection(rows, 0);
  return extractRows(rows, 0, det.mapping).linhas;
};

describe('classificação e prevenção de duplicidades', () => {
  const existing = [p({ id: 'P1' }), p({ id: 'P2', nome: 'Picanha', custo: 5500, venda: 8900 }), p({ id: 'P3', nome: 'Pimenta', categoria: 'Temperos', unidade: 'kg' })];

  it('novo / existente / alterado', () => {
    const lines = rowsOf([
      ['Fraldinha', 'Bovinos', 'kg', '30,00', '48,00'],
      ['alcatra ', 'bovinos', 'KG', '35,00', '55,00'], // igual, só muda caixa/espaço
      ['Picanha', 'Bovinos', 'kg', '58,00', '89,00'], // custo alterado
    ]);
    const plan = buildPlan(lines, existing, DEFAULT_UPDATE_FIELDS);
    expect(plan.map((r) => r.classe)).toEqual(['novo', 'existente', 'alterado']);
    expect(plan[2].mudancas).toEqual([{ campo: 'custo', antes: 'R$ 55,00', depois: 'R$ 58,00' }]);
    expect(plan[2].alvo?.id).toBe('P2');
  });
  it('ignora diferença de acento ao comparar', () => {
    const ex = [p({ id: 'X', nome: 'Contrafilé' })];
    const plan = buildPlan(rowsOf([['CONTRAFILE', 'Bovinos', 'kg', '38,00', '55,00']]), ex, DEFAULT_UPDATE_FIELDS);
    expect(plan[0].classe).toBe('alterado'); // reconheceu como o mesmo produto (custo difere)
    expect(plan[0].alvo?.id).toBe('X');
  });
  it('mesmo nome com categoria/unidade diferente = possível duplicado, nunca unificado sozinho', () => {
    const plan = buildPlan(rowsOf([['Pimenta', 'Condimentos', 'pacote', '5,00', '9,00']]), existing, DEFAULT_UPDATE_FIELDS);
    expect(plan[0].classe).toBe('duplicado');
    expect(plan[0].acaoPadrao).toBe('skip');
  });
  it('nomes apenas parecidos NÃO são tratados como iguais', () => {
    const plan = buildPlan(rowsOf([['Alcatra premium', 'Bovinos', 'kg', '60,00', '90,00']]), existing, DEFAULT_UPDATE_FIELDS);
    expect(plan[0].classe).toBe('novo');
  });
  it('repetição dentro do próprio arquivo vira duplicado', () => {
    const plan = buildPlan(rowsOf([['Fraldinha', 'Bovinos', 'kg', '30,00', '48,00'], ['Fraldinha', 'Bovinos', 'kg', '31,00', '49,00']]), existing, DEFAULT_UPDATE_FIELDS);
    expect(plan.map((r) => r.classe)).toEqual(['novo', 'duplicado']);
  });
  it('por ID interno casa mesmo com o nome alterado (reimportação do Excel do sistema)', () => {
    const rows: Rows = [['ID', 'Produto', 'Categoria', 'Unidade', 'Custo'], ['P1', 'Alcatra Extra', 'Bovinos', 'kg', '35,00']];
    const det = buildDetection(rows, 0);
    const plan = buildPlan(extractRows(rows, 0, det.mapping).linhas, existing, DEFAULT_UPDATE_FIELDS);
    expect(plan[0].alvo?.id).toBe('P1');
    expect(['existente', 'alterado']).toContain(plan[0].classe);
    expect(plan[0].classe).not.toBe('novo');
  });
  it('só considera os campos que o usuário escolheu atualizar', () => {
    const lines = rowsOf([['Picanha', 'Bovinos', 'kg', '58,00', '95,00']]);
    const soVenda: UpdateFields = { ...DEFAULT_UPDATE_FIELDS, custo: false };
    const plan = buildPlan(lines, existing, soVenda);
    expect(plan[0].mudancas.map((m) => m.campo)).toEqual(['venda']);
  });
});

describe('aplicação e desfazer', () => {
  const existing = [p({ id: 'P1' }), p({ id: 'P2', nome: 'Picanha', custo: 5500, venda: 8900 })];
  const lines = rowsOf([
    ['Fraldinha', 'Cortes novos', 'kg', '30,00', '48,00'],
    ['Picanha', 'Bovinos', 'kg', '58,00', '89,00'],
    ['Maminha', 'Bovinos', 'kg', '', ''],
  ]);
  const plan = buildPlan(lines, existing, DEFAULT_UPDATE_FIELDS);
  const all: Record<number, Decision> = {};
  plan.forEach((r) => (all[r.linha] = { selecionada: true, acao: r.classe === 'alterado' ? 'update' : 'add' }));

  it('não faz nada sem seleção', () => {
    const res = applyPlan(plan, {}, existing, ['Bovinos'], DEFAULT_UPDATE_FIELDS, 'un');
    expect(res.produtos).toEqual(existing);
    expect(res.registro.adicionados).toEqual([]);
  });
  it('adiciona novos (com categoria nova), atualiza só o escolhido e nunca exclui', () => {
    const res = applyPlan(plan, all, existing, ['Bovinos'], DEFAULT_UPDATE_FIELDS, 'un');
    expect(res.produtos.length).toBe(4);
    expect(res.produtos.find((x) => x.id === 'P2')!.custo).toBe(5800);
    expect(res.produtos.find((x) => x.id === 'P1')).toEqual(existing[0]); // intocado
    expect(res.categorias).toEqual(['Bovinos', 'Cortes novos']);
    const nova = res.produtos.find((x) => x.nome === 'Fraldinha')!;
    expect(nova.custo).toBe(3000);
    expect(nova.propQtd).toBe(100); // kg ganha 100 g por padrão
    expect(res.registro.resumo).toBe('2 novo(s), 1 atualizado(s)'); // Fraldinha e Maminha (sem preço, escolhida de propósito)
  });
  it('linhas existentes sem mudança e inválidas nunca são aplicadas', () => {
    const bad = rowsOf([['Alcatra', 'Bovinos', 'kg', '35,00', '55,00'], ['Quebrado', 'X', 'kg', 'xx', '1']]);
    const pl = buildPlan(bad, existing, DEFAULT_UPDATE_FIELDS);
    const dec: Record<number, Decision> = {};
    pl.forEach((r) => (dec[r.linha] = { selecionada: true, acao: 'add' }));
    const res = applyPlan(pl, dec, existing, [], DEFAULT_UPDATE_FIELDS, 'un');
    expect(res.produtos.length).toBe(2);
  });
  it('desfazer restaura exatamente o estado anterior', () => {
    const res = applyPlan(plan, all, existing, ['Bovinos'], DEFAULT_UPDATE_FIELDS, 'un');
    const back = undoImport(res.produtos, res.categorias, res.registro);
    expect(back.produtos).toEqual(existing);
    expect(back.categorias).toEqual(['Bovinos']);
  });
  it('desfazer não apaga o que o usuário fez depois', () => {
    const res = applyPlan(plan, all, existing, ['Bovinos'], DEFAULT_UPDATE_FIELDS, 'un');
    const extra = p({ id: 'P9', nome: 'Cadastro manual depois' });
    const back = undoImport([...res.produtos, extra], res.categorias, res.registro);
    expect(back.produtos.map((x) => x.id)).toEqual(['P1', 'P2', 'P9']);
  });
});
