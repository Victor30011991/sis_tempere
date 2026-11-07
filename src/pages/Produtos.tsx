import { Fragment, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Product } from '../types';
import { useApp } from '../state/store';
import { useFeedback, useDocumentTitle } from '../ui/feedback';
import { Button, Chip, Empty, PageHeader } from '../ui/ui';
import { Icon } from '../ui/icons';
import { formatBRL, parseMoney } from '../core/money';
import { norm, newId } from '../core/normalize';
import { contentOf, defaultProportional, formatQtyUnit, proportionalPrice } from '../core/units';
import { SORT_LABELS, groupByCategory, sortProducts, type SortMode } from '../core/sort';
import { calcPrice, paymentById, suggestedCents } from '../core/pricing';
import { Balcao } from '../components/Balcao';
import { ProductForm } from './ProductForm';

type ColKey = 'categoria' | 'unidade' | 'custo' | 'venda' | 'sugerido' | 'prop' | 'estoque' | 'obs';
const COLS: { k: ColKey; label: string }[] = [
  { k: 'categoria', label: 'Categoria' },
  { k: 'unidade', label: 'Unidade' },
  { k: 'custo', label: 'Custo' },
  { k: 'venda', label: 'Preço de venda' },
  { k: 'sugerido', label: 'Preço sugerido' },
  { k: 'prop', label: 'Preço proporcional' },
  { k: 'estoque', label: 'Estoque' },
  { k: 'obs', label: 'Observações' },
];

function blank(): Product {
  const dp = defaultProportional('kg');
  return { id: newId(), nome: '', categoria: '', unidade: 'kg', custo: null, custosAdicionais: 0, venda: null, propQtd: dp?.qtd ?? null, propUnidade: dp?.unidade ?? null, observacoes: '' };
}

function InlineMoney({ value, onCommit, label, strong = false }: { value: number | null; onCommit: (v: number | null) => void; label: string; strong?: boolean }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState('');
  const done = useRef(false);
  if (!edit)
    return (
      <button
        type="button"
        className={`inline-edit ${strong ? 'strong' : ''}`}
        aria-label={`Editar ${label}`}
        title="Clique para editar"
        onClick={() => {
          done.current = false;
          setText(value == null ? '' : (value / 100).toFixed(2).replace('.', ','));
          setEdit(true);
        }}
      >
        {formatBRL(value)}
      </button>
    );
  const commit = () => {
    if (done.current) return;
    done.current = true;
    setEdit(false);
    if (text.trim() === '') return onCommit(null);
    const c = parseMoney(text);
    if (c != null && c >= 0) onCommit(c);
  };
  return (
    <input
      className="inline-input"
      aria-label={label}
      autoFocus
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          done.current = true;
          setEdit(false);
        }
      }}
    />
  );
}

export default function Produtos() {
  useDocumentTitle('Produtos');
  const { state, act } = useApp();
  const { confirm, toast } = useFeedback();
  const { produtos, categorias } = state.lista;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('todas');
  const [sort, setSort] = useState<SortMode>('az');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [cols, setCols] = useState<Set<ColKey>>(new Set(['categoria', 'unidade', 'custo', 'venda', 'sugerido', 'prop']));
  const [showCols, setShowCols] = useState(false);
  const [form, setForm] = useState<{ p: Product; novo: boolean } | null>(null);
  const [catLote, setCatLote] = useState('');
  const [balcao, setBalcao] = useState(false);

  const filtrados = useMemo(() => {
    const nq = norm(q);
    return produtos.filter((p) => (!nq || norm(p.nome).includes(nq)) && (cat === 'todas' || (cat === '__sem' ? !p.categoria : p.categoria === cat)));
  }, [produtos, q, cat]);
  const ordenados = useMemo(() => sortProducts(filtrados, sort), [filtrados, sort]);
  const grupos = useMemo(() => (sort === 'categoria' ? groupByCategory(ordenados) : [{ categoria: null as string | null, itens: ordenados }]), [ordenados, sort]);

  // preço sugerido de cada produto, com as premissas atuais (só leitura: não altera nada)
  const sugeridos = useMemo(() => new Map(produtos.map((p) => [p.id, suggestedCents(p, state.config)])), [produtos, state.config]);

  const visSel = ordenados.filter((p) => sel.has(p.id));
  const todosMarcados = ordenados.length > 0 && visSel.length === ordenados.length;
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleAll = () => setSel(todosMarcados ? new Set() : new Set(ordenados.map((p) => p.id)));
  const colOn = (k: ColKey) => cols.has(k);

  function sortBy(asc: SortMode, desc: SortMode) {
    setSort(sort === asc ? desc : asc);
  }

  async function excluir(ids: string[]) {
    const nomes = produtos.filter((p) => ids.includes(p.id)).map((p) => p.nome);
    const ok = await confirm({
      titulo: ids.length === 1 ? 'Excluir este produto?' : `Excluir ${ids.length} produtos?`,
      mensagem: (
        <>
          <p>{ids.length === 1 ? <strong>{nomes[0]}</strong> : <>Os {ids.length} produtos selecionados</>} será removido da lista. Esta ação não pode ser desfeita (salve o Excel antes, se tiver dúvida).</p>
        </>
      ),
      confirmar: 'Excluir',
      perigo: true,
    });
    if (!ok) return;
    act.excluirProdutos(ids);
    setSel((s) => new Set([...s].filter((x) => !ids.includes(x))));
    toast(ids.length === 1 ? 'Produto excluído.' : `${ids.length} produtos excluídos.`, 'info');
  }

  async function sugerirPrecos(ids: string[]) {
    const pay = paymentById(state.config, state.config.pagamentoBase);
    const itens: { id: string; venda: number }[] = [];
    let semCusto = 0;
    let inviavel = 0;
    for (const p of produtos.filter((x) => ids.includes(x.id))) {
      if (p.custo == null) {
        semCusto++;
        continue;
      }
      const r = calcPrice(p, state.config, pay.taxa);
      if (r.ok) itens.push({ id: p.id, venda: r.precoCents });
      else inviavel++;
    }
    if (inviavel > 0 && itens.length === 0) {
      toast('Não foi possível calcular: confira margem, custos e taxas na tela Precificação.', 'erro');
      return;
    }
    if (itens.length === 0) {
      toast('Nenhum dos produtos selecionados tem custo de aquisição.', 'erro');
      return;
    }
    const ok = await confirm({
      titulo: 'Aplicar preços recomendados?',
      mensagem: (
        <>
          <p>
            O preço de venda de <strong>{itens.length}</strong> produto{itens.length === 1 ? '' : 's'} será substituído pelo preço recomendado ({pay.label.toLowerCase()}, margem de {String(state.config.margem.valor).replace('.', ',')}%{state.config.margem.modo === 'markup' ? ' de markup' : ''}).
          </p>
          {semCusto > 0 && <p className="muted">{semCusto} sem custo cadastrado serão ignorados.</p>}
          {inviavel > 0 && <p className="muted">{inviavel} não puderam ser calculados e serão ignorados.</p>}
        </>
      ),
      confirmar: 'Aplicar preços',
    });
    if (!ok) return;
    act.precos(itens);
    toast(`${itens.length} preço${itens.length === 1 ? '' : 's'} atualizado${itens.length === 1 ? '' : 's'}.`);
  }

  const renderProp = (p: Product) => {
    const v = proportionalPrice(p.venda, p.unidade, p.propQtd, p.propUnidade, contentOf(p));
    if (v == null || !p.propQtd || !p.propUnidade) return <span className="muted">—</span>;
    return (
      <>
        {formatBRL(v)} <small className="muted">/ {formatQtyUnit(p.propQtd, p.propUnidade)}</small>
      </>
    );
  };

  const renderSugerido = (p: Product) => {
    const sug = sugeridos.get(p.id) ?? null;
    if (sug == null) return <span className="muted">—</span>;
    if (p.venda != null && p.venda < sug)
      return (
        <span className="sug-low" title={`Preço atual ${formatBRL(sug - p.venda)} abaixo do sugerido: a margem real fica menor que a desejada.`}>
          {formatBRL(sug)} <span aria-hidden="true">▲</span>
          <span className="sr-only"> (preço atual abaixo do sugerido)</span>
        </span>
      );
    return <span className="sug-ok">{formatBRL(sug)}</span>;
  };

  const acoesRow = (p: Product) => (
    <span className="row-actions">
      <button type="button" className="icon-btn" aria-label={`Editar ${p.nome}`} onClick={() => setForm({ p, novo: false })}>
        <Icon name="edit" />
      </button>
      <button type="button" className="icon-btn" aria-label={`Duplicar ${p.nome}`} onClick={() => act.duplicar([p.id])}>
        <Icon name="copy" />
      </button>
      <button type="button" className="icon-btn danger" aria-label={`Excluir ${p.nome}`} onClick={() => excluir([p.id])}>
        <Icon name="trash" />
      </button>
    </span>
  );

  const nomeLista = (
    <input className="title-input" aria-label="Nome da lista" value={state.lista.nome} onChange={(e) => act.nomeLista(e.target.value)} />
  );

  return (
    <div className="page">
      <PageHeader
        titulo="Produtos"
        subtitulo={
          <>
            Lista: {nomeLista} · {produtos.length} produto{produtos.length === 1 ? '' : 's'} · {categorias.length} categoria{categorias.length === 1 ? '' : 's'}
          </>
        }
        acoes={
          <>
            <Button variant="secondary" icon="calc" onClick={() => setBalcao((v) => !v)} aria-expanded={balcao}>
              Balcão
            </Button>
            <Link to="/importar" className="btn btn-secondary">
              <Icon name="upload" /> Importar arquivo
            </Link>
            <Button icon="plus" onClick={() => setForm({ p: blank(), novo: true })}>
              Novo produto
            </Button>
          </>
        }
      />

      {balcao && <Balcao produtos={produtos} />}

      {produtos.length === 0 ? (
        <Empty
          titulo="Sua lista está vazia"
          icon="box"
          acoes={
            <>
              <Button icon="plus" onClick={() => setForm({ p: blank(), novo: true })}>
                Cadastrar primeiro produto
              </Button>
              <Link to="/importar" className="btn btn-secondary">
                <Icon name="upload" /> Importar de um arquivo
              </Link>
            </>
          }
        >
          Cadastre os produtos um a um ou traga uma planilha Excel, CSV ou TXT. Você confere tudo antes de entrar na lista.
        </Empty>
      ) : (
        <>
          <div className="toolbar">
            <label className="search">
              <Icon name="search" />
              <input type="search" aria-label="Buscar produto pelo nome" placeholder="Buscar produto" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <label className="inline-label">
              Categoria
              <select value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="todas">Todas</option>
                {categorias.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="__sem">Sem categoria</option>
              </select>
            </label>
            <label className="inline-label">
              Organizar
              <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
                {(Object.keys(SORT_LABELS) as SortMode[]).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <div className="pop">
              <Button variant="secondary" icon="columns" onClick={() => setShowCols((v) => !v)} aria-expanded={showCols}>
                Colunas
              </Button>
              {showCols && (
                <div className="pop-menu" role="group" aria-label="Colunas visíveis">
                  {COLS.map((c) => (
                    <label key={c.k} className="check">
                      <input
                        type="checkbox"
                        checked={cols.has(c.k)}
                        onChange={() =>
                          setCols((s) => {
                            const n = new Set(s);
                            n.has(c.k) ? n.delete(c.k) : n.add(c.k);
                            return n;
                          })
                        }
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {visSel.length > 0 && (
            <div className="bulkbar" role="region" aria-label="Ações para os selecionados">
              <strong>
                {visSel.length} selecionado{visSel.length === 1 ? '' : 's'}
              </strong>
              <Button variant="ghost" icon="sparkle" onClick={() => sugerirPrecos(visSel.map((p) => p.id))}>
                Aplicar preço recomendado
              </Button>
              <span className="inline-label">
                <select aria-label="Mover para categoria" value={catLote} onChange={(e) => setCatLote(e.target.value)}>
                  <option value="">Mover para categoria…</option>
                  <option value="__sem">Sem categoria</option>
                  {categorias.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  disabled={!catLote}
                  onClick={() => {
                    act.mudarCategoria(visSel.map((p) => p.id), catLote === '__sem' ? '' : catLote);
                    setCatLote('');
                    toast('Categoria atualizada.');
                  }}
                >
                  Mover
                </Button>
              </span>
              <Button variant="ghost" icon="copy" onClick={() => act.duplicar(visSel.map((p) => p.id))}>
                Duplicar
              </Button>
              <Button variant="ghost" className="danger-text" icon="trash" onClick={() => excluir(visSel.map((p) => p.id))}>
                Excluir
              </Button>
              <Button variant="ghost" onClick={() => setSel(new Set())}>
                Limpar seleção
              </Button>
            </div>
          )}

          {ordenados.length === 0 ? (
            <Empty titulo="Nenhum produto encontrado" icon="search">
              Tente outro nome ou outra categoria.
            </Empty>
          ) : (
            <>
              <div className="table-card desktop-only">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="c-check">
                        <input type="checkbox" aria-label="Selecionar todos" checked={todosMarcados} onChange={toggleAll} />
                      </th>
                      <th aria-sort={sort === 'az' ? 'ascending' : sort === 'za' ? 'descending' : 'none'}>
                        <button type="button" className="th-btn" onClick={() => sortBy('az', 'za')}>
                          Produto {sort === 'az' ? '↑' : sort === 'za' ? '↓' : ''}
                        </button>
                      </th>
                      {colOn('categoria') && <th>Categoria</th>}
                      {colOn('unidade') && <th>Unid.</th>}
                      {colOn('custo') && <th className="num">Custo</th>}
                      {colOn('venda') && (
                        <th className="num" aria-sort={sort === 'menor' ? 'ascending' : sort === 'maior' ? 'descending' : 'none'}>
                          <button type="button" className="th-btn" onClick={() => sortBy('menor', 'maior')}>
                            Preço de venda {sort === 'menor' ? '↑' : sort === 'maior' ? '↓' : ''}
                          </button>
                        </th>
                      )}
                      {colOn('sugerido') && <th className="num">Preço sugerido</th>}
                      {colOn('prop') && <th className="num">Preço proporcional</th>}
                      {colOn('estoque') && <th className="num">Estoque</th>}
                      {colOn('obs') && <th>Observações</th>}
                      <th className="c-actions">
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupos.map((g) => (
                      <Fragment key={g.categoria ?? 'todos'}>
                        {g.categoria !== null && (
                          <tr className="group-row">
                            <td colSpan={20}>
                              {g.categoria || 'Sem categoria'} <span className="muted">· {g.itens.length}</span>
                            </td>
                          </tr>
                        )}
                        {g.itens.map((p) => (
                          <tr key={p.id} className={sel.has(p.id) ? 'selected' : ''}>
                            <td className="c-check">
                              <input type="checkbox" aria-label={`Selecionar ${p.nome}`} checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
                            </td>
                            <td className="strong">{p.nome}</td>
                            {colOn('categoria') && <td>{p.categoria ? <span title={p.categoria}><Chip>{p.categoria}</Chip></span> : <span className="muted">—</span>}</td>}
                            {colOn('unidade') && <td className="muted nowrap">{p.unidade}</td>}
                            {colOn('custo') && (
                              <td className="num muted">
                                <InlineMoney value={p.custo} label={`custo de ${p.nome}`} onCommit={(v) => act.campo(p.id, 'custo', v)} />
                              </td>
                            )}
                            {colOn('venda') && (
                              <td className="num">
                                <InlineMoney strong value={p.venda} label={`preço de venda de ${p.nome}`} onCommit={(v) => act.campo(p.id, 'venda', v)} />
                              </td>
                            )}
                            {colOn('sugerido') && <td className="num">{renderSugerido(p)}</td>}
                            {colOn('prop') && <td className="num">{renderProp(p)}</td>}
                            {colOn('estoque') && <td className="num muted">{p.estoque != null ? `${String(p.estoque).replace('.', ',')} ${p.unidade}` : '—'}</td>}
                            {colOn('obs') && <td className="obs">{p.observacoes || <span className="muted">—</span>}</td>}
                            <td className="c-actions">{acoesRow(p)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="cards mobile-only">
                {grupos.map((g) => (
                  <Fragment key={g.categoria ?? 'todos'}>
                    {g.categoria !== null && <h3 className="group-title">{g.categoria || 'Sem categoria'}</h3>}
                    {g.itens.map((p) => (
                      <article key={p.id} className="pcard">
                        <div className="pcard-top">
                          <label className="check">
                            <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Selecionar ${p.nome}`} />
                            <strong>{p.nome}</strong>
                          </label>
                          {acoesRow(p)}
                        </div>
                        <div className="pcard-meta">
                          {p.categoria && <Chip>{p.categoria}</Chip>}
                          <span className="muted">por {p.unidade}</span>
                        </div>
                        <dl className="pcard-prices">
                          <div>
                            <dt>Custo</dt>
                            <dd>{formatBRL(p.custo)}</dd>
                          </div>
                          <div>
                            <dt>Venda</dt>
                            <dd className="strong">{formatBRL(p.venda)}</dd>
                          </div>
                          <div>
                            <dt>Sugerido</dt>
                            <dd>{renderSugerido(p)}</dd>
                          </div>
                          <div>
                            <dt>Proporcional</dt>
                            <dd>{renderProp(p)}</dd>
                          </div>
                        </dl>
                      </article>
                    ))}
                  </Fragment>
                ))}
              </div>
              <p className="muted table-foot">
                Mostrando {ordenados.length} de {produtos.length} produtos · preço proporcional calculado sobre o preço de venda arredondado · clique em um valor para editar rápido.
              </p>
            </>
          )}
        </>
      )}

      {form && <ProductForm key={form.p.id} inicial={form.p} novo={form.novo} onClose={() => setForm(null)} />}
    </div>
  );
}
