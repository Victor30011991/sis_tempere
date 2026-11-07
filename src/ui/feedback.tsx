import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal } from './ui';
import { Icon } from './icons';

type Tone = 'ok' | 'erro' | 'info';
interface Toast {
  id: number;
  msg: string;
  tone: Tone;
}
interface ConfirmOpts {
  titulo: string;
  mensagem: ReactNode;
  confirmar?: string;
  perigo?: boolean;
}

interface FeedbackCtx {
  toast: (msg: string, tone?: Tone) => void;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
}

const Ctx = createContext<FeedbackCtx | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ask, setAsk] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const seq = useRef(0);

  const toast = useCallback((msg: string, tone: Tone = 'ok') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, msg, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'erro' ? 7000 : 4200);
  }, []);

  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setAsk({ ...o, resolve })), []);

  const close = (v: boolean) => {
    ask?.resolve(v);
    setAsk(null);
  };

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <Icon name={t.tone === 'erro' ? 'alert' : t.tone === 'info' ? 'info' : 'check'} />
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
      <Modal
        open={!!ask}
        title={ask?.titulo ?? ''}
        onClose={() => close(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => close(false)}>
              Cancelar
            </button>
            <button type="button" className={`btn ${ask?.perigo ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>
              {ask?.confirmar ?? 'Confirmar'}
            </button>
          </>
        }
      >
        <div className="confirm-body">{ask?.mensagem}</div>
      </Modal>
    </Ctx.Provider>
  );
}

export function useFeedback() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useFeedback fora do FeedbackProvider');
  return c;
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Precificação`;
  }, [title]);
}
