import type { ColumnTarget, FieldKey } from '../types';
import { norm } from '../core/normalize';
import { normalizeUnit } from '../core/units';
import type { Rows } from './text';

export const FIELD_LABELS: Record<ColumnTarget, string> = {
  id: 'ID interno',
  nome: 'Produto',
  categoria: 'Categoria',
  unidade: 'Unidade',
  custo: 'Custo de aquisição',
  venda: 'Preço de venda',
  custosAdicionais: 'Custos adicionais',
  base: 'Base proporcional',
  observacoes: 'Observações',
  ignorar: '— Ignorar esta coluna —',
};

type SynKey = FieldKey | 'proporcional';

const SYNONYMS: Record<SynKey, string[]> = {
  id: ['id', 'id interno', 'identificador', 'id produto', 'id do produto', 'codigo interno'],
  nome: ['produto', 'produtos', 'descricao', 'descricao do produto', 'descricao produto', 'item', 'nome', 'nome do produto', 'mercadoria', 'artigo'],
  categoria: ['categoria', 'categorias', 'grupo', 'classe', 'departamento', 'secao', 'setor', 'familia'],
  unidade: ['unidade', 'unidade de medida', 'un', 'und', 'unid', 'medida', 'um', 'u m'],
  custo: [
    'custo', 'custo de aquisicao', 'custo aquisicao', 'preco de compra', 'preco compra', 'valor de compra', 'valor compra',
    'custo unitario', 'preco de custo', 'preco custo', 'compra', 'custo kg',
  ],
  venda: ['preco de venda', 'preco venda', 'venda', 'valor de venda', 'valor venda', 'valor', 'preco', 'preco unitario', 'preco sugerido', 'preco final'],
  custosAdicionais: ['custos adicionais', 'custo adicional', 'adicionais', 'custos extras'],
  base: ['base proporcional', 'unidade proporcional', 'base do preco proporcional'],
  observacoes: ['observacoes', 'observacao', 'obs', 'notas', 'nota', 'comentarios'],
  proporcional: ['preco proporcional', 'preco por 100 g', 'preco por 100g', 'preco 100g', 'preco por 100 ml'],
};

/** Colunas genéricas: podem ser custo OU preço de venda, o usuário precisa confirmar. */
const GENERIC = new Set(['preco', 'valor']);

function matchHeader(raw: string): SynKey | null {
  const full = norm(raw).replace(/[().:]/g, ' ').replace(/\s+/g, ' ').trim();
  const base = norm(raw).split(/[\/(\-–:]/)[0].replace(/\s+/g, ' ').trim();
  for (const key of Object.keys(SYNONYMS) as SynKey[]) {
    if (SYNONYMS[key].includes(full) || SYNONYMS[key].includes(base)) return key;
  }
  return null;
}

const UNIT_HINT = /(?:\/|\(|\bpor\s+|\bp\/\s*)\s*(kg|g|gr|l|lt|ml|un|und|unid|pct|cx|pc)\s*\)?\s*$/i;

export function unitHintFromHeader(raw: string): string | null {
  const m = norm(raw).match(UNIT_HINT);
  return m ? normalizeUnit(m[1]) : null;
}

export interface Detection {
  headerRow: number; // índice 0-based em rows
  headers: string[];
  mapping: ColumnTarget[];
  /** colunas cujo cabeçalho é genérico ("Preço", "Valor") */
  ambiguas: number[];
  unitHint: string | null;
}

function rowText(r: Rows[number]): string[] {
  return r.map((c) => (c == null ? '' : String(c).trim()));
}

export function scoreRow(cells: string[]): { score: number; matched: Map<number, SynKey> } {
  const matched = new Map<number, SynKey>();
  const seen = new Set<SynKey>();
  cells.forEach((c, i) => {
    if (!c || c.length > 40) return;
    const k = matchHeader(c);
    if (k && !seen.has(k)) {
      seen.add(k);
      matched.set(i, k);
    }
  });
  const hasNome = seen.has('nome');
  const score = hasNome && seen.size >= 2 ? seen.size : 0;
  return { score, matched };
}

/**
 * Colunas genéricas ("Preço", "Valor") usadas como custo/venda quando não há outra coluna de custo:
 * não dá para saber se é preço de compra ou de venda, então o usuário precisa confirmar.
 * Se existe uma coluna de custo explícita, "Preço"/"Valor" é o preço de venda sem ambiguidade.
 */
export function ambiguousColumns(headers: string[], mapping: ColumnTarget[]): number[] {
  const hasCusto = mapping.includes('custo');
  const out: number[] = [];
  headers.forEach((h, i) => {
    if (!h) return;
    const base = norm(h).split(/[\/(\-–:]/)[0].trim();
    if (GENERIC.has(base) && mapping[i] === 'venda' && !hasCusto) out.push(i);
  });
  return out;
}

export function buildDetection(rows: Rows, headerRow: number): Detection {
  const headers = rowText(rows[headerRow] ?? []);
  const { matched } = scoreRow(headers);
  const mapping: ColumnTarget[] = headers.map(() => 'ignorar');
  matched.forEach((k, i) => {
    mapping[i] = k === 'proporcional' ? 'ignorar' : k;
  });
  const ambiguas = ambiguousColumns(headers, mapping);
  let unitHint: string | null = null;
  headers.forEach((h, i) => {
    if (!unitHint && (mapping[i] === 'custo' || mapping[i] === 'venda')) unitHint = unitHintFromHeader(h);
  });
  return { headerRow, headers, mapping, ambiguas, unitHint };
}

/** Localiza a linha do cabeçalho real: a que contém mais nomes de campos conhecidos. */
export function detectHeaderRow(rows: Rows, scanLimit = 80): number | null {
  let best = -1;
  let bestScore = 0;
  const limit = Math.min(rows.length, scanLimit);
  for (let i = 0; i < limit; i++) {
    const { score } = scoreRow(rowText(rows[i] ?? []));
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best >= 0 ? best : null;
}

export function sheetScore(rows: Rows): number {
  const h = detectHeaderRow(rows);
  return h == null ? 0 : scoreRow(rowText(rows[h])).score;
}

/** Colunas mapeadas para o mesmo campo mais de uma vez. */
export function duplicateTargets(mapping: ColumnTarget[]): ColumnTarget[] {
  const count = new Map<ColumnTarget, number>();
  mapping.forEach((m) => m !== 'ignorar' && count.set(m, (count.get(m) ?? 0) + 1));
  return [...count.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}
