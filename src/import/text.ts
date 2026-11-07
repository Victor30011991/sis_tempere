import Papa from 'papaparse';

export type Cell = string | number | null;
export type Rows = Cell[][];

/** UTF-8 quando possível; senão Windows-1252 (arquivos "ANSI" de fornecedores brasileiros). */
export function decodeText(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const CANDIDATES: { id: string; label: string }[] = [
  { id: ';', label: 'ponto e vírgula' },
  { id: '\t', label: 'tabulação' },
  { id: '|', label: 'barra vertical' },
  { id: ',', label: 'vírgula' },
];

function countOutsideQuotes(line: string, ch: string): number {
  let inQ = false;
  let n = 0;
  for (const c of line) {
    if (c === '"') inQ = !inQ;
    else if (c === ch && !inQ) n++;
  }
  return n;
}

export interface Detected {
  delimiter: string; // 'multi' = 2+ espaços
  label: string;
}

export function detectDelimiter(text: string): Detected {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 40);
  let best: Detected | null = null;
  let bestScore = 0;
  let bestFrac = 0;
  for (const cand of CANDIDATES) {
    const counts = lines.map((l) => countOutsideQuotes(l, cand.id));
    const freq = new Map<number, number>();
    counts.forEach((c) => c > 0 && freq.set(c, (freq.get(c) ?? 0) + 1));
    let modeCount = 0;
    let modeFreq = 0;
    freq.forEach((f, c) => {
      if (f > modeFreq || (f === modeFreq && c > modeCount)) {
        modeFreq = f;
        modeCount = c;
      }
    });
    const score = lines.length ? (modeFreq / lines.length) * Math.min(modeCount, 3) : 0;
    if (score > bestScore + 1e-9) {
      bestScore = score;
      bestFrac = lines.length ? modeFreq / lines.length : 0;
      best = { delimiter: cand.id, label: cand.label };
    }
  }
  // tabelas alinhadas com espaços (colunas separadas por 2 ou mais espaços)
  const multiFrac = lines.length ? lines.filter((l) => /\S\s{2,}\S/.test(l)).length / lines.length : 0;
  if (multiFrac >= 0.6 && multiFrac > bestFrac + 0.1) return { delimiter: 'multi', label: 'espaços' };
  if (best && bestScore >= 0.5) return best;
  return best ?? { delimiter: ';', label: 'ponto e vírgula' };
}

export function parseDelimited(text: string): { rows: Rows; detected: Detected } {
  const detected = detectDelimiter(text);
  let rows: Rows;
  if (detected.delimiter === 'multi') {
    rows = text.split(/\r?\n/).map((l) => (l.trim() === '' ? [] : l.trim().split(/\s{2,}/)));
  } else {
    const res = Papa.parse<string[]>(text, { delimiter: detected.delimiter, skipEmptyLines: false });
    rows = res.data.map((r) => r.map((c) => (c == null ? null : String(c))));
  }
  return { rows: rows.map((r) => r.map((c) => (typeof c === 'string' && c.trim() === '' ? null : c))), detected };
}
