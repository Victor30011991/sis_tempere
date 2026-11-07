import { jsPDF } from 'jspdf';
import autoTable, { type RowInput } from 'jspdf-autotable';
import type { Product, StoreInfo } from '../types';
import { formatBRL } from '../core/money';
import { proportionalPrice, formatQtyUnit, contentOf } from '../core/units';
import { groupByCategory, sortProducts, type SortMode } from '../core/sort';

export type PriceMode = 'ref' | 'prop' | 'ambos';
export type PdfLayout = 'catalogo' | 'inventario';

export interface PdfOptions {
  titulo: string;
  modoPreco: PriceMode;
  ordem: SortMode;
  mostrarCategoria: boolean;
  loja: {
    nome: boolean;
    razao: boolean;
    cnpj: boolean;
    endereco: boolean;
    telefone: boolean;
    informacoes: boolean;
  };
  rodape: string;
  mostrarData: boolean;
  /** catálogo comercial (só produtos com preço) ou ficha de inventário (todos os produtos). Padrão: catálogo. */
  layout?: PdfLayout;
  /** exibe a(s) coluna(s) de preço de venda. Padrão: sim. */
  mostrarPreco?: boolean;
  /** colunas internas, desligadas por padrão: o catálogo comercial nunca mostra custos sem que a pessoa peça */
  mostrarCusto?: boolean;
  mostrarSugerido?: boolean;
  mostrarEstoque?: boolean;
  /** preço sugerido por id de produto (calculado fora do PDF, com as premissas atuais) */
  sugeridos?: Record<string, number | null>;
}

const TOTAL = '{total_pages_count_string}';

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function mix(hex: string, withHex: string, amount: number): [number, number, number] {
  const a = rgb(hex);
  const b = rgb(withHex);
  return [0, 1, 2].map((i) => Math.round(a[i] * (1 - amount) + b[i] * amount)) as [number, number, number];
}
function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Preço de tabela de um produto no modo escolhido. Só dados comerciais, nunca custos. */
export function priceCells(p: Product, modo: PriceMode): { ref: string; prop: string } {
  const ref = p.venda == null ? '—' : `${formatBRL(p.venda)} / ${p.unidade}`;
  const pp = proportionalPrice(p.venda, p.unidade, p.propQtd, p.propUnidade, contentOf(p));
  const prop = pp == null || !p.propQtd || !p.propUnidade ? '—' : `${formatBRL(pp)} / ${formatQtyUnit(p.propQtd, p.propUnidade)}`;
  if (modo === 'prop') return { ref: prop !== '—' ? prop : ref, prop: '' }; // sem proporcional: mostra o preço da unidade de referência
  return { ref, prop };
}

export async function buildPdf(produtos: Product[], loja: StoreInfo, logoDataUrl: string | null, opts: PdfOptions): Promise<ArrayBuffer> {
  const showPrice = opts.mostrarPreco !== false;
  // Com muitas colunas (inventário completo) a página vira paisagem e os valores não quebram de linha.
  const plannedCols =
    1 + (opts.mostrarCategoria && opts.ordem !== 'categoria' ? 1 : 0) + (opts.mostrarEstoque ? 1 : 0) + (opts.mostrarCusto ? 1 : 0) + (showPrice ? (opts.modoPreco === 'ambos' ? 2 : 1) : 0) + (opts.mostrarSugerido ? 1 : 0);
  const wide = plannedCols >= 6;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: wide ? 'landscape' : 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;
  const primary = rgb(loja.cores.primaria);
  const primaryDark = mix(loja.cores.primaria, '#000000', 0.35);
  const paper = rgb(loja.cores.fundo);
  const ink: [number, number, number] = [43, 29, 23];
  const muted: [number, number, number] = [107, 91, 80];
  const onPrimary: [number, number, number] = luminance(primary) > 0.45 ? [31, 20, 15] : [255, 255, 255];
  const onAccent: [number, number, number] = luminance(mix(loja.cores.destaque, '#ffffff', 0.78)) > 0.45 ? mix(loja.cores.destaque, '#000000', 0.45) : [255, 255, 255];

  // catálogo: só quem tem preço. Inventário (ou preços ocultos): todos os produtos.
  const onlyPriced = (opts.layout ?? 'catalogo') === 'catalogo' && showPrice;
  const items = sortProducts(
    produtos.filter((p) => !onlyPriced || p.venda != null),
    opts.ordem,
  );
  const grouped = opts.ordem === 'categoria';

  // ---------- Cabeçalho da primeira página ----------
  const BAND = 44;
  doc.setFillColor(...paper);
  doc.rect(0, 0, W, BAND, 'F');
  doc.setFillColor(...primary);
  doc.rect(0, BAND, W, 1.4, 'F');

  let textX = M;
  if (logoDataUrl) {
    try {
      const props = doc.getImageProperties(logoDataUrl);
      const h = 34;
      const w = Math.min((props.width / props.height) * h, 52);
      doc.addImage(logoDataUrl, props.fileType, M, 5, w, w / (props.width / props.height));
      textX = M + w + 8;
    } catch {
      textX = M;
    }
  }
  let y = 14;
  if (opts.loja.nome && loja.nomeFantasia) {
    doc.setFont('times', 'bold');
    doc.setFontSize(24);
    doc.setTextColor(...primaryDark);
    doc.text(loja.nomeFantasia, textX, y + 2);
    y += 9;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  const infoLines: string[] = [];
  if (opts.loja.razao && loja.razaoSocial) infoLines.push(loja.razaoSocial);
  if (opts.loja.cnpj && loja.cnpj) infoLines.push(`CNPJ ${loja.cnpj}`);
  if (opts.loja.endereco && loja.endereco) infoLines.push(loja.endereco);
  if (opts.loja.telefone && loja.telefone) infoLines.push(loja.telefone);
  if (opts.loja.informacoes && loja.informacoes) infoLines.push(loja.informacoes);
  const maxW = W - M - textX;
  infoLines.forEach((l) => {
    doc.splitTextToSize(l, maxW).slice(0, 2).forEach((s: string) => {
      doc.text(s, textX, y);
      y += 4.4;
    });
  });

  // Título da lista
  let startY = BAND + 14;
  doc.setFont('times', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...primary);
  doc.text(opts.titulo || 'Lista de preços', M, startY);
  if (opts.mostrarData) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...muted);
    doc.text(`Atualizada em ${new Date().toLocaleDateString('pt-BR')}`, W - M, startY, { align: 'right' });
  }
  startY += 5;

  // ---------- Tabela ----------
  interface Col {
    head: string;
    get: (p: Product) => string;
    right?: boolean;
    width?: number;
    bold?: boolean;
    muted?: boolean;
  }
  const cols: Col[] = [{ head: 'Produto', get: (p) => p.nome }];
  if (opts.mostrarCategoria && !grouped) cols.push({ head: 'Categoria', get: (p) => p.categoria || '—', width: wide ? 32 : 38 });
  if (opts.mostrarEstoque) cols.push({ head: 'Estoque', right: true, get: (p) => (p.estoque != null ? `${String(p.estoque).replace('.', ',')} ${p.unidade}` : '—') });
  if (opts.mostrarCusto) cols.push({ head: 'Custo', right: true, get: (p) => (p.custo == null ? '—' : `${formatBRL(p.custo)} / ${p.unidade}`) });
  if (showPrice) {
    cols.push({ head: opts.modoPreco === 'prop' ? 'Preço proporcional' : 'Preço', right: true, bold: true, width: opts.modoPreco === 'ambos' ? 40 : 50, get: (p) => priceCells(p, opts.modoPreco).ref });
    if (opts.modoPreco === 'ambos') cols.push({ head: 'Preço proporcional', right: true, muted: true, width: 44, get: (p) => priceCells(p, opts.modoPreco).prop });
  }
  if (opts.mostrarSugerido)
    cols.push({ head: 'Preço sugerido', right: true, muted: true, get: (p) => {
      const v = opts.sugeridos?.[p.id];
      return v == null ? '—' : `${formatBRL(v)} / ${p.unidade}`;
    } });
  const head = cols.map((c) => c.head);
  const nCols = head.length;

  const rowFor = (p: Product): RowInput => cols.map((c) => c.get(p));

  const body: RowInput[] = [];
  if (grouped) {
    groupByCategory(items).forEach((g) => {
      body.push([
        {
          content: (g.categoria || 'Sem categoria').toUpperCase(),
          colSpan: nCols,
          styles: { fillColor: mix(loja.cores.destaque, '#ffffff', 0.78), textColor: onAccent, fontStyle: 'bold', fontSize: 9, halign: 'left' },
        },
      ]);
      g.itens.forEach((p) => body.push(rowFor(p)));
    });
  } else {
    items.forEach((p) => body.push(rowFor(p)));
  }
  if (body.length === 0) body.push([{ content: onlyPriced ? 'Nenhum produto com preço de venda para exibir.' : 'Nenhum produto para exibir.', colSpan: nCols, styles: { halign: 'center', textColor: muted } }]);

  const columnStyles: Record<number, object> = {};
  cols.forEach((c, i) => {
    const st: Record<string, unknown> = {};
    if (c.right) st.halign = 'right';
    if (c.bold) st.fontStyle = 'bold';
    if (c.muted) st.textColor = muted;
    // colunas de valores: largura do conteúdo (não quebram); Produto e Categoria dividem o restante e quebram linha
    if (wide && c.right) st.cellWidth = 'wrap';
    else if (c.width) st.cellWidth = c.width;
    if (Object.keys(st).length) columnStyles[i] = st;
  });

  autoTable(doc, {
    head: [head],
    body,
    startY,
    margin: { left: M, right: M, top: 22, bottom: 18 },
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: wide ? 9 : 10, textColor: ink, cellPadding: wide ? { top: 2.3, bottom: 2.3, left: 2.5, right: 2.5 } : { top: 2.8, bottom: 2.8, left: 3, right: 3 }, overflow: 'linebreak', lineColor: [230, 220, 202], lineWidth: { bottom: 0.2 } },
    headStyles: { fillColor: primary, textColor: onPrimary, fontStyle: 'bold', fontSize: wide ? 8.5 : 9.5 },
    alternateRowStyles: { fillColor: mix(loja.cores.fundo, '#ffffff', 0.55) },
    columnStyles: Object.fromEntries(Object.entries(columnStyles)),
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    didParseCell: (data) => {
      // cabeçalhos das colunas de preço alinhados à direita, como os valores
      if (data.section === 'head' && cols[data.column.index]?.right) data.cell.styles.halign = 'right';
    },
    didDrawPage: (data) => {
      const page = doc.getNumberOfPages();
      if (page > 1) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...primaryDark);
        doc.text(loja.nomeFantasia || '', M, 12);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...muted);
        doc.text(opts.titulo || 'Lista de preços', W - M, 12, { align: 'right' });
        doc.setDrawColor(...primary);
        doc.setLineWidth(0.5);
        doc.line(M, 15, W - M, 15);
      }
      const H = doc.internal.pageSize.getHeight();
      doc.setDrawColor(220, 210, 192);
      doc.setLineWidth(0.2);
      doc.line(M, H - 13, W - M, H - 13);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...muted);
      if (opts.rodape) doc.text(doc.splitTextToSize(opts.rodape, W - 2 * M - 40)[0] as string, M, H - 8);
      doc.text(`Página ${data.pageNumber} de ${TOTAL}`, W - M, H - 8, { align: 'right' });
    },
  });
  doc.putTotalPages(TOTAL);
  return doc.output('arraybuffer');
}
