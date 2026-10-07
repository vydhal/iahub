import sharp from 'sharp';

/**
 * Extrai as cores dominantes de uma imagem (logo) — mesmo princípio usado por ferramentas de brand
 * kit de mercado (upload da logo → paleta sugerida automaticamente). Sem dependência de serviço
 * externo: reamostra a imagem, quantiza os pixels em baldes de cor e devolve os mais frequentes,
 * descartando fundo quase-branco/transparente e garantindo distância mínima entre as cores escolhidas
 * (evita devolver 5 tons quase idênticos).
 */
export async function extractPalette(buffer: Buffer, count = 5): Promise<string[]> {
  const SIZE = 64;
  const { data, info } = await sharp(buffer)
    .resize(SIZE, SIZE, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels; // 4 (RGBA) após ensureAlpha
  const BUCKET = 24; // tamanho do balde de quantização por canal (0-255 → ~11 baldes)
  const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = channels === 4 ? data[i + 3] : 255;
    if (a < 128) continue; // pixel transparente (fundo do PNG da logo)
    if (r > 245 && g > 245 && b > 245) continue; // fundo branco do canvas da logo

    const key = `${Math.round(r / BUCKET)}_${Math.round(g / BUCKET)}_${Math.round(b / BUCKET)}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.n += 1;
    } else {
      buckets.set(key, { r, g, b, n: 1 });
    }
  }

  const sorted = [...buckets.values()]
    .map((b) => ({ r: Math.round(b.r / b.n), g: Math.round(b.g / b.n), b: Math.round(b.b / b.n), n: b.n }))
    .sort((a, b) => b.n - a.n);

  const palette: { r: number; g: number; b: number }[] = [];
  const minDistance = 40; // distância euclidiana mínima entre cores selecionadas
  for (const c of sorted) {
    if (palette.length >= count) break;
    const farEnough = palette.every((p) => Math.hypot(p.r - c.r, p.g - c.g, p.b - c.b) >= minDistance);
    if (farEnough) palette.push(c);
  }

  return palette.map((c) => `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase());
}
