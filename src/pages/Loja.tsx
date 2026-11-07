import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store';
import { useDocumentTitle, useFeedback } from '../ui/feedback';
import { Button, Field, Notice, PageHeader } from '../ui/ui';
import { logoSrc } from '../ui/logo';
import { paletteFromImage, shrinkImage } from '../export/palette';
import { LOGO_COLORS } from '../core/defaults';
import { isHex } from '../ui/theme';
import type { Colors } from '../types';

const COLOR_FIELDS: { k: keyof Colors; label: string; hint: string }[] = [
  { k: 'primaria', label: 'Cor principal', hint: 'Botões, cabeçalho da tabela no PDF e Excel.' },
  { k: 'destaque', label: 'Cor de destaque', hint: 'Detalhes e títulos de categoria.' },
  { k: 'fundo', label: 'Cor de fundo', hint: 'Faixa do cabeçalho do PDF (combine com o fundo da logo).' },
];

export default function Loja() {
  useDocumentTitle('Minha loja');
  const { state, act } = useApp();
  const { toast } = useFeedback();
  const { loja } = state;
  const [paleta, setPaleta] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const src = logoSrc(loja);

  useEffect(() => {
    let vivo = true;
    paletteFromImage(src)
      .then((p) => vivo && setPaleta(p))
      .catch(() => vivo && setPaleta([]));
    return () => {
      vivo = false;
    };
  }, [src]);

  async function enviar(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Escolha um arquivo de imagem (PNG, JPG, WebP).', 'erro');
    try {
      const url = await shrinkImage(file);
      act.loja({ logo: url });
      toast('Logomarca atualizada. Veja as cores sugeridas abaixo.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Não foi possível ler a imagem.', 'erro');
    }
  }

  const setCor = (k: keyof Colors, v: string) => act.loja({ cores: { ...loja.cores, [k]: v } });
  const text = (k: 'nomeFantasia' | 'razaoSocial' | 'cnpj' | 'endereco' | 'telefone' | 'informacoes') => ({
    value: loja[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => act.loja({ [k]: e.target.value }),
  });

  return (
    <div className="page">
      <PageHeader titulo="Minha loja" subtitulo="Estes dados identificam a sua loja nos documentos comerciais (PDF) e definem as cores do sistema." />

      <div className="two-col">
        <section className="card">
          <h2>Identificação</h2>
          <div className="form-grid">
            <Field label="Nome fantasia" className="span-2">
              {(id) => <input id={id} {...text('nomeFantasia')} />}
            </Field>
            <Field label="Razão social (opcional)">{(id) => <input id={id} {...text('razaoSocial')} />}</Field>
            <Field label="CNPJ (opcional)">{(id) => <input id={id} {...text('cnpj')} inputMode="numeric" placeholder="00.000.000/0000-00" />}</Field>
            <Field label="Endereço (opcional)" className="span-2">
              {(id) => <input id={id} {...text('endereco')} />}
            </Field>
            <Field label="Telefone / WhatsApp (opcional)">{(id) => <input id={id} {...text('telefone')} inputMode="tel" />}</Field>
            <Field label="Informações adicionais (opcional)" hint="Ex.: slogan, horário, site, Instagram.">
              {(id) => <input id={id} {...text('informacoes')} />}
            </Field>
          </div>
          <p className="muted small">Na hora de gerar o PDF você escolhe quais destas informações aparecem.</p>
        </section>

        <section className="card">
          <h2>Logomarca</h2>
          <div className="logo-preview">
            <img src={src} alt={`Logomarca de ${loja.nomeFantasia}`} />
          </div>
          <div className="row-gap">
            <Button variant="secondary" icon="upload" onClick={() => fileRef.current?.click()}>
              Enviar outra logomarca
            </Button>
            {loja.logo && (
              <Button variant="ghost" onClick={() => act.loja({ logo: null })}>
                Voltar à logo Temperei
              </Button>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { enviar(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <small className="muted">A logo enviada fica guardada dentro do arquivo Excel que você salvar, então basta enviá-la uma vez por lista.</small>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Cores</h2>
          <Button variant="ghost" onClick={() => act.loja({ cores: { ...LOGO_COLORS } })}>
            Restaurar cores da logo Temperei
          </Button>
        </div>
        <div className="color-grid">
          {COLOR_FIELDS.map((c) => (
            <Field key={c.k} label={c.label} hint={c.hint}>
              {(id) => (
                <div className="color-row">
                  <input id={id} type="color" value={isHex(loja.cores[c.k]) ? loja.cores[c.k] : '#000000'} onChange={(e) => setCor(c.k, e.target.value.toUpperCase())} aria-label={c.label} />
                  <input
                    aria-label={`${c.label} em código`}
                    value={loja.cores[c.k]}
                    maxLength={7}
                    onChange={(e) => {
                      const v = e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value;
                      setCor(c.k, v.toUpperCase());
                    }}
                    className="mono"
                  />
                </div>
              )}
            </Field>
          ))}
        </div>
        {paleta.length > 0 && (
          <div className="palette">
            <span className="muted">Cores encontradas na logo (clique para usar):</span>
            <div className="palette-list">
              {paleta.map((hex) => (
                <span key={hex} className="swatch-group">
                  <span className="swatch" style={{ background: hex }} aria-hidden="true" />
                  <code>{hex}</code>
                  <button type="button" className="mini" onClick={() => setCor('primaria', hex)}>
                    principal
                  </button>
                  <button type="button" className="mini" onClick={() => setCor('destaque', hex)}>
                    destaque
                  </button>
                  <button type="button" className="mini" onClick={() => setCor('fundo', hex)}>
                    fundo
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        <Notice tone="info">As cores mudam na hora, em todo o sistema. Textos de botões e cabeçalhos escolhem sozinhos branco ou escuro para manter a leitura.</Notice>
      </section>
    </div>
  );
}
