import { useMemo, useState } from 'react';
import type { Product } from '../types';
import { useApp } from '../state/store';
import { Button, Field, MoneyInput, Modal, NumberInput, Notice } from '../ui/ui';
import { BASE_UNITS, compatibleUnits, contentOf, defaultProportional, defaultProportionalForContent, familyOf, proportionalPrice, formatQtyUnit } from '../core/units';
import { norm } from '../core/normalize';
import { formatBRL, parseNumberBR } from '../core/money';
import { calcPrice, paymentById, purchaseCost, weightedAverageCost } from '../core/pricing';

/** Campo numérico opcional (vazio = sem valor). */
function OptionalNumber({ value, onChange, ariaLabel, id, placeholder }: { value: number | null | undefined; onChange: (v: number | null) => void; ariaLabel?: string; id?: string; placeholder?: string }) {
  const [text, setText] = useState(value == null ? '' : String(value).replace('.', ','));
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseNumberBR(e.target.value);
        onChange(e.target.value.trim() === '' || n == null || n < 0 ? null : n);
      }}
    />
  );
}

const NOVA = '__nova__';
const OUTRA = '__outra__';

export function ProductForm({ inicial, novo, onClose }: { inicial: Product; novo: boolean; onClose: () => void }) {
  const { state, act } = useApp();
  const [d, setD] = useState<Product>(inicial);
  const [catSel, setCatSel] = useState<string>(inicial.categoria);
  const [novaCat, setNovaCat] = useState('');
  const [unSel, setUnSel] = useState<string>(BASE_UNITS.includes(inicial.unidade) ? inicial.unidade : OUTRA);
  const [unOutra, setUnOutra] = useState(BASE_UNITS.includes(inicial.unidade) ? '' : inicial.unidade);
  const [tentou, setTentou] = useState(false);
  const [sugestao, setSugestao] = useState<{ ok: boolean; texto: string } | null>(null);
  const [compraAberta, setCompraAberta] = useState(false);
  const [compra, setCompra] = useState<{ qtd: number | null; un: string; valor: number | null; frete: number | null; impV: number | null; impP: number | null; outras: number | null; desc: number | null; somar: boolean }>({
    qtd: null, un: '', valor: null, frete: null, impV: null, impP: null, outras: null, desc: null, somar: true,
  });

  const set = (patch: Partial<Product>) => setD((prev) => ({ ...prev, ...patch }));

  const unidade = unSel === OUTRA ? unOutra.trim() : unSel;
  const categoria = catSel === NOVA ? novaCat.trim() : catSel;
  const compat = compatibleUnits(unidade);
  const contagem = !!unidade && familyOf(unidade) === 'contagem';
  const conteudo = contentOf({ unidade, conteudoQtd: d.conteudoQtd, conteudoUnidade: d.conteudoUnidade });
  // unidades possíveis para o preço proporcional: as da própria unidade (kg, L) ou as do conteúdo da embalagem (pacote de 250 g)
  const propUnits = compat.length > 0 ? compat : conteudo ? compatibleUnits(conteudo.unidade) : [];
  const temProp = d.propQtd != null && d.propUnidade != null;

  function trocarUnidade(u: string) {
    const dp = defaultProportional(u);
    const keep = familyOf(u) === 'contagem';
    set({ unidade: u, propQtd: dp?.qtd ?? null, propUnidade: dp?.unidade ?? null, ...(keep ? {} : { conteudoQtd: null, conteudoUnidade: null }) });
  }

  function mudarConteudo(qtd: number | null, un: string) {
    const c = qtd && qtd > 0 ? { qtd, unidade: un } : null;
    const dp = !temProp ? defaultProportionalForContent(c) : null;
    set({ conteudoQtd: qtd, conteudoUnidade: un, ...(dp ? { propQtd: dp.qtd, propUnidade: dp.unidade } : {}) });
  }

  const nome = d.nome.trim();
  const erroNome = !nome ? 'Informe o nome do produto.' : null;
  const erroUnidade = !unidade ? 'Informe a unidade de medida.' : null;
  const duplicado = useMemo(
    () => state.lista.produtos.find((p) => p.id !== d.id && norm(p.nome) === norm(nome) && norm(p.categoria) === norm(categoria) && p.unidade === unidade),
    [state.lista.produtos, d.id, nome, categoria, unidade],
  );
  const erroDup = duplicado ? 'Já existe um produto com este nome, categoria e unidade. Altere um deles ou edite o que já existe.' : null;
  const erroCat = catSel === NOVA && !novaCat.trim() ? 'Digite o nome da nova categoria.' : null;

  const prop = proportionalPrice(d.venda, unidade, d.propQtd, d.propUnidade, conteudo);

  // ---- Lançar compra: custo efetivo da compra (com frete e impostos) e custo médio ----
  const compraUn = compat.length > 0 && compat.includes(compra.un) ? compra.un : unidade;
  const calc = compraAberta && compra.qtd && compra.valor != null
    ? purchaseCost({ qtd: compra.qtd, unidadeCompra: compraUn, unidadeProduto: unidade, valorTotal: compra.valor, frete: compra.frete ?? 0, impostosValor: compra.impV ?? 0, impostosPct: compra.impP ?? 0, outras: compra.outras ?? 0, desconto: compra.desc ?? 0 })
    : null;
  const custoMedio = calc?.ok ? weightedAverageCost(d.estoque, d.custo, calc.qtdNaUnidade, calc.totalCents) : null;

  function usarCusto(novoCusto: number) {
    if (!calc?.ok) return;
    const novoEstoque = compra.somar ? Math.round(((d.estoque ?? 0) + calc.qtdNaUnidade) * 1000) / 1000 : d.estoque ?? null;
    set({ custo: novoCusto, estoque: novoEstoque });
    setSugestao(null);
    setCompra({ qtd: null, un: '', valor: null, frete: null, impV: null, impP: null, outras: null, desc: null, somar: true });
    setCompraAberta(false);
  }

  function sugerir() {
    const pay = paymentById(state.config, state.config.pagamentoBase);
    const r = calcPrice({ custo: d.custo, custosAdicionais: d.custosAdicionais }, state.config, pay.taxa);
    if (!r.ok) {
      setSugestao({ ok: false, texto: r.motivo });
      return;
    }
    set({ venda: r.precoCents });
    setSugestao({ ok: true, texto: `Preço sugerido ${formatBRL(r.precoCents)} (${pay.label.toLowerCase()}, margem ${String(state.config.margem.valor).replace('.', ',')}%${state.config.margem.modo === 'markup' ? ' de markup' : ''}). Você pode ajustar.` });
  }

  function salvar() {
    setTentou(true);
    if (erroNome || erroUnidade || erroDup || erroCat) return;
    const known = state.lista.categorias.find((c) => norm(c) === norm(categoria));
    act.salvarProduto({
      ...d,
      nome,
      unidade,
      categoria: known ?? categoria,
      observacoes: d.observacoes.trim(),
      propQtd: temProp && propUnits.includes(d.propUnidade!) ? d.propQtd : null,
      propUnidade: temProp && propUnits.includes(d.propUnidade!) ? d.propUnidade : null,
      estoque: d.estoque ?? null,
      conteudoQtd: conteudo ? conteudo.qtd : null,
      conteudoUnidade: conteudo ? conteudo.unidade : null,
    });
    onClose();
  }

  return (
    <Modal
      open
      wide
      title={novo ? 'Novo produto' : 'Editar produto'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={salvar} icon="check">
            {novo ? 'Adicionar produto' : 'Salvar alterações'}
          </Button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <Field label="Nome do produto" erro={tentou ? erroNome ?? erroDup : null} className="span-2">
          {(id) => <input id={id} value={d.nome} onChange={(e) => set({ nome: e.target.value })} autoFocus placeholder="Ex.: Castanha-do-pará" />}
        </Field>

        <Field label="Categoria" erro={tentou ? erroCat : null}>
          {(id) => (
            <>
              <select id={id} value={catSel} onChange={(e) => setCatSel(e.target.value)}>
                <option value="">Sem categoria</option>
                {state.lista.categorias.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value={NOVA}>+ Nova categoria…</option>
              </select>
              {catSel === NOVA && <input className="mt" aria-label="Nome da nova categoria" value={novaCat} onChange={(e) => setNovaCat(e.target.value)} placeholder="Nome da nova categoria" />}
            </>
          )}
        </Field>

        <Field label="Unidade de medida" erro={tentou ? erroUnidade : null} hint="A unidade em que o preço é informado (ex.: preço por kg).">
          {(id) => (
            <>
              <select
                id={id}
                value={unSel}
                onChange={(e) => {
                  setUnSel(e.target.value);
                  if (e.target.value !== OUTRA) trocarUnidade(e.target.value);
                  else trocarUnidade(unOutra.trim());
                }}
              >
                {BASE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
                <option value={OUTRA}>Outra…</option>
              </select>
              {unSel === OUTRA && (
                <input
                  className="mt"
                  aria-label="Nome da unidade personalizada"
                  value={unOutra}
                  onChange={(e) => {
                    setUnOutra(e.target.value);
                    trocarUnidade(e.target.value.trim());
                  }}
                  placeholder="Ex.: fardo, saco, dúzia"
                />
              )}
            </>
          )}
        </Field>

        <Field label="Custo de aquisição" hint="Quanto você paga pelo produto, na unidade acima.">
          {(id) => <MoneyInput id={id} value={d.custo} onChange={(v) => set({ custo: v })} />}
        </Field>

        <Field label="Custos adicionais do produto" hint="Frete, embalagem ou outro custo só deste item (por unidade).">
          {(id) => <MoneyInput id={id} value={d.custosAdicionais || null} onChange={(v) => set({ custosAdicionais: v ?? 0 })} />}
        </Field>

        {contagem && (
          <Field label={`Conteúdo de cada ${unidade} (opcional)`} className="span-2" hint="Ex.: pacote de 250 g, frasco de 500 ml. Permite mostrar o preço por 100 g / 100 ml e usar o Balcão por peso.">
            {(id) => (
              <div className="row-gap">
                <OptionalNumber id={id} ariaLabel="Quantidade de conteúdo da embalagem" placeholder="Ex.: 250" value={d.conteudoQtd} onChange={(v) => mudarConteudo(v, d.conteudoUnidade ?? 'g')} />
                <select aria-label="Unidade do conteúdo" value={d.conteudoUnidade ?? 'g'} onChange={(e) => mudarConteudo(d.conteudoQtd ?? null, e.target.value)}>
                  {['g', 'kg', 'ml', 'L'].map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </Field>
        )}

        <Field label="Estoque atual (opcional)" hint={`Quantidade em estoque, em ${unidade || 'unidades'}. Usada no custo médio e na ficha de inventário.`}>
          {(id) => <OptionalNumber id={id} placeholder="Ex.: 12" value={d.estoque} onChange={(v) => set({ estoque: v })} />}
        </Field>

        <div className="span-2">
          <Button variant="secondary" icon="plus" onClick={() => setCompraAberta((v) => !v)} aria-expanded={compraAberta}>
            Lançar compra (frete e impostos)
          </Button>
        </div>
        {compraAberta && (
          <fieldset className="span-2 prop-box">
            <legend>Compra de mercadoria</legend>
            <div className="form-grid">
              <Field label="Quantidade comprada">
                {(id) => (
                  <div className="row-gap">
                    <OptionalNumber id={id} placeholder="Ex.: 10" value={compra.qtd} onChange={(v) => setCompra((c) => ({ ...c, qtd: v }))} />
                    {compat.length > 0 ? (
                      <select aria-label="Unidade da compra" value={compraUn} onChange={(e) => setCompra((c) => ({ ...c, un: e.target.value }))}>
                        {compat.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="muted">{unidade}</span>
                    )}
                  </div>
                )}
              </Field>
              <Field label="Valor da mercadoria" hint="Total pago, sem frete e impostos.">
                {(id) => <MoneyInput id={id} value={compra.valor} onChange={(v) => setCompra((c) => ({ ...c, valor: v }))} />}
              </Field>
              <Field label="Frete">{(id) => <MoneyInput id={id} value={compra.frete} onChange={(v) => setCompra((c) => ({ ...c, frete: v }))} />}</Field>
              <Field label="Impostos de entrada (R$)">{(id) => <MoneyInput id={id} value={compra.impV} onChange={(v) => setCompra((c) => ({ ...c, impV: v }))} />}</Field>
              <Field label="Impostos de entrada (% da mercadoria)">
                {(id) => <OptionalNumber id={id} placeholder="Ex.: 4,5" value={compra.impP} onChange={(v) => setCompra((c) => ({ ...c, impP: v }))} />}
              </Field>
              <Field label="Outras despesas">{(id) => <MoneyInput id={id} value={compra.outras} onChange={(v) => setCompra((c) => ({ ...c, outras: v }))} />}</Field>
              <Field label="Desconto">{(id) => <MoneyInput id={id} value={compra.desc} onChange={(v) => setCompra((c) => ({ ...c, desc: v }))} />}</Field>
            </div>
            {calc && !calc.ok && <Notice tone="warn">{calc.motivo}</Notice>}
            {calc?.ok && (
              <div className="compra-res" aria-live="polite">
                <ul className="plain">
                  {calc.linhas.map((l) => (
                    <li key={l.label}>
                      {l.label}: {formatBRL(l.cents)}
                    </li>
                  ))}
                  <li>
                    <strong>Total da compra: {formatBRL(calc.totalCents)}</strong>
                  </li>
                </ul>
                <p>
                  Custo efetivo desta compra: <strong>{formatBRL(calc.custoUnitCents)}</strong> por {unidade}
                  {d.custo != null && <span className="muted"> · custo atual {formatBRL(d.custo)}</span>}
                </p>
                {custoMedio != null && d.estoque && d.estoque > 0 && d.custo != null && (
                  <p>
                    Custo médio com o estoque atual ({String(d.estoque).replace('.', ',')} {unidade}): <strong>{formatBRL(custoMedio)}</strong> por {unidade}
                  </p>
                )}
                <label className="check">
                  <input type="checkbox" checked={compra.somar} onChange={(e) => setCompra((c) => ({ ...c, somar: e.target.checked }))} />
                  Somar esta compra ao estoque
                </label>
                <div className="row-gap">
                  <Button onClick={() => usarCusto(calc.custoUnitCents)} icon="check">
                    Usar custo da compra
                  </Button>
                  {custoMedio != null && d.estoque && d.estoque > 0 && d.custo != null && (
                    <Button variant="secondary" onClick={() => usarCusto(custoMedio)}>
                      Usar custo médio
                    </Button>
                  )}
                </div>
                <small className="muted">O custo só muda no produto depois de “Salvar alterações”. A margem e o preço sugerido passam a usar o novo custo.</small>
              </div>
            )}
          </fieldset>
        )}

        <Field label="Preço de venda" className="span-2" hint="Preço que o cliente paga, na unidade acima.">
          {(id) => (
            <div className="row-gap">
              <MoneyInput id={id} value={d.venda} onChange={(v) => { set({ venda: v }); setSugestao(null); }} />
              <Button variant="secondary" icon="sparkle" onClick={sugerir} disabled={d.custo == null}>
                Calcular preço sugerido
              </Button>
            </div>
          )}
        </Field>
        {sugestao && (
          <div className="span-2">
            <Notice tone={sugestao.ok ? 'ok' : 'warn'}>{sugestao.texto}</Notice>
          </div>
        )}

        {propUnits.length > 0 && (
          <fieldset className="span-2 prop-box">
            <legend>Preço proporcional</legend>
            <label className="check">
              <input
                type="checkbox"
                checked={temProp}
                onChange={(e) => {
                  if (e.target.checked) {
                    const dp = defaultProportional(unidade) ?? defaultProportionalForContent(conteudo) ?? { qtd: 100, unidade: propUnits.find((u) => u !== unidade) ?? propUnits[0] };
                    set({ propQtd: dp.qtd, propUnidade: dp.unidade });
                  } else set({ propQtd: null, propUnidade: null });
                }}
              />
              Mostrar também o preço por uma quantidade menor
            </label>
            {temProp && (
              <div className="row-gap">
                <span className="muted">Preço por</span>
                <NumberInput ariaLabel="Quantidade da base proporcional" value={d.propQtd ?? 100} min={0.001} onChange={(v) => set({ propQtd: v })} className="w-sm" />
                <select aria-label="Unidade da base proporcional" value={d.propUnidade ?? ''} onChange={(e) => set({ propUnidade: e.target.value })}>
                  {propUnits.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <strong className="prop-result">
                  {prop == null ? '—' : `${formatBRL(prop)} por ${formatQtyUnit(d.propQtd ?? 0, d.propUnidade ?? '')}`}
                </strong>
              </div>
            )}
            <small className="muted">Calculado sobre o preço de venda já arredondado. Só converte unidades compatíveis (kg↔g, L↔ml).</small>
          </fieldset>
        )}

        <Field label="Observações" className="span-2" hint="Anotações internas. Não aparecem no PDF.">
          {(id) => <textarea id={id} rows={2} value={d.observacoes} onChange={(e) => set({ observacoes: e.target.value })} />}
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
