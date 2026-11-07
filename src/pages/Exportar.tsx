import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/store';
import { useDocumentTitle, useFeedback } from '../ui/feedback';
import { Button, Empty, Field, Notice, PageHeader, downloadBlob } from '../ui/ui';
import { SORT_LABELS, type SortMode } from '../core/sort';
import { formatQtyUnit } from '../core/units';
import { slug } from '../core/normalize';
import { logoDataUrl } from '../ui/logo';
import { useSaveExcel, XLSX_MIME } from '../export/useSave';
import type { PdfLayout, PdfOptions, PriceMode } from '../export/pdf';
import { suggestedCents } from '../core/pricing';

export default function Exportar({ aba }: { aba: 'pdf' | 'excel' }) {
  useDocumentTitle(aba === 'pdf' ? 'Gerar PDF' : 'Salvar em Excel');
  return (
    <div className="page">
      {aba === 'pdf' ? (
        <>
          <PageHeader titulo="Gerar PDF" subtitulo="Catálogo comercial para imprimir ou enviar no WhatsApp, ou ficha de inventário. No catálogo só aparecem preços de venda; custos e preço sugerido só entram se você marcar." />
          <PdfPanel />
        </>
      ) : (
        <>
          <PageHeader titulo="Salvar em Excel" subtitulo="O arquivo Excel é a sua base de dados. Salve, edite fora se quiser e carregue de volta em “Alimentar lista”." />
          <ExcelPanel />
        </>
      )}
    </div>
  );
}

function ExcelPanel() {
  const { state } = useApp();
  const save = useSaveExcel();
  const n = state.lista.produtos.length;
  async function modelo() {
    const { buildTemplate } = await import('../export/excel');
    downloadBlob(await buildTemplate(), 'modelo-lista-de-produtos.xlsx', XLSX_MIME);
  }
  return (
    <div className="two-col">
      <section className="card">
        <h2>Salvar a lista</h2>
        <p>
          Gera uma planilha formatada com <strong>{n}</strong> produto{n === 1 ? '' : 's'}: ID, produto, categoria, unidade, custo, custos adicionais, preço de venda, preço proporcional, observações, com moeda, filtros e cabeçalho fixo.
        </p>
        <Button icon="save" onClick={save} disabled={n === 0}>
          Salvar lista em Excel
        </Button>
        {n === 0 && <p className="muted small">Cadastre ou importe produtos primeiro.</p>}
        <hr />
        <p className="muted small">
          O arquivo também leva, em uma aba oculta, os dados da loja, a logo, custos, taxas e margens. Assim, ao carregá-lo de volta, você pode restaurar tudo.
        </p>
      </section>
      <section className="card">
        <h2>Editando fora do sistema</h2>
        <ul className="ticks">
          <li>
            Pode alterar <strong>preços, categorias, nomes e observações</strong> e adicionar linhas novas no final.
          </li>
          <li>
            <strong>Não apague a coluna ID.</strong> É ela que evita duplicar produtos ao carregar de volta.
          </li>
          <li>Produtos que você apagar da planilha <strong>não são excluídos</strong> do sistema ao importar.</li>
          <li>Ao importar, você vê o que mudou e escolhe o que aplicar.</li>
        </ul>
        <div className="row-gap wrap">
          <Link to="/importar" className="btn btn-secondary">
            Ir para importação
          </Link>
          <Button variant="ghost" icon="download" onClick={modelo}>
            Baixar planilha modelo em branco
          </Button>
        </div>
      </section>
    </div>
  );
}

function PdfPanel() {
  const { state } = useApp();
  const { toast } = useFeedback();
  const { loja, lista } = state;

  const [titulo, setTitulo] = useState(`Lista de preços ${new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`);
  const [modo, setModo] = useState<PriceMode>('ref');
  const [layout, setLayout] = useState<PdfLayout>('catalogo');
  const [mostrarPreco, setMostrarPreco] = useState(true);
  const [mostrarCusto, setMostrarCusto] = useState(false);
  const [mostrarSugerido, setMostrarSugerido] = useState(false);
  const [mostrarEstoque, setMostrarEstoque] = useState(false);
  const [ordem, setOrdem] = useState<SortMode>('az');
  const [mostrarCat, setMostrarCat] = useState(true);
  const [mostrarData, setMostrarData] = useState(true);
  const [rodape, setRodape] = useState('');
  const [flags, setFlags] = useState({ nome: true, razao: false, cnpj: false, endereco: !!loja.endereco, telefone: !!loja.telefone, informacoes: !!loja.informacoes });
  const [cats, setCats] = useState<Set<string> | null>(null); // null = todas
  const [url, setUrl] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const todasCats = useMemo(() => {
    const s = new Set(lista.produtos.map((p) => p.categoria));
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [lista.produtos]);

  const produtos = useMemo(() => lista.produtos.filter((p) => cats == null || cats.has(p.categoria)), [lista.produtos, cats]);
  const comPreco = produtos.filter((p) => p.venda != null);
  const soPrecificados = layout === 'catalogo' && mostrarPreco;
  const semPreco = soPrecificados ? produtos.length - comPreco.length : 0;
  const exibidos = soPrecificados ? comPreco : produtos;
  const sugeridos = useMemo(() => Object.fromEntries(lista.produtos.map((p) => [p.id, suggestedCents(p, state.config)])), [lista.produtos, state.config]);

  function escolherLayout(l: PdfLayout) {
    setLayout(l);
    // catálogo = limpo, só preços; inventário = com custo, sugerido e estoque (dá para ajustar depois)
    setMostrarPreco(true);
    setMostrarCusto(l === 'inventario');
    setMostrarSugerido(l === 'inventario');
    setMostrarEstoque(l === 'inventario');
  }

  // rótulos das opções acompanham a unidade dos produtos (não só kg)
  const unidades = [...new Set(comPreco.map((p) => p.unidade))];
  const bases = [...new Set(comPreco.filter((p) => p.propQtd && p.propUnidade).map((p) => formatQtyUnit(p.propQtd!, p.propUnidade!)))];
  const rotRef = unidades.length === 1 ? `por ${unidades[0]}` : 'por unidade de venda';
  const rotProp = bases.length === 1 ? `por ${bases[0]}` : bases.length === 0 ? 'proporcional' : 'proporcional (100 g, 100 ml…)';

  const opts: PdfOptions = useMemo(
    () => ({ titulo, modoPreco: modo, ordem, mostrarCategoria: mostrarCat, loja: flags, rodape, mostrarData, layout, mostrarPreco, mostrarCusto, mostrarSugerido, mostrarEstoque, sugeridos }),
    [titulo, modo, ordem, mostrarCat, flags, rodape, mostrarData, layout, mostrarPreco, mostrarCusto, mostrarSugerido, mostrarEstoque, sugeridos],
  );

  async function gerar(): Promise<ArrayBuffer> {
    const { buildPdf } = await import('../export/pdf');
    return buildPdf(produtos, loja, await logoDataUrl(loja), opts);
  }

  useEffect(() => {
    if (exibidos.length === 0) {
      setUrl(null);
      return;
    }
    let vivo = true;
    let novo: string | null = null;
    const t = window.setTimeout(async () => {
      setGerando(true);
      try {
        const buf = await gerar();
        if (!vivo) return;
        novo = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
        setUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return novo;
        });
        setErro(null);
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : 'Falha ao gerar o PDF.');
      } finally {
        if (vivo) setGerando(false);
      }
    }, 350);
    return () => {
      vivo = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtos, loja, opts]);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function baixar() {
    try {
      downloadBlob(await gerar(), `${slug(titulo)}.pdf`, 'application/pdf');
      toast('PDF gerado.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Falha ao gerar o PDF.', 'erro');
    }
  }

  if (lista.produtos.length === 0)
    return (
      <Empty titulo="Sem produtos para o PDF" icon="pdf" acoes={<Link to="/produtos" className="btn btn-primary">Ir para Produtos</Link>}>
        Cadastre ou importe produtos com preço de venda.
      </Empty>
    );

  return (
    <div className="pdf-layout">
      <section className="card pdf-form">
        <h2>Configuração</h2>
        <Field label="Título da lista">{(id) => <input id={id} value={titulo} onChange={(e) => setTitulo(e.target.value)} />}</Field>

        <fieldset className="opt-group">
          <legend>Tipo de relatório</legend>
          {([
            ['catalogo', 'Catálogo comercial (limpo, só para o cliente)'],
            ['inventario', 'Ficha de inventário (uso interno: custo, sugerido e estoque)'],
          ] as [PdfLayout, string][]).map(([k, l]) => (
            <label key={k} className="radio simple">
              <input type="radio" name="layout" checked={layout === k} onChange={() => escolherLayout(k)} />
              {l}
            </label>
          ))}
          <label className="check">
            <input type="checkbox" checked={mostrarPreco} onChange={(e) => setMostrarPreco(e.target.checked)} />
            Mostrar preço de venda
          </label>
          <label className="check">
            <input type="checkbox" checked={mostrarSugerido} onChange={(e) => setMostrarSugerido(e.target.checked)} />
            Mostrar preço sugerido
          </label>
          <label className="check">
            <input type="checkbox" checked={mostrarCusto} onChange={(e) => setMostrarCusto(e.target.checked)} />
            Mostrar custo de aquisição
          </label>
          <label className="check">
            <input type="checkbox" checked={mostrarEstoque} onChange={(e) => setMostrarEstoque(e.target.checked)} />
            Mostrar estoque
          </label>
          {layout === 'catalogo' && (mostrarCusto || mostrarSugerido) && <Notice tone="warn">Custo e preço sugerido são dados internos. Desmarque antes de enviar o catálogo ao cliente.</Notice>}
        </fieldset>

        {mostrarPreco && (
        <fieldset className="opt-group">
          <legend>Preços exibidos</legend>
          {([
            ['ref', `Somente preço ${rotRef}`],
            ['prop', `Somente preço ${rotProp}`],
            ['ambos', 'Ambos os preços'],
          ] as [PriceMode, string][]).map(([k, l]) => (
            <label key={k} className="radio simple">
              <input type="radio" name="modo" checked={modo === k} onChange={() => setModo(k)} />
              {l}
            </label>
          ))}
          {modo !== 'ref' && bases.length === 0 && <small className="muted">Nenhum produto tem preço proporcional cadastrado: será usado o preço da unidade.</small>}
        </fieldset>
        )}

        <Field label="Organização">
          {(id) => (
            <select id={id} value={ordem} onChange={(e) => setOrdem(e.target.value as SortMode)}>
              {(Object.keys(SORT_LABELS) as SortMode[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
          )}
        </Field>

        <fieldset className="opt-group">
          <legend>Informações da loja no cabeçalho</legend>
          {([
            ['nome', 'Nome fantasia', true],
            ['razao', 'Razão social', !!loja.razaoSocial],
            ['cnpj', 'CNPJ', !!loja.cnpj],
            ['endereco', 'Endereço', !!loja.endereco],
            ['telefone', 'Telefone / WhatsApp', !!loja.telefone],
            ['informacoes', 'Informações adicionais', !!loja.informacoes],
          ] as [keyof typeof flags, string, boolean][]).map(([k, l, has]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={flags[k]} onChange={(e) => setFlags((f) => ({ ...f, [k]: e.target.checked }))} />
              {l}
              {!has && <small className="muted"> (vazio em “Minha loja”)</small>}
            </label>
          ))}
        </fieldset>

        <fieldset className="opt-group">
          <legend>Outros</legend>
          {ordem !== 'categoria' && (
            <label className="check">
              <input type="checkbox" checked={mostrarCat} onChange={(e) => setMostrarCat(e.target.checked)} />
              Coluna de categoria
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={mostrarData} onChange={(e) => setMostrarData(e.target.checked)} />
            Data de atualização
          </label>
        </fieldset>
        <Field label="Texto no rodapé (opcional)" hint="Ex.: Preços sujeitos a alteração.">
          {(id) => <input id={id} value={rodape} maxLength={110} onChange={(e) => setRodape(e.target.value)} />}
        </Field>

        {todasCats.length > 1 && (
          <fieldset className="opt-group">
            <legend>Categorias incluídas</legend>
            <div className="cat-checks">
              {todasCats.map((c) => (
                <label key={c || '_'} className="check">
                  <input
                    type="checkbox"
                    checked={cats == null || cats.has(c)}
                    onChange={(e) =>
                      setCats((cur) => {
                        const base = new Set(cur ?? todasCats);
                        e.target.checked ? base.add(c) : base.delete(c);
                        return base.size === todasCats.length ? null : base;
                      })
                    }
                  />
                  {c || 'Sem categoria'}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {semPreco > 0 && <Notice tone="warn">{semPreco} produto{semPreco === 1 ? '' : 's'} sem preço de venda não aparece{semPreco === 1 ? '' : 'm'} no PDF.</Notice>}
        <Button icon="download" onClick={baixar} disabled={exibidos.length === 0}>
          Baixar PDF
        </Button>
      </section>

      <section className="card pdf-preview">
        <div className="card-head">
          <h2>Pré-visualização</h2>
          <span className="muted small">{gerando ? 'Atualizando…' : `${exibidos.length} produtos`}</span>
        </div>
        {erro && <Notice tone="bad">{erro}</Notice>}
        {exibidos.length === 0 ? (
          <Empty titulo="Nenhum produto com preço de venda" icon="pdf">
            Defina o preço de venda na tela Produtos ou use a Precificação.
          </Empty>
        ) : url ? (
          <>
            <iframe title="Pré-visualização do PDF" src={`${url}#toolbar=0&navpanes=0`} />
            <p className="muted small">Se a pré-visualização não aparecer no seu aparelho, use “Baixar PDF”.</p>
          </>
        ) : (
          <p className="muted pad">Gerando…</p>
        )}
      </section>
    </div>
  );
}
