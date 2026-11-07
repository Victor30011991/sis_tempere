import type { ImportRecord, Product } from '../types';
import { newId, norm } from '../core/normalize';
import { defaultProportional, compatibleUnits } from '../core/units';
import { formatBRL } from '../core/money';
import type { ParsedRow } from './extract';

export type UpdatableField = 'custo' | 'venda' | 'custosAdicionais' | 'categoria' | 'unidade' | 'observacoes' | 'base';

export const UPDATABLE_LABELS: Record<UpdatableField, string> = {
  custo: 'Custo',
  venda: 'Preço de venda',
  custosAdicionais: 'Custos adicionais',
  categoria: 'Categoria',
  unidade: 'Unidade',
  observacoes: 'Observações',
  base: 'Base proporcional',
};

export type UpdateFields = Record<UpdatableField, boolean>;

export const DEFAULT_UPDATE_FIELDS: UpdateFields = {
  custo: true,
  venda: true,
  custosAdicionais: true,
  categoria: true,
  unidade: false,
  observacoes: false,
  base: false,
};

export type Classe = 'novo' | 'existente' | 'alterado' | 'duplicado' | 'incompleto' | 'invalido';
export type Acao = 'add' | 'update' | 'skip';

export interface Change {
  campo: UpdatableField;
  antes: string;
  depois: string;
}

export interface PlanRow {
  linha: number;
  parsed: ParsedRow;
  classe: Classe;
  alvo?: Product;
  mudancas: Change[];
  /** explicação para duplicados / incompletos / inválidos */
  detalhe?: string;
  /** o usuário pode marcar esta linha? */
  selecionavel: boolean;
  acaoPadrao: Acao;
}

const money = (c: number | null | undefined) => (c == null ? '—' : formatBRL(c));
const baseText = (q: number | null, u: string | null) => (q && u ? `${String(q).replace('.', ',')} ${u}` : '—');

function diff(row: NonNullable<ParsedRow['data']>, target: Product, fields: UpdateFields): Change[] {
  const out: Change[] = [];
  if (fields.custo && row.custo !== undefined && row.custo !== null && row.custo !== target.custo)
    out.push({ campo: 'custo', antes: money(target.custo), depois: money(row.custo) });
  if (fields.venda && row.venda !== undefined && row.venda !== null && row.venda !== target.venda)
    out.push({ campo: 'venda', antes: money(target.venda), depois: money(row.venda) });
  if (fields.custosAdicionais && row.custosAdicionais != null && row.custosAdicionais !== target.custosAdicionais)
    out.push({ campo: 'custosAdicionais', antes: money(target.custosAdicionais), depois: money(row.custosAdicionais) });
  if (fields.categoria && row.categoria && norm(row.categoria) !== norm(target.categoria))
    out.push({ campo: 'categoria', antes: target.categoria || '—', depois: row.categoria });
  if (fields.unidade && row.unidade && row.unidade !== target.unidade)
    out.push({ campo: 'unidade', antes: target.unidade, depois: row.unidade });
  if (fields.observacoes && row.observacoes !== undefined && row.observacoes !== '' && row.observacoes !== target.observacoes)
    out.push({ campo: 'observacoes', antes: target.observacoes || '—', depois: row.observacoes });
  if (fields.base && row.base && (row.base.qtd !== target.propQtd || row.base.unidade !== target.propUnidade))
    out.push({ campo: 'base', antes: baseText(target.propQtd, target.propUnidade), depois: baseText(row.base.qtd, row.base.unidade) });
  return out;
}

/**
 * Compara as linhas do arquivo com a lista atual.
 * - Com ID interno: casa por ID.
 * - Sem ID: nome normalizado + categoria + unidade (só compara o que o arquivo informa).
 * - Mesmo nome com categoria/unidade diferente = POSSÍVEL duplicado (decisão manual, nunca automático).
 */
export function buildPlan(rows: ParsedRow[], existing: Product[], fields: UpdateFields): PlanRow[] {
  const byId = new Map(existing.map((p) => [p.id, p]));
  const plan: PlanRow[] = [];
  const seen = new Map<string, number>(); // chave exata -> linha
  const seenNames = new Map<string, number>(); // nome -> primeira linha

  for (const parsed of rows) {
    if (parsed.status === 'ignorada') continue;
    const base: PlanRow = { linha: parsed.linha, parsed, classe: 'invalido', mudancas: [], selecionavel: false, acaoPadrao: 'skip' };
    if (parsed.status === 'invalida' || !parsed.data) {
      plan.push({ ...base, detalhe: parsed.motivo });
      continue;
    }
    const d = parsed.data;
    const nameKey = norm(d.nome);
    const unit = d.unidade ?? null;
    const exactKey = `${nameKey}|${norm(d.categoria ?? '')}|${unit ?? ''}`;

    // 1) por ID interno
    let alvo: Product | undefined = d.id ? byId.get(d.id) : undefined;
    // 2) por nome + categoria + unidade (apenas atributos informados)
    if (!alvo) {
      alvo = existing.find(
        (p) =>
          norm(p.nome) === nameKey &&
          (d.categoria === undefined || norm(p.categoria) === norm(d.categoria)) &&
          (unit == null || p.unidade === unit),
      );
    }

    if (alvo) {
      if (seen.has(exactKey) || (d.id && seen.has('id:' + d.id))) {
        plan.push({ ...base, classe: 'duplicado', alvo, detalhe: `Repetido no arquivo (já aparece na linha ${seen.get(exactKey) ?? seen.get('id:' + d.id)})`, selecionavel: true });
        continue;
      }
      seen.set(exactKey, parsed.linha);
      if (d.id) seen.set('id:' + d.id, parsed.linha);
      const mudancas = diff(d, alvo, fields);
      if (mudancas.length === 0) plan.push({ ...base, classe: 'existente', alvo });
      else plan.push({ ...base, classe: 'alterado', alvo, mudancas, selecionavel: true, acaoPadrao: 'update' });
      continue;
    }

    // não casou: pode ser novo, ou possível duplicado
    const sameName = existing.find((p) => norm(p.nome) === nameKey);
    const inFile = seen.has(exactKey) ? seen.get(exactKey) : undefined;
    if (inFile !== undefined) {
      plan.push({ ...base, classe: 'duplicado', detalhe: `Repetido no arquivo (já aparece na linha ${inFile})`, selecionavel: true });
      continue;
    }
    if (sameName) {
      seen.set(exactKey, parsed.linha);
      plan.push({
        ...base,
        classe: 'duplicado',
        alvo: sameName,
        detalhe: `Já existe “${sameName.nome}” (${sameName.categoria || 'sem categoria'} · ${sameName.unidade}). Mesmo nome, mas categoria ou unidade diferentes.`,
        selecionavel: true,
      });
      continue;
    }
    const namePrev = seenNames.get(nameKey);
    seen.set(exactKey, parsed.linha);
    seenNames.set(nameKey, namePrev ?? parsed.linha);
    if (namePrev !== undefined) {
      plan.push({ ...base, classe: 'duplicado', detalhe: `Mesmo nome da linha ${namePrev}, com categoria ou unidade diferentes.`, selecionavel: true });
      continue;
    }
    if (parsed.status === 'incompleta') {
      plan.push({ ...base, classe: 'incompleto', detalhe: parsed.motivo, selecionavel: true, acaoPadrao: 'skip' });
      continue;
    }
    plan.push({ ...base, classe: 'novo', selecionavel: true, acaoPadrao: 'add' });
  }
  return plan;
}

export interface Decision {
  selecionada: boolean;
  acao: Acao;
}

export interface ApplyResult {
  produtos: Product[];
  categorias: string[];
  registro: ImportRecord;
}

function newProductFrom(d: NonNullable<ParsedRow['data']>, defaultUnit: string): Product {
  const unidade = d.unidade ?? defaultUnit;
  const prop = d.base && compatibleUnits(unidade).includes(d.base.unidade) ? { qtd: d.base.qtd, unidade: d.base.unidade } : defaultProportional(unidade);
  return {
    id: newId(),
    nome: d.nome,
    categoria: d.categoria ?? '',
    unidade,
    custo: d.custo ?? null,
    custosAdicionais: d.custosAdicionais ?? 0,
    venda: d.venda ?? null,
    propQtd: prop?.qtd ?? null,
    propUnidade: prop?.unidade ?? null,
    observacoes: d.observacoes ?? '',
  };
}

/**
 * Aplica SOMENTE o que o usuário selecionou. Mexe apenas em produtos e categorias.
 * Nunca exclui nada. Devolve o registro necessário para desfazer.
 */
export function applyPlan(
  plan: PlanRow[],
  decisions: Record<number, Decision>,
  existing: Product[],
  categorias: string[],
  fields: UpdateFields,
  defaultUnit: string,
): ApplyResult {
  const produtos = existing.map((p) => ({ ...p }));
  const cats = [...categorias];
  const catByNorm = new Map(cats.map((c) => [norm(c), c]));
  const adicionados: string[] = [];
  const atualizados = new Map<string, Product>();
  const categoriasAdicionadas: string[] = [];
  let nAdd = 0;
  let nUpd = 0;

  const ensureCategory = (name: string | undefined): string => {
    const n = (name ?? '').trim();
    if (!n) return '';
    const known = catByNorm.get(norm(n));
    if (known) return known;
    cats.push(n);
    catByNorm.set(norm(n), n);
    categoriasAdicionadas.push(n);
    return n;
  };

  for (const row of plan) {
    const dec = decisions[row.linha];
    if (!dec || !dec.selecionada || !row.selecionavel || dec.acao === 'skip' || !row.parsed.data) continue;
    const d = row.parsed.data;
    if (dec.acao === 'add') {
      const p = newProductFrom({ ...d, categoria: undefined }, defaultUnit);
      p.categoria = ensureCategory(d.categoria);
      produtos.push(p);
      adicionados.push(p.id);
      nAdd++;
    } else if (dec.acao === 'update' && row.alvo) {
      const idx = produtos.findIndex((p) => p.id === row.alvo!.id);
      if (idx < 0) continue;
      const cur = produtos[idx];
      if (!atualizados.has(cur.id)) atualizados.set(cur.id, { ...cur });
      const next = { ...cur };
      if (fields.custo && d.custo != null) next.custo = d.custo;
      if (fields.venda && d.venda != null) next.venda = d.venda;
      if (fields.custosAdicionais && d.custosAdicionais != null) next.custosAdicionais = d.custosAdicionais;
      if (fields.categoria && d.categoria) next.categoria = ensureCategory(d.categoria);
      if (fields.unidade && d.unidade) next.unidade = d.unidade;
      if (fields.observacoes && d.observacoes) next.observacoes = d.observacoes;
      if (fields.base && d.base) {
        next.propQtd = d.base.qtd;
        next.propUnidade = d.base.unidade;
      }
      produtos[idx] = next;
      nUpd++;
    }
  }

  return {
    produtos,
    categorias: cats,
    registro: {
      adicionados,
      atualizados: [...atualizados.values()],
      categoriasAdicionadas,
      quando: Date.now(),
      resumo: `${nAdd} novo(s), ${nUpd} atualizado(s)`,
    },
  };
}

/** Desfaz exatamente o que a última importação fez, sem tocar no resto da lista. */
export function undoImport(produtos: Product[], categorias: string[], rec: ImportRecord): { produtos: Product[]; categorias: string[] } {
  const added = new Set(rec.adicionados);
  const before = new Map(rec.atualizados.map((p) => [p.id, p]));
  const restored = produtos.filter((p) => !added.has(p.id)).map((p) => before.get(p.id) ?? p);
  const stillUsed = new Set(restored.map((p) => norm(p.categoria)));
  const cats = categorias.filter((c) => !rec.categoriasAdicionadas.includes(c) || stillUsed.has(norm(c)));
  return { produtos: restored, categorias: cats };
}
