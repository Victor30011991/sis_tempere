import Decimal from 'decimal.js';

Decimal.set({ precision: 40 });

/** Regra única de arredondamento do sistema: meio para cima, em centavos. */
export function toCents(value: number | string | Decimal): number {
  return new Decimal(value).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function roundCents(value: Decimal): number {
  return value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** 123456 -> "1.234,56" */
export function formatPlain(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const int = Math.floor(abs / 100);
  const dec = String(abs % 100).padStart(2, '0');
  const intStr = String(int).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}${intStr},${dec}`;
}

/** 123456 -> "R$ 1.234,56" */
export function formatBRL(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `R$ ${formatPlain(cents)}`;
}

/** Percentual em pontos: 12.5 -> "12,5 %" */
export function formatPercent(points: number, maxDecimals = 2): string {
  const s = new Decimal(points).toDecimalPlaces(maxDecimals).toString().replace('.', ',');
  return `${s} %`;
}

/**
 * Interpreta números escritos à brasileira (e, com cuidado, à americana).
 * "35,00" "1.234,50" "R$ 35,00" "1,234.50" "35" -> number. Texto inválido -> null.
 */
export function parseNumberBR(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  let s = String(input).replace(/R\$|\s| /gi, '');
  if (!s) return null;
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  if (!/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let out: string;
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? ',' : '.';
    const thou = dec === ',' ? '.' : ',';
    out = s.split(thou).join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    out = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    if (parts.length > 2) out = parts.join('');
    else if (/^\d{3}$/.test(parts[1]) && /^[1-9]\d{0,2}$/.test(parts[0])) out = parts.join(''); // 1.234 = mil duzentos e trinta e quatro
    else out = s;
  } else {
    out = s;
  }
  const n = Number(out);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** Texto digitado em um campo de dinheiro -> centavos (ou null se vazio/inválido). */
export function parseMoney(input: unknown): number | null {
  const n = parseNumberBR(input);
  if (n == null) return null;
  return toCents(n);
}
