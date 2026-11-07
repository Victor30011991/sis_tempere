import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type { ImportRecord, ListState, Product, Settings, StoreInfo } from '../types';
import { defaultSettings, defaultStore } from '../core/defaults';
import { newId, norm } from '../core/normalize';
import { undoImport } from '../import/plan';
import { applyTheme } from '../ui/theme';

export interface AppState {
  lista: ListState;
  loja: StoreInfo;
  config: Settings;
  /** há alterações que ainda não foram salvas em Excel */
  sujo: boolean;
  /** nada foi digitado/importado ainda nesta sessão */
  intacto: boolean;
  ultimaImportacao: ImportRecord | null;
}

type Action =
  | { t: 'novaLista' }
  | { t: 'nomeLista'; nome: string }
  | { t: 'salvarProduto'; produto: Product }
  | { t: 'excluirProdutos'; ids: string[] }
  | { t: 'duplicar'; ids: string[] }
  | { t: 'precos'; itens: { id: string; venda: number }[] }
  | { t: 'campo'; id: string; campo: 'custo' | 'venda'; valor: number | null }
  | { t: 'mudarCategoria'; ids: string[]; categoria: string }
  | { t: 'addCategoria'; nome: string }
  | { t: 'renomearCategoria'; de: string; para: string }
  | { t: 'excluirCategoria'; nome: string }
  | { t: 'importacao'; produtos: Product[]; categorias: string[]; registro: ImportRecord }
  | { t: 'desfazerImportacao' }
  | { t: 'restaurarConfig'; loja: StoreInfo; financeiro: Settings; nomeLista?: string }
  | { t: 'loja'; patch: Partial<StoreInfo> }
  | { t: 'config'; fn: (s: Settings) => Settings }
  | { t: 'salvo' };

const initial = (): AppState => ({
  lista: { nome: 'Minha lista de preços', produtos: [], categorias: [] },
  loja: defaultStore(),
  config: defaultSettings(),
  sujo: false,
  intacto: true,
  ultimaImportacao: null,
});

function withCategory(cats: string[], name: string): string[] {
  const n = name.trim();
  if (!n || cats.some((c) => norm(c) === norm(n))) return cats;
  return [...cats, n];
}

function reducer(s: AppState, a: Action): AppState {
  const touch = (patch: Partial<AppState>): AppState => ({ ...s, ...patch, sujo: true, intacto: false });
  const setLista = (l: Partial<ListState>) => touch({ lista: { ...s.lista, ...l } });
  switch (a.t) {
    case 'novaLista':
      return { ...s, lista: { nome: 'Nova lista de preços', produtos: [], categorias: [] }, sujo: false, intacto: true, ultimaImportacao: null };
    case 'nomeLista':
      return setLista({ nome: a.nome });
    case 'salvarProduto': {
      const exists = s.lista.produtos.some((p) => p.id === a.produto.id);
      const produtos = exists ? s.lista.produtos.map((p) => (p.id === a.produto.id ? a.produto : p)) : [...s.lista.produtos, a.produto];
      return setLista({ produtos, categorias: withCategory(s.lista.categorias, a.produto.categoria) });
    }
    case 'excluirProdutos': {
      const ids = new Set(a.ids);
      return setLista({ produtos: s.lista.produtos.filter((p) => !ids.has(p.id)) });
    }
    case 'duplicar': {
      const ids = new Set(a.ids);
      const copies = s.lista.produtos.filter((p) => ids.has(p.id)).map((p) => ({ ...p, id: newId(), nome: `${p.nome} (cópia)` }));
      return setLista({ produtos: [...s.lista.produtos, ...copies] });
    }
    case 'precos': {
      const map = new Map(a.itens.map((i) => [i.id, i.venda]));
      return setLista({ produtos: s.lista.produtos.map((p) => (map.has(p.id) ? { ...p, venda: map.get(p.id)! } : p)) });
    }
    case 'campo':
      return setLista({ produtos: s.lista.produtos.map((p) => (p.id === a.id ? { ...p, [a.campo]: a.valor } : p)) });
    case 'mudarCategoria': {
      const ids = new Set(a.ids);
      return setLista({
        produtos: s.lista.produtos.map((p) => (ids.has(p.id) ? { ...p, categoria: a.categoria } : p)),
        categorias: withCategory(s.lista.categorias, a.categoria),
      });
    }
    case 'addCategoria':
      return setLista({ categorias: withCategory(s.lista.categorias, a.nome) });
    case 'renomearCategoria': {
      const para = a.para.trim();
      if (!para) return s;
      const cats = s.lista.categorias.map((c) => (c === a.de ? para : c));
      const dedup = cats.filter((c, i) => cats.findIndex((x) => norm(x) === norm(c)) === i);
      return setLista({ categorias: dedup, produtos: s.lista.produtos.map((p) => (p.categoria === a.de ? { ...p, categoria: para } : p)) });
    }
    case 'excluirCategoria':
      // os produtos NÃO são excluídos: apenas ficam sem categoria
      return setLista({
        categorias: s.lista.categorias.filter((c) => c !== a.nome),
        produtos: s.lista.produtos.map((p) => (p.categoria === a.nome ? { ...p, categoria: '' } : p)),
      });
    case 'importacao':
      return touch({ lista: { ...s.lista, produtos: a.produtos, categorias: a.categorias }, ultimaImportacao: a.registro });
    case 'desfazerImportacao': {
      if (!s.ultimaImportacao) return s;
      const r = undoImport(s.lista.produtos, s.lista.categorias, s.ultimaImportacao);
      return touch({ lista: { ...s.lista, produtos: r.produtos, categorias: r.categorias }, ultimaImportacao: null });
    }
    case 'restaurarConfig':
      return touch({
        loja: a.loja,
        config: a.financeiro,
        lista: a.nomeLista && s.lista.produtos.length === 0 ? { ...s.lista, nome: a.nomeLista } : s.lista,
      });
    case 'loja':
      return touch({ loja: { ...s.loja, ...a.patch } });
    case 'config':
      return touch({ config: a.fn(s.config) });
    case 'salvo':
      return { ...s, sujo: false };
  }
}

interface Ctx {
  state: AppState;
  dispatch: (a: Action) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initial);

  useEffect(() => applyTheme(state.loja.cores), [state.loja.cores]);

  // avisa antes de fechar/atualizar a página com alterações não salvas
  useEffect(() => {
    if (!state.sujo) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [state.sujo]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp fora do AppProvider');
  const { state, dispatch } = ctx;
  const act = useMemo(
    () => ({
      novaLista: () => dispatch({ t: 'novaLista' }),
      nomeLista: (nome: string) => dispatch({ t: 'nomeLista', nome }),
      salvarProduto: (produto: Product) => dispatch({ t: 'salvarProduto', produto }),
      excluirProdutos: (ids: string[]) => dispatch({ t: 'excluirProdutos', ids }),
      duplicar: (ids: string[]) => dispatch({ t: 'duplicar', ids }),
      precos: (itens: { id: string; venda: number }[]) => dispatch({ t: 'precos', itens }),
      campo: (id: string, campo: 'custo' | 'venda', valor: number | null) => dispatch({ t: 'campo', id, campo, valor }),
      mudarCategoria: (ids: string[], categoria: string) => dispatch({ t: 'mudarCategoria', ids, categoria }),
      addCategoria: (nome: string) => dispatch({ t: 'addCategoria', nome }),
      renomearCategoria: (de: string, para: string) => dispatch({ t: 'renomearCategoria', de, para }),
      excluirCategoria: (nome: string) => dispatch({ t: 'excluirCategoria', nome }),
      importacao: (produtos: Product[], categorias: string[], registro: ImportRecord) => dispatch({ t: 'importacao', produtos, categorias, registro }),
      desfazerImportacao: () => dispatch({ t: 'desfazerImportacao' }),
      restaurarConfig: (loja: StoreInfo, financeiro: Settings, nomeLista?: string) => dispatch({ t: 'restaurarConfig', loja, financeiro, nomeLista }),
      loja: (patch: Partial<StoreInfo>) => dispatch({ t: 'loja', patch }),
      config: (fn: (s: Settings) => Settings) => dispatch({ t: 'config', fn }),
      salvo: () => dispatch({ t: 'salvo' }),
    }),
    [dispatch],
  );
  return { state, act };
}
