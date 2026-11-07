import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { useDocumentTitle, useFeedback } from '../ui/feedback';
import { Button, Empty, Field, MoneyInput, Notice, PageHeader, downloadBlob } from '../ui/ui';
import { Icon } from '../ui/icons';
import { formatBRL, formatPercent, parseNumberBR } from '../core/money';
import { norm, slug } from '../core/normalize';
import { compatibleUnits } from '../core/units';
import { paymentOptions } from '../core/pricing';
import { installments, lineTotal, orcamentoTotais, paymentInfo, type Desconto, type OrcamentoItem } from '../core/orcamento';
import { logoDataUrl } from '../ui/logo';

interface Rascunho {
  cliente: { nome: string; telefone: string; endereco: string };
  itens: OrcamentoItem[];
  pagamento: string;
  desconto: Desconto;
  obs: string;
}
const vazio = (): Rascunho => ({ cliente: { nome: '', telefone: '', endereco: '' }, itens: [], pagamento: 'pix', desconto: { tipo: 'valor', valor: null }, obs: '' });
// O orçamento em andamento sobrevive à troca de tela; recarregar a página começa um novo (não há banco de dados).
let rascunho: Rascunho = vazio();

const fmtQtd = (n: number) => String(Number(n.toFixed(3))).replace('.', ',');

function Qtd({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  const [text, setText] = useState(value == null ? '' : fmtQtd(value));
  return (
    <input
      className="orc-qtd"
      inputMode="decimal"
      aria-label={label}
      autoComplete="off"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseNumberBR(e.target.value);
        onChange(n != null && n > 0 ? n : null);
      }}
    />
  );
}

export default function Orcamento() {
  useDocumentTitle('Orçamento');
  const { state } = useApp();
  const { toast } = useFeedback();
  const { loja, config } = state;
  const [r, setR] = useState<Rascunho>(rascunho);
  const [busca, setBusca] = useState('');
  const [escolha, setEscolha] = useState('');
  const [gerando, setGerando] = useState(false);

  const atualizar = (fn: (r: Rascunho) => Rascunho) =>
    setR((old) => {
      rascunho = fn(old);
      return rascunho;
    });

  const produtos = state.lista.produtos;
  const vendaveis = useMemo(() => {
    const nq = norm(busca);
    return produtos.filter((p) => p.venda != null && (!nq || norm(p.nome).includes(nq))).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [produtos, busca]);
  const pagamentos = useMemo(() => paymentOptions(config), [config]);

  const linhas = r.itens
    .map((it) => {
      const p = produtos.find((x) => x.id === it.produtoId);
      return p ? { it, p, sub: lineTotal(p, it.qtd, it.unidade) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  const validas = linhas.filter((l) => l.sub != null);
  const subtotal = validas.reduce((a, l) => a + (l.sub ?? 0), 0);
  const tot = orcamentoTotais(subtotal, r.desconto);
  const pag = paymentInfo(config, r.pagamento);
  const parcelas = installments(tot.total, pag.parcelas);

  function adicionar(id: string) {
    const p = produtos.find((x) => x.id === id);
    if (!p) return;
    atualizar((o) => ({ ...o, itens: [...o.itens, { key: crypto.randomUUID(), produtoId: p.id, qtd: 1, unidade: p.unidade }] }));
    setEscolha('');
    setBusca('');
  }
  const mudarItem = (key: string, patch: Partial<OrcamentoItem>) => atualizar((o) => ({ ...o, itens: o.itens.map((i) => (i.key === key ? { ...i, ...patch } : i)) }));

  async function gerarPdf() {
    setGerando(true);
    try {
      const { buildOrcamentoPdf } = await import('../export/orcamentoPdf');
      const buf = await buildOrcamentoPdf(
        {
          cliente: r.cliente,
          linhas: validas.map((l) => ({ nome: l.p.nome, qtd: `${fmtQtd(l.it.qtd!)} ${l.it.unidade}`, unitario: `${formatBRL(l.p.venda)} / ${l.p.unidade}`, subtotal: l.sub! })),
          subtotal: tot.subtotal,
          desconto: tot.desconto,
          descontoLabel: r.desconto.tipo === 'pct' && tot.desconto > 0 ? `${formatPercent(r.desconto.valor ?? 0, 1)}` : '',
          total: tot.total,
          pagamento: { label: pag.label, parcelas: pag.parcelas },
          observacoes: r.obs.trim(),
        },
        loja,
        await logoDataUrl(loja),
      );
      downloadBlob(buf, `orcamento-${slug(r.cliente.nome) || 'cliente'}.pdf`, 'application/pdf');
      toast('PDF do orçamento gerado.');
    } catch {
      toast('Não foi possível gerar o PDF. Tente de novo.', 'erro');
    } finally {
      setGerando(false);
    }
  }

  const setCli = (k: keyof Rascunho['cliente'], v: string) => atualizar((o) => ({ ...o, cliente: { ...o.cliente, [k]: v } }));
  const semItens = validas.length === 0;

  return (
    <>
      <PageHeader
        titulo="Orçamento"
        subtitulo="Monte um orçamento ou nota de venda com os produtos da lista e gere um PDF para enviar ao cliente. Ele não é salvo: ao recarregar a página, começa um novo."
        acoes={
          <Button
            variant="ghost"
            icon="trash"
            disabled={r.itens.length === 0 && !r.cliente.nome && !r.obs}
            onClick={() => {
              rascunho = vazio();
              setR(rascunho);
            }}
          >
            Limpar orçamento
          </Button>
        }
      />

      {produtos.filter((p) => p.venda != null).length === 0 ? (
        <Empty icon="box" titulo="Nenhum produto com preço de venda">
          Cadastre produtos com preço de venda para montar orçamentos.
        </Empty>
      ) : (
        <div className="orc">
          <div className="orc-main">
            <section className="card" aria-labelledby="orc-cli">
              <h2 id="orc-cli">Cliente</h2>
              <div className="form-grid">
                <Field label="Nome">{(id) => <input id={id} autoComplete="off" value={r.cliente.nome} onChange={(e) => setCli('nome', e.target.value)} />}</Field>
                <Field label="Telefone / WhatsApp">{(id) => <input id={id} type="tel" inputMode="tel" autoComplete="off" value={r.cliente.telefone} onChange={(e) => setCli('telefone', e.target.value)} />}</Field>
                <Field label="Endereço / observações do cliente" className="span-2">
                  {(id) => <input id={id} autoComplete="off" value={r.cliente.endereco} onChange={(e) => setCli('endereco', e.target.value)} />}
                </Field>
              </div>
            </section>

            <section className="card" aria-labelledby="orc-itens">
              <h2 id="orc-itens">Itens do pedido</h2>
              <div className="orc-add">
                <Field label="Buscar produto">{(id) => <input id={id} type="search" autoComplete="off" value={busca} onChange={(e) => setBusca(e.target.value)} />}</Field>
                <Field label="Adicionar ao pedido">
                  {(id) => (
                    <select id={id} value={escolha} onChange={(e) => adicionar(e.target.value)}>
                      <option value="">{vendaveis.length ? 'Escolha o produto…' : 'Nenhum produto encontrado'}</option>
                      {vendaveis.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome} · {formatBRL(p.venda)}/{p.unidade}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>

              {linhas.length === 0 ? (
                <p className="muted">Nenhum item ainda. Escolha um produto acima.</p>
              ) : (
                <div className="table-scroll">
                  <table className="table compact">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Quantidade</th>
                        <th className="num">Valor unit.</th>
                        <th className="num">Subtotal</th>
                        <th className="c-actions">
                          <span className="sr-only">Remover</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.map(({ it, p, sub }) => {
                        const un = compatibleUnits(p.unidade);
                        return (
                          <tr key={it.key}>
                            <td className="strong">{p.nome}</td>
                            <td>
                              <div className="row-gap">
                                <Qtd value={it.qtd} label={`Quantidade de ${p.nome}`} onChange={(v) => mudarItem(it.key, { qtd: v })} />
                                {un.length > 1 ? (
                                  <select aria-label={`Unidade de ${p.nome}`} value={it.unidade} onChange={(e) => mudarItem(it.key, { unidade: e.target.value })}>
                                    {un.map((u) => (
                                      <option key={u} value={u}>
                                        {u}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="muted">{p.unidade}</span>
                                )}
                              </div>
                            </td>
                            <td className="num muted">
                              {formatBRL(p.venda)} / {p.unidade}
                            </td>
                            <td className="num">
                              <strong>{sub == null ? '—' : formatBRL(sub)}</strong>
                            </td>
                            <td className="c-actions">
                              <button type="button" className="icon-btn danger" aria-label={`Remover ${p.nome} do pedido`} onClick={() => atualizar((o) => ({ ...o, itens: o.itens.filter((i) => i.key !== it.key) }))}>
                                <Icon name="trash" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {linhas.length > validas.length && <Notice tone="warn">Há itens sem quantidade válida. Eles ficam de fora do total e do PDF até você preencher.</Notice>}
            </section>

            <section className="card" aria-labelledby="orc-pag">
              <h2 id="orc-pag">Pagamento</h2>
              <div className="form-grid">
                <Field label="Forma de pagamento">
                  {(id) => (
                    <select id={id} value={pag.id} onChange={(e) => atualizar((o) => ({ ...o, pagamento: e.target.value }))}>
                      {pagamentos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Desconto (opcional)">
                  {(id) => (
                    <div className="row-gap">
                      <select className="desc-tipo" aria-label="Tipo de desconto" value={r.desconto.tipo} onChange={(e) => atualizar((o) => ({ ...o, desconto: { tipo: e.target.value as Desconto['tipo'], valor: null } }))}>
                        <option value="valor">R$</option>
                        <option value="pct">%</option>
                      </select>
                      {r.desconto.tipo === 'valor' ? (
                        <MoneyInput id={id} value={r.desconto.valor} onChange={(v) => atualizar((o) => ({ ...o, desconto: { ...o.desconto, valor: v } }))} />
                      ) : (
                        <input
                          id={id}
                          inputMode="decimal"
                          placeholder="Ex.: 5"
                          autoComplete="off"
                          defaultValue={r.desconto.valor ?? ''}
                          onChange={(e) => {
                            const n = parseNumberBR(e.target.value);
                            atualizar((o) => ({ ...o, desconto: { ...o.desconto, valor: n != null && n >= 0 ? n : null } }));
                          }}
                        />
                      )}
                    </div>
                  )}
                </Field>
                <Field label="Observações do orçamento" className="span-2" hint="Prazo de entrega, validade, condições… aparece no PDF.">
                  {(id) => <textarea id={id} rows={3} value={r.obs} onChange={(e) => atualizar((o) => ({ ...o, obs: e.target.value }))} />}
                </Field>
              </div>
            </section>
          </div>

          <aside className="card orc-resumo" aria-label="Resumo do orçamento">
            <h2>Resumo</h2>
            <dl className="orc-linhas">
              <div>
                <dt>Subtotal</dt>
                <dd>{formatBRL(tot.subtotal)}</dd>
              </div>
              {tot.desconto > 0 && (
                <div>
                  <dt>Desconto</dt>
                  <dd>- {formatBRL(tot.desconto)}</dd>
                </div>
              )}
              <div className="orc-total">
                <dt>Total</dt>
                <dd>{formatBRL(tot.total)}</dd>
              </div>
            </dl>
            <p className="muted small">
              {pag.label}
              {pag.parcelas > 1 && tot.total > 0 ? `: ${pag.parcelas} parcelas de ${formatBRL(parcelas[0])}` : ''}
            </p>
            <Button icon="pdf" onClick={gerarPdf} disabled={semItens || gerando}>
              {gerando ? 'Gerando…' : 'Gerar PDF do orçamento'}
            </Button>
            {semItens && <small className="muted">Adicione ao menos um item com quantidade.</small>}
          </aside>
        </div>
      )}
    </>
  );
}
