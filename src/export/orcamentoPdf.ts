import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { StoreInfo } from '../types';
import { formatBRL } from '../core/money';
import { installments } from '../core/orcamento';

export interface OrcamentoLinha {
  nome: string;
  qtd: string; // "2,5 kg"
  unitario: string; // "R$ 35,00 / kg"
  subtotal: number;
}

export interface OrcamentoPdfData {
  cliente: { nome: string; telefone: string; endereco: string };
  linhas: OrcamentoLinha[];
  subtotal: number;
  desconto: number;
  descontoLabel: string; // "10%" ou ""
  total: number;
  pagamento: { label: string; parcelas: number };
  observacoes: string;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function mix(hex: string, withHex: string, a: number): [number, number, number] {
  const x = rgb(hex);
  const y = rgb(withHex);
  return [0, 1, 2].map((i) => Math.round(x[i] * (1 - a) + y[i] * a)) as [number, number, number];
}
function lum([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Orçamento / nota de venda em A4 retrato, limpo, para enviar pelo WhatsApp. Documento sem valor fiscal. */
export async function buildOrcamentoPdf(d: OrcamentoPdfData, loja: StoreInfo, logoDataUrl: string | null): Promise<ArrayBuffer> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const primary = rgb(loja.cores.primaria);
  const dark = mix(loja.cores.primaria, '#000000', 0.35);
  const paper = rgb(loja.cores.fundo);
  const ink: [number, number, number] = [43, 29, 23];
  const muted: [number, number, number] = [107, 91, 80];
  const onPrimary: [number, number, number] = lum(primary) > 0.45 ? [31, 20, 15] : [255, 255, 255];

  // ---------- cabeçalho da loja ----------
  const BAND = 34;
  doc.setFillColor(...paper);
  doc.rect(0, 0, W, BAND, 'F');
  doc.setFillColor(...primary);
  doc.rect(0, BAND, W, 1.2, 'F');
  let textX = M;
  if (logoDataUrl) {
    try {
      const pr = doc.getImageProperties(logoDataUrl);
      const h = 26;
      const w = Math.min((pr.width / pr.height) * h, 44);
      doc.addImage(logoDataUrl, pr.fileType, M, 4, w, w / (pr.width / pr.height));
      textX = M + w + 6;
    } catch {
      textX = M;
    }
  }
  let y = 13;
  if (loja.nomeFantasia) {
    doc.setFont('times', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(...dark);
    doc.text(loja.nomeFantasia, textX, y);
    y += 7;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  [loja.endereco, loja.telefone].filter(Boolean).forEach((l) => {
    doc.splitTextToSize(l, W - M - textX).slice(0, 2).forEach((s: string) => {
      doc.text(s, textX, y);
      y += 4.2;
    });
  });

  // ---------- título e cliente ----------
  y = BAND + 13;
  doc.setFont('times', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...primary);
  doc.text('Orçamento', M, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  doc.text(`Emitido em ${new Date().toLocaleDateString('pt-BR')}`, W - M, y, { align: 'right' });
  y += 7;

  const info: [string, string][] = [];
  if (d.cliente.nome) info.push(['Cliente', d.cliente.nome]);
  if (d.cliente.telefone) info.push(['Telefone', d.cliente.telefone]);
  if (d.cliente.endereco) info.push(['Endereço / obs.', d.cliente.endereco]);
  doc.setFontSize(10);
  info.forEach(([k, v]) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...ink);
    doc.text(`${k}:`, M, y);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(v, W - 2 * M - 34) as string[];
    doc.text(lines, M + 34, y);
    y += 5 * lines.length + 0.5;
  });
  y += 3;

  // ---------- itens ----------
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, top: 18, bottom: 22 },
    theme: 'plain',
    head: [['Produto', 'Quantidade', 'Valor unitário', 'Subtotal']],
    body: d.linhas.map((l) => [l.nome, l.qtd, l.unitario, formatBRL(l.subtotal)]),
    styles: { font: 'helvetica', fontSize: 10, textColor: ink, cellPadding: { top: 2.8, bottom: 2.8, left: 3, right: 3 }, overflow: 'linebreak', lineColor: [230, 220, 202], lineWidth: { bottom: 0.2 } },
    headStyles: { fillColor: primary, textColor: onPrimary, fontStyle: 'bold', fontSize: 9.5 },
    alternateRowStyles: { fillColor: mix(loja.cores.fundo, '#ffffff', 0.55) },
    columnStyles: { 1: { halign: 'right', cellWidth: 'wrap' }, 2: { halign: 'right', cellWidth: 'wrap' }, 3: { halign: 'right', cellWidth: 'wrap', fontStyle: 'bold' } },
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
    didParseCell: (data) => {
      if (data.section === 'head' && data.column.index >= 1) data.cell.styles.halign = 'right';
    },
  });

  // ---------- resumo ----------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fy: number = (doc as any).lastAutoTable.finalY + 6;
  const parcelas = installments(d.total, d.pagamento.parcelas);
  const extra = (d.observacoes ? 14 + 4.5 * (doc.splitTextToSize(d.observacoes, W - 2 * M) as string[]).length : 0) + (d.desconto > 0 ? 6 : 0);
  if (fy + 38 + extra > H - 22) {
    doc.addPage();
    fy = 22;
  }
  const rx = W - M;
  const line = (k: string, v: string, bold = false, size = 10.5) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...(bold ? dark : ink));
    doc.text(k, rx - 62, fy);
    doc.text(v, rx, fy, { align: 'right' });
    fy += bold ? 8 : 6;
  };
  line('Subtotal', formatBRL(d.subtotal));
  if (d.desconto > 0) line(d.descontoLabel ? `Desconto (${d.descontoLabel})` : 'Desconto', `- ${formatBRL(d.desconto)}`);
  doc.setDrawColor(...primary);
  doc.setLineWidth(0.4);
  doc.line(rx - 62, fy - 3.5, rx, fy - 3.5);
  fy += 1.5;
  line('Total', formatBRL(d.total), true, 14);

  fy += 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...ink);
  doc.text('Pagamento:', M, fy);
  doc.setFont('helvetica', 'normal');
  doc.text(d.pagamento.parcelas > 1 ? `${d.pagamento.label} — ${d.pagamento.parcelas} parcelas de ${formatBRL(parcelas[0])}` : d.pagamento.label, M + 24, fy);
  fy += 8;

  if (d.observacoes) {
    doc.setFont('helvetica', 'bold');
    doc.text('Observações', M, fy);
    fy += 5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...muted);
    const obs = doc.splitTextToSize(d.observacoes, W - 2 * M) as string[];
    doc.text(obs, M, fy);
  }

  // ---------- rodapé em todas as páginas ----------
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(220, 210, 192);
    doc.setLineWidth(0.2);
    doc.line(M, H - 13, W - M, H - 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...muted);
    doc.text('Documento sem valor fiscal.', M, H - 8);
    if (n > 1) doc.text(`Página ${i} de ${n}`, W - M, H - 8, { align: 'right' });
  }
  return doc.output('arraybuffer');
}
