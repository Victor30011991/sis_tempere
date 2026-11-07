import ExcelJS from 'exceljs';
import type { ListState, Settings, StoreInfo } from '../types';
import { proportionalPrice, convertQty, formatQtyUnit, contentOf } from '../core/units';
import type { Rows, Cell } from '../import/text';
import { buildExtras, type ExtrasMap } from '../core/extras';

export const CONFIG_SHEET = 'Configurações';
export const PRODUCTS_SHEET = 'Produtos';
const APP_MARK = 'temperei-precificacao';
const CHUNK = 30000;
const MONEY_FMT = '"R$" #,##0.00';

export interface ConfigPayload {
  app: string;
  versao: number;
  lista: { nome: string };
  loja: StoreInfo;
  financeiro: Settings;
  /** estoque e conteúdo da embalagem por produto (opcional; arquivos antigos não têm) */
  extras?: ExtrasMap;
}

const argb = (hex: string) => 'FF' + hex.replace('#', '').toUpperCase();

/** Planilha profissional: cabeçalho colorido, moeda, filtros, larguras. O ID interno permite reimportar sem duplicar. */
export async function buildWorkbook(list: ListState, store: StoreInfo, settings: Settings): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = store.nomeFantasia || 'Precificação';
  wb.created = new Date();

  const ws = wb.addWorksheet(PRODUCTS_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'ID', key: 'id', width: 16 },
    { header: 'Produto', key: 'nome', width: 38 },
    { header: 'Categoria', key: 'categoria', width: 22 },
    { header: 'Unidade', key: 'unidade', width: 11 },
    { header: 'Custo', key: 'custo', width: 14 },
    { header: 'Custos adicionais', key: 'adic', width: 18 },
    { header: 'Preço de venda', key: 'venda', width: 16 },
    { header: 'Preço proporcional', key: 'prop', width: 20 },
    { header: 'Base proporcional', key: 'base', width: 19 },
    { header: 'Observações', key: 'obs', width: 40 },
  ];

  const header = ws.getRow(1);
  header.height = 24;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(store.cores.primaria) } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });

  list.produtos.forEach((p, i) => {
    const r = i + 2;
    const row = ws.addRow({
      id: p.id,
      nome: p.nome,
      categoria: p.categoria,
      unidade: p.unidade,
      custo: p.custo == null ? null : p.custo / 100,
      adic: p.custosAdicionais ? p.custosAdicionais / 100 : null,
      venda: p.venda == null ? null : p.venda / 100,
      base: p.propQtd && p.propUnidade ? formatQtyUnit(p.propQtd, p.propUnidade) : null,
      obs: p.observacoes || null,
    });
    // preço proporcional como fórmula: se você mudar o preço no Excel, ele acompanha
    const prop = proportionalPrice(p.venda, p.unidade, p.propQtd, p.propUnidade, contentOf(p));
    if (prop != null && p.propQtd && p.propUnidade) {
      const factor = convertQty(p.propQtd, p.propUnidade, p.unidade);
      if (factor) row.getCell('prop').value = { formula: `ROUND(G${r}*${factor.toDecimalPlaces(10).toString()},2)`, result: prop / 100 };
      else row.getCell('prop').value = prop / 100; // embalagem com conteúdo (pacote de 250 g): valor calculado
    }
    ['custo', 'adic', 'venda', 'prop'].forEach((k) => {
      row.getCell(k).numFmt = MONEY_FMT;
      row.getCell(k).alignment = { horizontal: 'right' };
    });
    if (i % 2 === 1) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(store.cores.fundo) } };
      });
    }
    row.getCell('id').font = { color: { argb: 'FF8A8A8A' }, size: 9 };
  });

  const lastRow = Math.max(2, list.produtos.length + 1);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastRow, column: 10 } };

  // Configurações (aba oculta): permite continuar de onde parou com o mesmo arquivo
  const cfg = wb.addWorksheet(CONFIG_SHEET, { state: 'hidden' });
  cfg.columns = [
    { header: 'chave', key: 'k', width: 14 },
    { header: 'parte', key: 'p', width: 8 },
    { header: 'valor', key: 'v', width: 80 },
  ];
  const payload: ConfigPayload = {
    app: APP_MARK,
    versao: 1,
    lista: { nome: list.nome },
    loja: store,
    financeiro: settings,
    extras: buildExtras(list.produtos),
  };
  const json = JSON.stringify(payload);
  for (let i = 0, n = 0; i < json.length; i += CHUNK, n++) cfg.addRow({ k: 'config', p: n, v: json.slice(i, i + CHUNK) });

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Modelo em branco com as colunas que o sistema reconhece. */
export async function buildTemplate(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Produtos', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Produto', width: 38 },
    { header: 'Categoria', width: 22 },
    { header: 'Unidade', width: 12 },
    { header: 'Custo', width: 14 },
    { header: 'Preço de venda', width: 16 },
    { header: 'Observações', width: 40 },
  ];
  ws.getRow(1).eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB03818' } };
  });
  ws.getColumn(4).numFmt = MONEY_FMT;
  ws.getColumn(5).numFmt = MONEY_FMT;
  const help = wb.addWorksheet('Como preencher');
  help.getColumn(1).width = 100;
  [
    'Preencha uma linha por produto, abaixo do cabeçalho da aba “Produtos”.',
    'Produto é obrigatório. Informe Custo e/ou Preço de venda (números, ex.: 35,00).',
    'Unidade: kg, g, L, ml, un, pacote ou caixa. Se omitir, o sistema pergunta a unidade padrão ao importar.',
    'O sistema só importa a tabela de produtos; títulos, rodapés e totais são ignorados.',
  ].forEach((t) => help.addRow([t]));
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const o = v as unknown as Record<string, unknown>;
  if ('result' in o) return cellValue(o.result as ExcelJS.CellValue);
  if ('richText' in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('');
  if ('text' in o) return String(o.text);
  if ('error' in o) return null;
  return null;
}

export interface SheetData {
  nome: string;
  rows: Rows;
}

export interface ReadResult {
  sheets: SheetData[];
  config: ConfigPayload | null;
}

export async function readWorkbook(buf: ArrayBuffer): Promise<ReadResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheets: SheetData[] = [];
  let config: ConfigPayload | null = null;

  wb.eachSheet((ws) => {
    if (ws.name === CONFIG_SHEET) {
      const parts: { p: number; v: string }[] = [];
      ws.eachRow((row, n) => {
        if (n === 1) return;
        if (String(cellValue(row.getCell(1).value)) === 'config') {
          parts.push({ p: Number(cellValue(row.getCell(2).value)), v: String(cellValue(row.getCell(3).value) ?? '') });
        }
      });
      try {
        const parsed = JSON.parse(parts.sort((a, b) => a.p - b.p).map((x) => x.v).join('')) as ConfigPayload;
        if (parsed && parsed.app === APP_MARK) config = parsed;
      } catch {
        config = null;
      }
      return;
    }
    const rows: Rows = [];
    const cols = ws.columnCount;
    const total = ws.rowCount;
    for (let r = 1; r <= total; r++) {
      const row = ws.getRow(r);
      const cells: Cell[] = [];
      for (let c = 1; c <= cols; c++) cells.push(cellValue(row.getCell(c).value));
      rows.push(cells);
    }
    sheets.push({ nome: ws.name, rows });
  });
  return { sheets, config };
}
