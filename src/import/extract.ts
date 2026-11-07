import type { ColumnTarget } from '../types';
import { norm } from '../core/normalize';
import { parseMoney, parseNumberBR, toCents } from '../core/money';
import { normalizeUnit, parseBase } from '../core/units';
import type { Rows } from './text';

export interface RowData {
  id?: string;
  nome: string;
  categoria?: string;
  unidade?: string;
  custo?: number | null;
  venda?: number | null;
  custosAdicionais?: number | null;
  observacoes?: string;
  base?: { qtd: number; unidade: string } | null;
}

export type RowStatus = 'ok' | 'incompleta' | 'invalida' | 'ignorada';

export interface ParsedRow {
  /** número da linha na planilha (1-based) */
  linha: number;
  status: RowStatus;
  motivo?: string;
  data?: RowData;
}

export interface Extraction {
  linhas: ParsedRow[];
  /** linhas não vazias do arquivo inteiro */
  linhasAnalisadas: number;
}

const FOOTER = /^(sub\s*)?total\b|^totais\b|^soma\b|^obs\b|^observa|^p[aá]gina\b|^emitid|^impresso|^telefone|^tel\b|^fone\b|^whats|^cnpj|^cpf|^endere[cç]o|^www\.|^e-?mail|^data\b|^fornecedor|^validade|^tabela\b|^pre[cç]os? sujeitos?/i;

function cellStr(v: unknown): string {
  return v == null ? '' : String(v).trim();
}
function isBlank(r: Rows[number]): boolean {
  return r.every((c) => cellStr(c) === '');
}
function nonEmpty(r: Rows[number]): number {
  return r.filter((c) => cellStr(c) !== '').length;
}

export function extractRows(rows: Rows, headerRow: number, mapping: ColumnTarget[]): Extraction {
  const col = (t: ColumnTarget) => mapping.indexOf(t);
  const cNome = col('nome');
  const cCusto = col('custo');
  const cVenda = col('venda');
  const linhas: ParsedRow[] = [];
  let linhasAnalisadas = 0;

  rows.forEach((r, i) => {
    if (!isBlank(r)) linhasAnalisadas++;
    if (i < headerRow && !isBlank(r)) linhas.push({ linha: i + 1, status: 'ignorada', motivo: 'Acima da tabela (título, logo, endereço…)' });
  });

  const productLike = (r: Rows[number]): boolean => {
    const name = cellStr(r[cNome]);
    if (!name || FOOTER.test(norm(name))) return false;
    const hasNum = [cCusto, cVenda].some((c) => c >= 0 && parseNumberBR(r[c]) != null);
    return hasNum;
  };

  let pendingBlank = false;
  let ended = false;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    if (isBlank(r)) {
      pendingBlank = true;
      continue;
    }
    if (ended) {
      linhas.push({ linha: i + 1, status: 'ignorada', motivo: 'Fora da tabela (rodapé, totais ou observações)' });
      continue;
    }
    if (pendingBlank) {
      // depois de uma linha vazia, só continua a tabela se vier outro produto de verdade
      let j = i;
      if (nonEmpty(rows[j]) === 1 && !productLike(rows[j])) {
        j++;
        while (j < rows.length && isBlank(rows[j])) j++;
      }
      if (!(j < rows.length && productLike(rows[j]))) {
        ended = true;
        linhas.push({ linha: i + 1, status: 'ignorada', motivo: 'Fora da tabela (rodapé, totais ou observações)' });
        continue;
      }
      pendingBlank = false;
    }
    linhas.push(evalRow(r, i + 1, mapping));
  }
  return { linhas, linhasAnalisadas };
}

function evalRow(r: Rows[number], linha: number, mapping: ColumnTarget[]): ParsedRow {
  const get = (t: ColumnTarget): unknown => {
    const idx = mapping.indexOf(t);
    return idx >= 0 ? r[idx] : undefined;
  };
  const nome = cellStr(get('nome')).replace(/\s+/g, ' ');
  const filled = nonEmpty(r);

  if (!nome) {
    if (filled <= 1) return { linha, status: 'ignorada', motivo: 'Valor solto sem produto (total ou rodapé)' };
    return { linha, status: 'invalida', motivo: 'Linha sem nome de produto' };
  }
  if (FOOTER.test(norm(nome))) return { linha, status: 'ignorada', motivo: 'Linha de total, rodapé ou observação' };
  if (filled === 1) return { linha, status: 'ignorada', motivo: 'Linha só com texto (título ou seção)' };

  const data: RowData = { nome };
  const bad = (msg: string): ParsedRow => ({ linha, status: 'invalida', motivo: msg, data });

  const id = cellStr(get('id'));
  if (id) data.id = id;
  const cat = cellStr(get('categoria'));
  if (mapping.includes('categoria')) data.categoria = cat;
  const un = cellStr(get('unidade'));
  if (un) data.unidade = normalizeUnit(un) ?? undefined;
  const obs = cellStr(get('observacoes'));
  if (mapping.includes('observacoes')) data.observacoes = obs;

  const money = (t: ColumnTarget): number | null | 'erro' | undefined => {
    if (!mapping.includes(t)) return undefined;
    const raw = get(t);
    if (cellStr(raw) === '') return null;
    const n = typeof raw === 'number' ? raw : parseNumberBR(raw);
    if (n == null || n < 0) return 'erro';
    return typeof raw === 'number' ? toCents(raw) : parseMoney(raw);
  };

  const custo = money('custo');
  if (custo === 'erro') return bad(`Custo inválido: “${cellStr(get('custo'))}”`);
  const venda = money('venda');
  if (venda === 'erro') return bad(`Preço de venda inválido: “${cellStr(get('venda'))}”`);
  const adic = money('custosAdicionais');
  if (adic === 'erro') return bad(`Custos adicionais inválidos: “${cellStr(get('custosAdicionais'))}”`);
  if (custo !== undefined) data.custo = custo;
  if (venda !== undefined) data.venda = venda;
  if (adic !== undefined) data.custosAdicionais = adic;

  if (mapping.includes('base')) {
    const b = cellStr(get('base'));
    if (b) {
      const parsed = parseBase(b);
      if (!parsed) return bad(`Base proporcional inválida: “${b}” (use algo como 100 g)`);
      data.base = parsed;
    }
  }

  if ((custo == null || custo === undefined) && (venda == null || venda === undefined)) {
    return { linha, status: 'incompleta', motivo: 'Sem custo nem preço de venda', data };
  }
  return { linha, status: 'ok', data };
}
