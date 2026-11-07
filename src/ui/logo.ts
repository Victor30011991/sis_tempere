import type { StoreInfo } from '../types';
import { urlToDataUrl } from '../export/palette';

export const DEFAULT_LOGO_URL = `${import.meta.env.BASE_URL}logo.jpg`;

export function logoSrc(loja: StoreInfo): string {
  return loja.logo ?? DEFAULT_LOGO_URL;
}

let cached: string | null = null;

/** A logo como data URL (necessário para embutir no PDF). */
export async function logoDataUrl(loja: StoreInfo): Promise<string | null> {
  if (loja.logo) return loja.logo;
  try {
    if (!cached) cached = await urlToDataUrl(DEFAULT_LOGO_URL);
    return cached;
  } catch {
    return null;
  }
}
