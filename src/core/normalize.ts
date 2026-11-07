/** Comparação de textos: ignora acentos, maiúsculas/minúsculas e espaços extras. */
export function norm(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function slug(value: string): string {
  return (
    norm(value)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'lista'
  );
}

export function newId(): string {
  const raw =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return 'P' + raw.slice(0, 12).toUpperCase();
}

export function newKey(): string {
  return Math.random().toString(36).slice(2, 10);
}
