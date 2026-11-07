import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../state/store';
import { useFeedback, useDocumentTitle } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { logoSrc } from '../ui/logo';

export default function Home() {
  useDocumentTitle('Início');
  const { state, act } = useApp();
  const { confirm } = useFeedback();
  const nav = useNavigate();
  const total = state.lista.produtos.length;

  async function novaLista() {
    if (state.sujo && total > 0) {
      const ok = await confirm({
        titulo: 'Começar uma lista nova?',
        mensagem: (
          <>
            <p>
              A lista atual (<strong>{state.lista.nome}</strong>, {total} produtos) tem alterações que ainda não foram salvas em Excel. Ao começar uma lista nova elas serão descartadas.
            </p>
            <p className="muted">Seus dados da loja, custos, taxas e margens continuam como estão.</p>
          </>
        ),
        confirmar: 'Descartar e começar nova',
        perigo: true,
      });
      if (!ok) return;
    }
    act.novaLista();
    nav('/produtos');
  }

  return (
    <div className="page home">
      <section className="hero">
        <div className="hero-text">
          <span className="eyebrow">Sistema de precificação</span>
          <h1>Sua lista de preços, do custo ao PDF.</h1>
          <p>
            Cadastre produtos, calcule o preço certo com margem, custos e taxas, e gere uma lista pronta para imprimir ou mandar no WhatsApp. Tudo funciona aqui no navegador, sem cadastro e sem mensalidade.
          </p>
        </div>
        <div className="hero-logo">
          <img src={logoSrc(state.loja)} alt={`Logomarca ${state.loja.nomeFantasia}`} />
        </div>
      </section>

      <section className="choices" aria-label="Como você quer começar?">
        <article className="choice">
          <div className="choice-top">
            <span className="choice-icon">
              <Icon name="plus" size={26} />
            </span>
            <span className="eyebrow">Opção 1</span>
          </div>
          <h2>Nova lista</h2>
          <p>Comece do zero: cadastre os produtos na mão, crie categorias, defina os preços e gere o PDF.</p>
          <ul className="ticks">
            <li>Cadastro manual de produtos</li>
            <li>Importar arquivo Excel, CSV ou TXT</li>
            <li>Gerar PDF e salvar em Excel</li>
          </ul>
          <button type="button" className="btn btn-primary btn-lg" onClick={novaLista}>
            Começar lista nova <Icon name="chevron" />
          </button>
        </article>

        <article className="choice">
          <div className="choice-top">
            <span className="choice-icon choice-icon-accent">
              <Icon name="upload" size={26} />
            </span>
            <span className="eyebrow">Opção 2</span>
          </div>
          <h2>Alimentar lista</h2>
          <p>Continue de onde parou com o Excel que você salvou, ou traga uma lista de fornecedor. Você confere tudo antes de entrar.</p>
          <ul className="ticks">
            <li>Adiciona novos e atualiza preços</li>
            <li>Avisa sobre duplicados e erros</li>
            <li>Nunca exclui nem sobrescreve sem você escolher</li>
          </ul>
          <Link to="/importar" className="btn btn-accent btn-lg">
            Escolher arquivo <Icon name="chevron" />
          </Link>
        </article>
      </section>

      {total > 0 && (
        <p className="resume">
          Lista aberta: <strong>{state.lista.nome}</strong> · {total} produto{total === 1 ? '' : 's'} ·{' '}
          <Link to="/produtos">continuar editando</Link>
        </p>
      )}

      <section className="howto">
        <div>
          <h2>Como seus dados são guardados</h2>
          <p className="muted">
            O seu arquivo Excel é a base de dados. <strong>Nada fica guardado no navegador</strong>: se você fechar ou atualizar a página sem salvar, as alterações se perdem (o sistema avisa antes).
          </p>
        </div>
        <ol className="steps">
          <li>
            <span>1</span>
            <div>
              <strong>Monte a lista</strong>
              <small>Cadastre, importe e ajuste os preços.</small>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>Salve em Excel</strong>
              <small>Guarde o arquivo onde quiser: computador, e-mail, nuvem.</small>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>Volte quando quiser</strong>
              <small>Carregue o arquivo em “Alimentar lista” e siga em frente.</small>
            </div>
          </li>
        </ol>
      </section>
    </div>
  );
}
