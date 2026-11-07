import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { formatPlain, parseMoney, parseNumberBR } from '../core/money';
import { Icon } from './icons';

export function Button({
  variant = 'primary',
  icon,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'; icon?: string }) {
  return (
    <button type="button" className={`btn btn-${variant} ${className}`} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export function PageHeader({ titulo, subtitulo, acoes }: { titulo: string; subtitulo?: ReactNode; acoes?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{titulo}</h1>
        {subtitulo && <p className="muted">{subtitulo}</p>}
      </div>
      {acoes && <div className="page-actions">{acoes}</div>}
    </header>
  );
}

export function Field({ label, hint, erro, children, className = '' }: { label: string; hint?: ReactNode; erro?: string | null; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={`field ${erro ? 'has-error' : ''} ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {erro ? <span className="field-error">{erro}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

/** Campo de dinheiro: aceita "59,90", "1.234,50" e "R$ 59,90". Valor em centavos. */
export function MoneyInput({
  value,
  onChange,
  id,
  placeholder = '0,00',
  allowEmpty = true,
  ariaLabel,
  className = '',
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  id?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const [text, setText] = useState(value == null ? '' : formatPlain(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {
      setText(value == null ? '' : formatPlain(value));
      setInvalid(false);
    }
  }, [value]);
  return (
    <span className={`input-affix ${invalid ? 'invalid' : ''} ${className}`}>
      <span className="affix" aria-hidden="true">
        R$
      </span>
      <input
        id={id}
        aria-label={ariaLabel}
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        aria-invalid={invalid}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          if (t.trim() === '') {
            setInvalid(!allowEmpty);
            if (allowEmpty) onChange(null);
            return;
          }
          const c = parseMoney(t);
          if (c == null || c < 0) setInvalid(true);
          else {
            setInvalid(false);
            onChange(c);
          }
        }}
        onBlur={() => {
          focused.current = false;
          setText(value == null ? '' : formatPlain(value));
          setInvalid(false);
        }}
      />
    </span>
  );
}

/** Campo numérico/percentual em "pontos" (12,5 = 12,5%). */
export function NumberInput({
  value,
  onChange,
  id,
  suffix,
  min = 0,
  max,
  ariaLabel,
  className = '',
  integer = false,
}: {
  value: number;
  onChange: (v: number) => void;
  id?: string;
  suffix?: string;
  min?: number;
  max?: number;
  ariaLabel?: string;
  className?: string;
  integer?: boolean;
}) {
  const fmt = (n: number) => String(n).replace('.', ',');
  const [text, setText] = useState(fmt(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {
      setText(fmt(value));
      setInvalid(false);
    }
  }, [value]);
  return (
    <span className={`input-affix ${invalid ? 'invalid' : ''} ${className}`}>
      <input
        id={id}
        aria-label={ariaLabel}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        aria-invalid={invalid}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          const n = parseNumberBR(t);
          if (n == null || n < min || (max != null && n > max) || (integer && !Number.isInteger(n))) setInvalid(true);
          else {
            setInvalid(false);
            onChange(n);
          }
        }}
        onBlur={() => {
          focused.current = false;
          setText(fmt(value));
          setInvalid(false);
        }}
      />
      {suffix && (
        <span className="affix affix-right" aria-hidden="true">
          {suffix}
        </span>
      )}
    </span>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'modal-wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="modal-card">
          <div className="modal-head">
            <h2>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">
              <Icon name="x" />
            </button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function Tabs<T extends string>({ value, onChange, itens }: { value: T; onChange: (v: T) => void; itens: { id: T; label: string }[] }) {
  return (
    <div className="tabs" role="tablist">
      {itens.map((i) => (
        <button key={i.id} type="button" role="tab" aria-selected={value === i.id} className={`tab ${value === i.id ? 'on' : ''}`} onClick={() => onChange(i.id)}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'accent' }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function Empty({ icon = 'box', titulo, children, acoes }: { icon?: string; titulo: string; children?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={28} />
      </div>
      <h3>{titulo}</h3>
      {children && <p className="muted">{children}</p>}
      {acoes && <div className="empty-actions">{acoes}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'bad' ? 'alert' : undefined}>
      <Icon name={tone === 'ok' ? 'check' : tone === 'info' ? 'info' : 'alert'} />
      <div>{children}</div>
    </div>
  );
}

export function downloadBlob(data: ArrayBuffer | Blob, filename: string, type: string) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
