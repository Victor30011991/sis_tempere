import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildTemplate, buildWorkbook, readWorkbook, CONFIG_SHEET } from '../src/export/excel';
import { buildPdf, priceCells, type PdfOptions } from '../src/export/pdf';
import { quantizePalette } from '../src/export/palette';
import { buildDetection, detectHeaderRow, sheetScore } from '../src/import/detect';
import { extractRows } from '../src/import/extract';
import { buildPlan, applyPlan, DEFAULT_UPDATE_FIELDS, type Decision } from '../src/import/plan';
import { defaultSettings, defaultStore } from '../src/core/defaults';
import type { ListState, Product } from '../src/types';

const prod = (id: string, nome: string, categoria: string, unidade: string, custo: number | null, venda: number | null, over: Partial<Product> = {}): Product => ({
  id,
  nome,
  categoria,
  unidade,
  custo,
  custosAdicionais: 0,
  venda,
  propQtd: unidade === 'kg' ? 100 : unidade === 'L' ? 100 : null,
  propUnidade: unidade === 'kg' ? 'g' : unidade === 'L' ? 'ml' : null,
  observacoes: '',
  ...over,
});

const lista: ListState = {
  nome: 'Lista Temperos',
  categorias: ['Especiarias', 'Óleos'],
  produtos: [
    prod('PAAA111', 'Açafrão', 'Especiarias', 'kg', 20000, 35000, { observacoes: 'importado' }),
    prod('PBBB222', 'Canela em pau', 'Especiarias', 'kg', 5990, 8990),
    prod('PCCC333', 'Azeite extra virgem', 'Óleos', 'L', 3800, 5990),
    prod('PDDD444', 'Sabonete de argila', '', 'un', 620, 1290),
  ],
};

async function roundTrip() {
  const settings = defaultSettings();
  settings.custosFixos = [{ id: 'f1', descricao: 'Aluguel', valor: 250000 }];
  settings.margem = { modo: 'margem', valor: 35 };
  const store = defaultStore();
  store.nomeFantasia = 'Loja Teste';
  const buf = await buildWorkbook(lista, store, settings);
  return { buf, settings, store, read: await readWorkbook(buf) };
}

describe('exportação e reimportação do Excel', () => {
  it('exporta cabeçalho formatado, moeda, filtro e congela a primeira linha', async () => {
    const { buf } = await roundTrip();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Produtos')!;
    expect(ws.getRow(1).values).toContain('Preço de venda');
    expect(ws.getCell('G2').numFmt).toContain('R$');
    expect(ws.getCell('G2').value).toBe(350);
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.views[0].state).toBe('frozen');
    expect(ws.getCell('A1').fill).toMatchObject({ fgColor: { argb: 'FFB03818' } });
    expect(wb.getWorksheet(CONFIG_SHEET)!.state).toBe('hidden');
  });

  it('o preço proporcional é fórmula e acompanha o preço de venda', async () => {
    const { buf } = await roundTrip();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const c = wb.getWorksheet('Produtos')!.getCell('H3').value as { formula: string; result: number };
    expect(c.formula).toBe('ROUND(G3*0.1,2)');
    expect(c.result).toBe(8.99);
  });

  it('reimporta o arquivo do sistema reconhecendo tudo pelo ID, sem duplicar', async () => {
    const { read } = await roundTrip();
    const sheet = read.sheets.find((s) => s.nome === 'Produtos')!;
    const h = detectHeaderRow(sheet.rows)!;
    const det = buildDetection(sheet.rows, h);
    expect(det.mapping.filter((m) => m !== 'ignorar')).toEqual(['id', 'nome', 'categoria', 'unidade', 'custo', 'custosAdicionais', 'venda', 'base', 'observacoes']);
    const ex = extractRows(sheet.rows, h, det.mapping);
    expect(ex.linhas.filter((l) => l.status === 'ok').length).toBe(4);
    const plan = buildPlan(ex.linhas, lista.produtos, DEFAULT_UPDATE_FIELDS);
    expect(plan.map((r) => r.classe)).toEqual(['existente', 'existente', 'existente', 'existente']);
  });

  it('carrega o arquivo numa lista vazia (continuar de onde parou)', async () => {
    const { read } = await roundTrip();
    const sheet = read.sheets[0];
    const h = detectHeaderRow(sheet.rows)!;
    const det = buildDetection(sheet.rows, h);
    const plan = buildPlan(extractRows(sheet.rows, h, det.mapping).linhas, [], DEFAULT_UPDATE_FIELDS);
    const dec: Record<number, Decision> = {};
    plan.forEach((r) => (dec[r.linha] = { selecionada: true, acao: 'add' }));
    const res = applyPlan(plan, dec, [], [], DEFAULT_UPDATE_FIELDS, 'un');
    expect(res.produtos.length).toBe(4);
    const aca = res.produtos.find((p) => p.nome === 'Açafrão')!;
    expect(aca.custo).toBe(20000);
    expect(aca.venda).toBe(35000);
    expect(aca.observacoes).toBe('importado');
    expect(aca.propQtd).toBe(100);
    expect(res.categorias).toEqual(['Especiarias', 'Óleos']);
  });

  it('edição externa: preço alterado vira "alterado", produto novo vira "novo", linha apagada NÃO exclui', async () => {
    const { buf } = await roundTrip();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Produtos')!;
    ws.getCell('G3').value = 99.9; // Canela em pau: novo preço
    ws.spliceRows(5, 1); // remove o sabonete
    ws.addRow([null, 'Cravo', 'Especiarias', 'kg', 40, null, 70]); // produto novo, sem ID
    const edited = (await wb.xlsx.writeBuffer()) as ArrayBuffer;

    const read = await readWorkbook(edited);
    const sheet = read.sheets[0];
    const h = detectHeaderRow(sheet.rows)!;
    const det = buildDetection(sheet.rows, h);
    const plan = buildPlan(extractRows(sheet.rows, h, det.mapping).linhas, lista.produtos, DEFAULT_UPDATE_FIELDS);
    const byName = Object.fromEntries(plan.map((r) => [r.parsed.data?.nome, r]));
    expect(byName['Canela em pau'].classe).toBe('alterado');
    expect(byName['Canela em pau'].mudancas[0]).toMatchObject({ campo: 'venda', depois: 'R$ 99,90' });
    expect(byName['Cravo'].classe).toBe('novo');
    const dec: Record<number, Decision> = {};
    plan.forEach((r) => (dec[r.linha] = { selecionada: true, acao: r.classe === 'alterado' ? 'update' : 'add' }));
    const res = applyPlan(plan, dec, lista.produtos, lista.categorias, DEFAULT_UPDATE_FIELDS, 'un');
    expect(res.produtos.some((p) => p.nome === 'Sabonete de argila')).toBe(true); // ausente no arquivo, mas preservado
    expect(res.produtos.length).toBe(5);
  });

  it('guarda e recupera as configurações (loja e financeiro) na aba oculta', async () => {
    const { read, settings, store } = await roundTrip();
    expect(read.config).not.toBeNull();
    expect(read.config!.lista.nome).toBe('Lista Temperos');
    expect(read.config!.loja.nomeFantasia).toBe(store.nomeFantasia);
    expect(read.config!.financeiro.margem.valor).toBe(35);
    expect(read.config!.financeiro.custosFixos).toEqual(settings.custosFixos);
    expect(read.sheets.map((s) => s.nome)).toEqual(['Produtos']); // a aba de configurações não é tratada como tabela
  });

  it('configuração grande (logo) é dividida em partes e volta inteira', async () => {
    const store = defaultStore();
    store.logo = 'data:image/png;base64,' + 'A'.repeat(100_000);
    const buf = await buildWorkbook(lista, store, defaultSettings());
    const read = await readWorkbook(buf);
    expect(read.config!.loja.logo!.length).toBe(store.logo.length);
  });

  it('planilha de fornecedor sem a aba do sistema não traz configurações', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tabela');
    ws.addRow(['ACME Distribuidora']);
    ws.addRow(['Fone (11) 3000-0000']);
    ws.addRow([]);
    ws.addRow(['Descrição', 'Grupo', 'Preço de compra']);
    ws.addRow(['Arroz', 'Grãos', 5.5]);
    ws.addRow(['Feijão', 'Grãos', 8.25]);
    ws.addRow(['Total', null, 13.75]);
    const read = await readWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    expect(read.config).toBeNull();
    const s = read.sheets[0];
    const h = detectHeaderRow(s.rows)!;
    expect(h).toBe(3);
    const ex = extractRows(s.rows, h, buildDetection(s.rows, h).mapping);
    expect(ex.linhas.filter((l) => l.status === 'ok').map((l) => [l.data!.nome, l.data!.custo])).toEqual([['Arroz', 550], ['Feijão', 825]]);
    expect(sheetScore(s.rows)).toBeGreaterThanOrEqual(2);
  });

  it('modelo em branco tem as colunas reconhecidas', async () => {
    const read = await readWorkbook(await buildTemplate());
    const s = read.sheets.find((x) => x.nome === 'Produtos')!;
    const det = buildDetection(s.rows, detectHeaderRow(s.rows)!);
    expect(det.mapping).toEqual(['nome', 'categoria', 'unidade', 'custo', 'venda', 'observacoes']);
  });
});

const baseOpts: PdfOptions = {
  titulo: 'Lista de Preços Novembro',
  modoPreco: 'ambos',
  ordem: 'categoria',
  mostrarCategoria: true,
  loja: { nome: true, razao: false, cnpj: false, endereco: true, telefone: true, informacoes: false },
  rodape: '',
  mostrarData: true,
};

describe('PDF comercial', () => {
  const loja = { ...defaultStore(), endereco: 'Rua das Flores, 100', telefone: '(11) 99999-0000', razaoSocial: 'RAZAO SECRETA LTDA' };

  it('gera um PDF válido só com dados comerciais', async () => {
    const withCost = lista.produtos.map((p) => ({ ...p, observacoes: 'NOTA-INTERNA' }));
    const buf = await buildPdf(withCost, loja, null, baseOpts);
    const text = Buffer.from(buf).toString('latin1');
    expect(text.startsWith('%PDF')).toBe(true);
    expect(text).toContain('Lista de Pre');
    expect(text).toContain('Rua das Flores, 100');
    expect(text).toContain('99999-0000'); // (parênteses são escapados dentro do PDF)
    expect(text).not.toContain('RAZAO SECRETA'); // campo não selecionado
    expect(text).not.toContain('NOTA-INTERNA'); // observações internas nunca vão
    expect(text).not.toContain('200,00'); // custo do açafrão (R$ 200,00)
    expect(text).not.toContain('Custo');
    expect(text).not.toContain('Margem');
  });

  it('formata preços por unidade de referência e proporcionais', () => {
    const [aca, , azeite, sab] = lista.produtos;
    expect(priceCells(aca, 'ref').ref).toBe('R$ 350,00 / kg');
    expect(priceCells(aca, 'ambos').prop).toBe('R$ 35,00 / 100 g');
    expect(priceCells(azeite, 'ambos').prop).toBe('R$ 5,99 / 100 ml');
    expect(priceCells(sab, 'ambos').prop).toBe('—');
    expect(priceCells(sab, 'prop').ref).toBe('R$ 12,90 / un'); // sem proporcional, mostra o preço da unidade
    expect(priceCells(azeite, 'prop').ref).toBe('R$ 5,99 / 100 ml');
  });

  it('não deixa produtos sem preço na lista e pagina listas longas repetindo o cabeçalho', async () => {
    const many: Product[] = Array.from({ length: 120 }, (_, i) => prod('X' + i, `Produto número ${i + 1} com nome razoavelmente comprido para testar quebra`, i % 2 ? 'Grãos' : 'Temperos', 'kg', 1000, 2000 + i));
    many.push(prod('SEM', 'Sem preço algum', 'Grãos', 'kg', 100, null));
    const buf = await buildPdf(many, loja, null, { ...baseOpts, ordem: 'az', mostrarCategoria: true });
    const text = Buffer.from(buf).toString('latin1');
    const pages = (text.match(/\/Type\s*\/Page\b/g) || []).length;
    expect(pages).toBeGreaterThan(2);
    expect(text).not.toContain('Sem pre'); // sem preço de venda não entra na lista comercial
    expect(text).toMatch(new RegExp(`de ${pages}`));
  });
});

describe('paleta da logo', () => {
  it('extrai as cores predominantes ignorando o fundo creme', () => {
    const px: number[] = [];
    const push = (r: number, g: number, b: number, n: number) => { for (let i = 0; i < n; i++) px.push(r, g, b, 255); };
    push(239, 223, 198, 5000); // fundo creme
    push(176, 56, 24, 800); // terracota
    push(100, 112, 58, 500); // oliva
    push(112, 32, 8, 300); // vinho
    const pal = quantizePalette(px);
    expect(pal[0]).toMatch(/^#B0/);
    expect(pal).toHaveLength(3);
    expect(pal.some((c) => c.startsWith('#64'))).toBe(true);
  });
});
