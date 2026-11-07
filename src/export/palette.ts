/** Cores predominantes de uma imagem (pixels RGBA), ignorando fundo claro, branco e preto. */
export function quantizePalette(pixels: Uint8ClampedArray | number[], max = 6): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];
    if (a < 200) continue;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    if (mn > 215) continue; // quase branco / fundo
    if (mx < 35) continue; // quase preto
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    if (mx > 215 && sat < 0.3) continue; // creme / bege claro do fundo
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    cur.n++;
    cur.r += r;
    cur.g += g;
    cur.b += b;
    buckets.set(key, cur);
  }
  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n).map((c) => [Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)] as const);
  const picked: (readonly [number, number, number])[] = [];
  for (const c of sorted) {
    if (picked.every((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) > 60)) picked.push(c);
    if (picked.length >= max) break;
  }
  return picked.map(([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase());
}

export async function paletteFromImage(src: string): Promise<string[]> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    img.src = src;
  });
  const size = 96;
  const canvas = document.createElement('canvas');
  const ratio = img.width / img.height;
  canvas.width = ratio >= 1 ? size : Math.round(size * ratio);
  canvas.height = ratio >= 1 ? Math.round(size / ratio) : size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return quantizePalette(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
}

/** Reduz a logo enviada (máx. 700 px) para o arquivo Excel não ficar pesado. */
export async function shrinkImage(file: File, maxSide = 700): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    fr.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Este arquivo não parece ser uma imagem válida.'));
    img.src = dataUrl;
  });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (scale === 1 && dataUrl.length < 400_000) return dataUrl;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const keepsAlpha = file.type === 'image/png' || file.type === 'image/svg+xml' || file.type === 'image/webp';
  return canvas.toDataURL(keepsAlpha ? 'image/png' : 'image/jpeg', 0.9);
}

export async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('Falha ao carregar a logo.'));
    fr.readAsDataURL(blob);
  });
}
