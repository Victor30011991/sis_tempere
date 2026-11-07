import type { Colors } from '../types';

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
export function mix(a: string, b: string, amount: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return toHex([0, 1, 2].map((i) => x[i] * (1 - amount) + y[i] * amount) as [number, number, number]);
}
export function luminance(hex: string): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Cor de texto legível (clara ou escura) sobre o fundo informado. */
export function readableOn(bg: string): string {
  return contrast(bg, '#FFFFFF') >= contrast(bg, '#1F140F') ? '#FFFFFF' : '#1F140F';
}

export function isHex(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v);
}

/** Aplica as cores da loja como variáveis CSS em todo o sistema. */
export function applyTheme(c: Colors): void {
  const root = document.documentElement.style;
  const primary = isHex(c.primaria) ? c.primaria : '#B03818';
  const accent = isHex(c.destaque) ? c.destaque : '#64703A';
  const paper = isHex(c.fundo) ? c.fundo : '#EFDFC6';
  const primaryDark = mix(primary, '#000000', 0.38);
  root.setProperty('--primary', primary);
  root.setProperty('--on-primary', readableOn(primary));
  root.setProperty('--primary-dark', primaryDark);
  root.setProperty('--on-dark', readableOn(primaryDark));
  root.setProperty('--primary-soft', mix(primary, '#FFFFFF', 0.88));
  root.setProperty('--accent', accent);
  root.setProperty('--on-accent', readableOn(accent));
  root.setProperty('--accent-soft', mix(accent, '#FFFFFF', 0.86));
  root.setProperty('--paper', paper);
  root.setProperty('--bg', mix(paper, '#FFFFFF', 0.55));
  root.setProperty('--bg-2', mix(paper, '#FFFFFF', 0.25));
}
