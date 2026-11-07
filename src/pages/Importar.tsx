import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/store';
import { useDocumentTitle, useFeedback } from '../ui/feedback';
import { Button, Chip, Notice, PageHeader, downloadBlob } from '../ui/ui';
import { Icon } from '../ui/icons';
import { BASE_UNITS } from '../core/units';
import { decodeText, parseDelimited, type Rows } from '../import/text';
import { mergeExtras } from '../core/extras';
import { FIELD_LABELS, ambiguousColumns, buildDetection, detectHeaderRow, duplicateTargets, sheetScore } from '../import/detect';
import { extractRows } from '../import/extract';
import { DEFAULT_UPDATE_FIELDS, UPDATABLE_LABELS, applyPlan, buildPlan, type Classe, type Decision, type PlanRow, type UpdatableField, type UpdateFields } from '../import/plan';
import type { ConfigPayload, SheetData } from '../export/excel';
import type { ColumnTarget } from '../types';
import { XLSX_MIME } from '../export/useSave';

interface Loaded {
  nome: string;
  tipo: 'xlsx' | 'csv' | 'txt';
  sheets: SheetData[];
  config: ConfigPayload | null;
  separador?: string;
}

type Filtro = Classe | 'todos' | 'ignoradas';

const CLASSE_INFO: Record<Classe, { label: string; tone: 'ok' | 'info' | 'warn' | 'bad' | 'neutral' | 'accent' }> = {
  novo: { label: 'Novo', tone: 'ok' },
  existente: { label: 'Já existe', tone: 'neutral' },
  alterado: { label: 'Alterado', tone: 'info' },
  duplicado: { label: 'Possível duplicado', tone: 'warn' },
  incompleto: { label: 'Incompleto', tone: 'warn' },
  invalido: { label: 'Com erro', tone: 'bad' },
};

const TARGETS = Object.keys(FIELD_LABELS) as ColumnTarget[];

function cellText(v: unknown): string {
  return v == null ? '' : String(v);
}

export default function Importar() {
  useDocumentTitle('Importar arquivo');
  const { state, act } = useApp();
  const { toast, confirm } = useFeedback();
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [arq, setArq] = useState<Loaded | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerRow, setHeaderRow] = useState<number | null>(null);
  const [mapping, setMapping] = useState<ColumnTarget[]>([]);
  const [conferido, setConferido] = useState(false);
  const [defaultUnit, setDefaultUnit] = useState('un');
  const [fields, setFields] = useState<UpdateFields>(DEFAULT_UPDATE_FIELDS);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [limite, setLimite] = useState(150);
  const [restaurar, setRestaurar] = useState(false);
  const [feito, setFeito] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);

  const sheet = arq?.sheets[sheetIdx];
  const rows: Rows = sheet?.rows ?? [];

  function iniciarSheet(s: SheetData | undefined) {
    if (!s) return;
    const h = detectHeaderRow(s.rows);
    setHeaderRow(h);
    if (h != null) {
      const det = buildDetection(s.rows, h);
      setMapping(det.mapping);
      setDefaultUnit(det.unitHint ?? 'un');
    } else setMapping([]);
    setConferido(false);
  }

  async function carregar(file: File | undefined) {
    if (!file) return;
    setErro(null);
    setFeito(null);
    setBusy(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (file.size > 25 * 1024 * 1024) throw new Error('O arquivo é muito grande (mais de 25 MB). Divida a lista em partes menores.');
      const buf = await file.arrayBuffer();
      let loaded: Loaded;
      if (ext === 'xlsx' || ext === 'xlsm') {
        const { readWorkbook } = await import('../export/excel');
        const r = await readWorkbook(buf);
        if (r.sheets.length === 0) throw new Error('Não encontrei nenhuma aba com dados neste arquivo.');
        loaded = { nome: file.name, tipo: 'xlsx', sheets: r.sheets, config: r.config };
      } else if (ext === 'csv' || ext === 'txt' || ext === 'tsv') {
        const { rows: parsed, detected } = parseDelimited(decodeText(buf));
        loaded = { nome: file.name, tipo: ext === 'txt' ? 'txt' : 'csv', sheets: [{ nome: 'Arquivo', rows: parsed }], config: null, separador: detected.label };
      } else if (ext === 'xls') {
        throw new Error('O formato antigo .xls não é suportado. No Excel, use “Salvar como” e escolha .xlsx (ou CSV).');
      } else {
        throw new Error('Formato não suportado. Use arquivos .xlsx, .csv ou .txt.');
      }
      const best = loaded.sheets.map((s, i) => ({ i, score: sheetScore(s.rows) })).sort((a, b) => b.score - a.score)[0];
      setArq(loaded);
      setSheetIdx(best.i);
      iniciarSheet(loaded.sheets[best.i]);
      setFiltro('todos');
      setLimite(150);
      setRestaurar(!!loaded.config && state.intacto);
    } catch (e) {
      setArq(null);
      setErro(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
    } finally {
      setBusy(false);
    }
  }

  const headers = useMemo(() => (headerRow == null ? [] : rows[headerRow]?.map(cellText) ?? []), [rows, headerRow]);
  const ambiguas = useMemo(() => ambiguousColumns(headers, mapping), [headers, mapping]);
  const duplicados = useMemo(() => duplicateTargets(mapping), [mapping]);
  const temNome = mapping.includes('nome');

  const extraction = useMemo(() => (headerRow != null && temNome && duplicados.length === 0 ? extractRows(rows, headerRow, mapping) : null), [rows, headerRow, mapping, temNome, duplicados.length]);
  const plan = useMemo(() => (extraction ? buildPlan(extraction.linhas, state.lista.produtos, fields) : []), [extraction, state.lista.produtos, fields]);
  const ignoradas = useMemo(() => extraction?.linhas.filter((l) => l.status === 'ignorada') ?? [], [extraction]);

  // decisões padrão: só os NOVOS vêm marcados. Alterados e duplicados exigem escolha do usuário.
  useEffect(() => {
    const d: Record<number, Decision> = {};
    plan.forEach((r) => {
      d[r.linha] = { selecionada: r.classe === 'novo', acao: r.classe === 'alterado' ? 'update' : r.classe === 'duplicado' ? 'skip' : 'add' };
    });
    setDecisions(d);
  }, [plan]);

  const contagem = useMemo(() => {
    const c: Record<Classe, number> = { novo: 0, existente: 0, alterado: 0, duplicado: 0, incompleto: 0, invalido: 0 };
    plan.forEach((r) => c[r.classe]++);
    return c;
  }, [plan]);

  const escolhidas = plan.filter((r) => decisions[r.linha]?.selecionada && r.selecionavel && decisions[r.linha].acao !== 'skip');
  const nAdd = escolhidas.filter((r) => decisions[r.linha].acao === 'add').length;
  const nUpd = escolhidas.filter((r) => decisions[r.linha].acao === 'update').length;
  const precisaConferir = ambiguas.length > 0;
  const bloqueio = !temNome ? 'Indique qual coluna é o nome do produto.' : duplicados.length > 0 ? `Mais de uma coluna está ligada a “${FIELD_LABELS[duplicados[0]]}”.` : precisaConferir && !conferido ? 'Confirme que as colunas estão corretas.' : null;

  const visiveis = plan.filter((r) => (filtro === 'todos' ? true : filtro === 'ignoradas' ? false : r.classe === filtro));

  function setDec(linha: number, patch: Partial<Decision>) {
    setDecisions((d) => ({ ...d, [linha]: { ...d[linha], ...patch } }));
  }
  function marcar(classe: Classe | 'nenhum') {
    setDecisions((d) => {
      const n = { ...d };
      plan.forEach((r) => {
        if (!r.selecionavel) return;
        if (classe === 'nenhum') n[r.linha] = { ...n[r.linha], selecionada: false };
        else if (r.classe === classe) n[r.linha] = { selecionada: true, acao: classe === 'alterado' ? 'update' : 'add' };
      });
      return n;
    });
  }

  function reiniciar() {
    setArq(null);
    setErro(null);
    setPlanReset();
  }
  function setPlanReset() {
    setMapping([]);
    setHeaderRow(null);
    setDecisions({});
    setConferido(false);
  }

  async function aplicar() {
    if (bloqueio || escolhidas.length === 0) return;
    const ok = await confirm({
      titulo: 'Aplicar a importação?',
      mensagem: (
        <>
          <ul className="plain">
            <li>
              <strong>{nAdd}</strong> produto{nAdd === 1 ? '' : 's'} novo{nAdd === 1 ? '' : 's'} será{nAdd === 1 ? '' : 'ão'} adicionado{nAdd === 1 ? '' : 's'}
            </li>
            <li>
              <strong>{nUpd}</strong> produto{nUpd === 1 ? '' : 's'} existente{nUpd === 1 ? '' : 's'} será{nUpd === 1 ? '' : 'ão'} atualizado{nUpd === 1 ? '' : 's'} (só: {Object.entries(fields).filter(([, v]) => v).map(([k]) => UPDATABLE_LABELS[k as UpdatableField].toLowerCase()).join(', ') || 'nada'})
            </li>
          </ul>
          <p className="muted">Nenhum produto será excluído. Depois, você pode desfazer esta importação.</p>
          {restaurar && arq?.config && <p className="muted">Também serão restaurados os dados da loja, custos, taxas e margens do arquivo.</p>}
        </>
      ),
      confirmar: 'Aplicar importação',
    });
    if (!ok) return;
    const res = applyPlan(plan, decisions, state.lista.produtos, state.lista.categorias, fields, defaultUnit);
    act.importacao(restaurar && arq?.config?.extras ? mergeExtras(res.produtos, arq.config.extras) : res.produtos, res.categorias, res.registro);
    if (restaurar && arq?.config) act.restaurarConfig(arq.config.loja, arq.config.financeiro, arq.config.lista?.nome);
    setFeito(res.registro.resumo);
    toast(`Importação concluída: ${res.registro.resumo}.`);
    reiniciar();
  }

  async function modelo() {
    const { buildTemplate } = await import('../export/excel');
    downloadBlob(await buildTemplate(), 'modelo-lista-de-produtos.xlsx', XLSX_MIME);
  }

  const resumoTiles: { label: string; valor: number; tone?: string }[] = extraction
    ? [
        { label: 'Linhas analisadas', valor: extraction.linhasAnalisadas },
        { label: 'Produtos identificados', valor: plan.filter((r) => r.classe !== 'invalido').length },
        { label: 'Novos', valor: contagem.novo, tone: 'ok' },
        { label: 'Já existentes', valor: contagem.existente },
        { label: 'Com alterações', valor: contagem.alterado, tone: 'info' },
        { label: 'Possíveis duplicados', valor: contagem.duplicado, tone: 'warn' },
        { label: 'Linhas ignoradas', valor: ignoradas.length },
        { label: 'Com erros', valor: contagem.invalido + contagem.incompleto, tone: 'bad' },
      ]
    : [];

  return (
    <div className="page">
      <PageHeader
        titulo="Importar arquivo"
        subtitulo="Alimente a lista com Excel, CSV ou TXT: o seu arquivo salvo aqui, uma lista de fornecedor ou uma planilha sua. Você confere tudo antes de entrar."
        acoes={
          <Button variant="ghost" icon="download" onClick={modelo}>
            Baixar modelo de planilha
          </Button>
        }
      />

      {feito && !arq && (
        <Notice tone="ok">
          <div className="notice-row">
            <span>Importação concluída: {feito}. Nada foi excluído.</span>
            <span className="row-gap">
              <Button variant="ghost" icon="undo" onClick={() => { act.desfazerImportacao(); setFeito(null); toast('Importação desfeita.', 'info'); }}>
                Desfazer esta importação
              </Button>
              <Button variant="secondary" onClick={() => nav('/produtos')}>
                Ver produtos
              </Button>
            </span>
          </div>
        </Notice>
      )}
      {!feito && !arq && state.ultimaImportacao && (
        <Notice tone="info">
          <div className="notice-row">
            <span>Última importação: {state.ultimaImportacao.resumo}.</span>
            <Button variant="ghost" icon="undo" onClick={() => { act.desfazerImportacao(); toast('Importação desfeita.', 'info'); }}>
              Desfazer última importação
            </Button>
          </div>
        </Notice>
      )}

      {!arq && (
        <div
          className={`dropzone ${arrastando ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); carregar(e.dataTransfer.files?.[0]); }}
        >
          <Icon name="upload" size={30} />
          <h2>{busy ? 'Lendo o arquivo…' : 'Arraste o arquivo para cá'}</h2>
          <p className="muted">Aceita .xlsx, .csv e .txt (separado por ponto e vírgula, vírgula, tabulação ou barra).</p>
          <Button onClick={() => inputRef.current?.click()} disabled={busy} icon="file">
            Escolher arquivo
          </Button>
          <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.csv,.txt,.tsv" hidden onChange={(e) => { carregar(e.target.files?.[0]); e.target.value = ''; }} />
          <ul className="drop-notes">
            <li>Só a tabela de produtos entra. Título, logo, endereço, telefone, rodapé e totais são ignorados.</li>
            <li>Nada é excluído e nada é sobrescrito sem você marcar.</li>
            <li>Loja, custos, taxas, margens e cores não são alterados por uma importação.</li>
          </ul>
        </div>
      )}

      {erro && <Notice tone="bad">{erro}</Notice>}

      {arq && (
        <>
          <section className="card">
            <div className="card-head">
              <h2>
                1. Arquivo <small className="muted">{arq.nome}</small>
              </h2>
              <Button variant="ghost" onClick={reiniciar}>
                Cancelar importação
              </Button>
            </div>
            <div className="row-gap wrap">
              {arq.tipo === 'xlsx' && arq.sheets.length > 1 && (
                <label className="inline-label">
                  Aba
                  <select value={sheetIdx} onChange={(e) => { const i = Number(e.target.value); setSheetIdx(i); iniciarSheet(arq.sheets[i]); }}>
                    {arq.sheets.map((s, i) => (
                      <option key={s.nome} value={i}>
                        {s.nome}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {arq.separador && <Chip>Separador: {arq.separador}</Chip>}
              {headerRow != null && (
                <label className="inline-label">
                  Cabeçalho na linha
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, rows.length)}
                    value={headerRow + 1}
                    onChange={(e) => {
                      const h = Math.max(0, Math.min(rows.length - 1, Number(e.target.value) - 1));
                      setHeaderRow(h);
                      setMapping(buildDetection(rows, h).mapping);
                      setConferido(false);
                    }}
                    className="w-xs"
                  />
                </label>
              )}
            </div>
            {arq.config && (
              <label className="check config-box">
                <input type="checkbox" checked={restaurar} onChange={(e) => setRestaurar(e.target.checked)} />
                <span>
                  <strong>Este arquivo foi salvo por este sistema.</strong> Restaurar também os dados da loja, custos, taxas, margens e a logo salvos nele?
                  <small className="muted"> {state.intacto ? 'Marcado porque você ainda não alterou nada.' : 'Desmarcado para não mudar o que você já configurou.'}</small>
                </span>
              </label>
            )}
          </section>

          {headerRow == null ? (
            <Notice tone="bad">
              <strong>Não encontrei uma tabela de produtos neste arquivo.</strong> Procurei por colunas como Produto, Categoria, Custo, Preço de venda e Unidade. Se a tabela começa em outra linha, informe-a acima. Ou baixe o modelo de planilha e copie seus dados para ele. Nada foi importado.
            </Notice>
          ) : (
            <>
              <section className="card">
                <h2>2. Confira as colunas</h2>
                <p className="muted small">O sistema reconheceu estas colunas pelos cabeçalhos. Ajuste se algo estiver errado.</p>
                <div className="table-scroll">
                  <table className="table compact map-table">
                    <thead>
                      <tr>
                        <th>Coluna do arquivo</th>
                        <th>Exemplos</th>
                        <th>Usar como</th>
                      </tr>
                    </thead>
                    <tbody>
                      {headers.map((h, i) =>
                        !h && mapping[i] === 'ignorar' ? null : (
                          <tr key={i} className={ambiguas.includes(i) ? 'warn-row' : ''}>
                            <td className="strong">{h || <span className="muted">(sem título)</span>}</td>
                            <td className="muted ex">{rows.slice(headerRow + 1, headerRow + 4).map((r) => cellText(r[i])).filter(Boolean).join(' · ') || '—'}</td>
                            <td>
                              <select aria-label={`Usar a coluna ${h || i + 1} como`} value={mapping[i] ?? 'ignorar'} onChange={(e) => { const m = [...mapping]; m[i] = e.target.value as ColumnTarget; setMapping(m); setConferido(false); }}>
                                {TARGETS.map((t) => (
                                  <option key={t} value={t}>
                                    {FIELD_LABELS[t]}
                                  </option>
                                ))}
                              </select>
                              {ambiguas.includes(i) && <small className="warn-text">É preço de venda ou custo de compra?</small>}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
                {duplicados.length > 0 && <Notice tone="bad">Mais de uma coluna está ligada a “{FIELD_LABELS[duplicados[0]]}”. Deixe apenas uma.</Notice>}
                {!temNome && <Notice tone="bad">Indique qual coluna é o nome do produto.</Notice>}
                {precisaConferir && duplicados.length === 0 && temNome && (
                  <label className="check confirm-box">
                    <input type="checkbox" checked={conferido} onChange={(e) => setConferido(e.target.checked)} />
                    Conferi: a coluna destacada está ligada ao campo certo.
                  </label>
                )}
                <div className="form-grid cols-2">
                  {!mapping.includes('unidade') && (
                    <label className="field">
                      <span className="lbl">Unidade das linhas sem unidade</span>
                      <select value={defaultUnit} onChange={(e) => setDefaultUnit(e.target.value)}>
                        {[...new Set([defaultUnit, ...BASE_UNITS])].map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                      <span className="field-hint">O arquivo não tem coluna de unidade. Novos produtos entram com esta.</span>
                    </label>
                  )}
                </div>
              </section>

              {extraction && (
                <>
                  <section className="card">
                    <h2>3. Prévia do que foi encontrado</h2>
                    <div className="tiles">
                      {resumoTiles.map((t) => (
                        <div key={t.label} className={`tile ${t.tone ? 'tone-' + t.tone : ''}`}>
                          <strong>{t.valor}</strong>
                          <span>{t.label}</span>
                        </div>
                      ))}
                    </div>

                    <fieldset className="fields-box">
                      <legend>Ao atualizar produtos que já existem, incorporar:</legend>
                      <div className="row-gap wrap">
                        {(Object.keys(UPDATABLE_LABELS) as UpdatableField[]).map((k) => (
                          <label key={k} className="check">
                            <input type="checkbox" checked={fields[k]} onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.checked }))} />
                            {UPDATABLE_LABELS[k]}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <div className="filters" role="group" aria-label="Filtrar linhas">
                      {([
                        ['todos', `Todos (${plan.length})`],
                        ['novo', `Novos (${contagem.novo})`],
                        ['alterado', `Alterados (${contagem.alterado})`],
                        ['existente', `Já existem (${contagem.existente})`],
                        ['duplicado', `Duplicados (${contagem.duplicado})`],
                        ['incompleto', `Incompletos (${contagem.incompleto})`],
                        ['invalido', `Com erro (${contagem.invalido})`],
                        ['ignoradas', `Ignoradas (${ignoradas.length})`],
                      ] as [Filtro, string][]).map(([k, label]) => (
                        <button key={k} type="button" className={`filter ${filtro === k ? 'on' : ''}`} aria-pressed={filtro === k} onClick={() => { setFiltro(k); setLimite(150); }}>
                          {label}
                        </button>
                      ))}
                      <span className="spacer" />
                      <button type="button" className="mini" onClick={() => marcar('novo')}>
                        Marcar novos
                      </button>
                      <button type="button" className="mini" onClick={() => marcar('alterado')}>
                        Marcar alterados
                      </button>
                      <button type="button" className="mini" onClick={() => marcar('nenhum')}>
                        Desmarcar tudo
                      </button>
                    </div>

                    {filtro === 'ignoradas' ? (
                      <div className="table-scroll">
                        <table className="table compact">
                          <thead>
                            <tr>
                              <th>Linha</th>
                              <th>Conteúdo</th>
                              <th>Por que foi ignorada</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ignoradas.slice(0, limite).map((l) => (
                              <tr key={l.linha}>
                                <td>{l.linha}</td>
                                <td className="ex">{rows[l.linha - 1]?.map(cellText).filter(Boolean).join(' · ')}</td>
                                <td className="muted">{l.motivo}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : visiveis.length === 0 ? (
                      <p className="muted pad">Nenhuma linha neste filtro.</p>
                    ) : (
                      <div className="table-scroll">
                        <table className="table compact preview">
                          <thead>
                            <tr>
                              <th className="c-check">
                                <span className="sr-only">Importar</span>
                              </th>
                              <th>Linha</th>
                              <th>Situação</th>
                              <th>Produto</th>
                              <th>Categoria</th>
                              <th>Unid.</th>
                              <th className="num">Custo</th>
                              <th className="num">Venda</th>
                              <th>Detalhes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visiveis.slice(0, limite).map((r) => (
                              <PreviewRow key={r.linha} r={r} dec={decisions[r.linha]} setDec={setDec} defaultUnit={defaultUnit} />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {((filtro === 'ignoradas' ? ignoradas.length : visiveis.length) > limite) && (
                      <Button variant="ghost" onClick={() => setLimite((l) => l + 300)}>
                        Mostrar mais linhas
                      </Button>
                    )}
                  </section>

                  <div className="applybar">
                    <div>
                      <strong>
                        {nAdd} novo{nAdd === 1 ? '' : 's'} · {nUpd} {nUpd === 1 ? 'atualização' : 'atualizações'}
                      </strong>
                      <small className="muted">{bloqueio ?? 'Nada é excluído. Você poderá desfazer depois.'}</small>
                    </div>
                    <span className="row-gap">
                      <Button variant="ghost" onClick={reiniciar}>
                        Cancelar
                      </Button>
                      <Button icon="check" onClick={aplicar} disabled={!!bloqueio || escolhidas.length === 0}>
                        Aplicar importação
                      </Button>
                    </span>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function PreviewRow({ r, dec, setDec, defaultUnit }: { r: PlanRow; dec?: Decision; setDec: (linha: number, p: Partial<Decision>) => void; defaultUnit: string }) {
  const d = r.parsed.data;
  const info = CLASSE_INFO[r.classe];
  const dupAcao = r.classe === 'duplicado';
  return (
    <tr className={dec?.selecionada ? 'selected' : ''}>
      <td className="c-check">
        {r.selecionavel && !dupAcao ? (
          <input type="checkbox" aria-label={`Importar linha ${r.linha}`} checked={!!dec?.selecionada} onChange={(e) => setDec(r.linha, { selecionada: e.target.checked })} />
        ) : null}
      </td>
      <td className="muted">{r.linha}</td>
      <td>
        <Chip tone={info.tone}>{info.label}</Chip>
      </td>
      <td className="strong">{d?.nome ?? '—'}</td>
      <td>{d?.categoria || <span className="muted">—</span>}</td>
      <td className="muted">{d?.unidade ?? defaultUnit}</td>
      <td className="num">{d?.custo != null ? fmt(d.custo) : '—'}</td>
      <td className="num">{d?.venda != null ? fmt(d.venda) : '—'}</td>
      <td className="detail">
        {r.mudancas.length > 0 && (
          <ul className="changes">
            {r.mudancas.map((m) => (
              <li key={m.campo}>
                <span className="muted">{UPDATABLE_LABELS[m.campo]}:</span> {m.antes} → <strong>{m.depois}</strong>
              </li>
            ))}
          </ul>
        )}
        {r.detalhe && <span className={r.classe === 'invalido' ? 'bad-text' : 'muted'}>{r.detalhe}</span>}
        {dupAcao && (
          <select
            aria-label={`O que fazer com a linha ${r.linha}`}
            value={dec?.acao ?? 'skip'}
            onChange={(e) => setDec(r.linha, { acao: e.target.value as Decision['acao'], selecionada: e.target.value !== 'skip' })}
          >
            <option value="skip">Ignorar esta linha</option>
            <option value="add">Adicionar como produto novo</option>
            {r.alvo && <option value="update">Atualizar o produto existente</option>}
          </select>
        )}
      </td>
    </tr>
  );
}

function fmt(c: number): string {
  return `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
