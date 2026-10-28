import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function approvedRabbitSource(): Uint8ClampedArray {
  const png = readFileSync(new URL('../../public/assets/rabbit.png', import.meta.url));
  if (png.readUInt32BE(16) !== 18 || png.readUInt32BE(20) !== 29 || png[24] !== 8 || png[25] !== 6) {
    throw new Error('Expected the approved 18 by 29 RGBA rabbit.');
  }
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const encoded = inflateSync(Buffer.concat(chunks));
  const pixels = new Uint8ClampedArray(18 * 29 * 4), stride = 18 * 4;
  for (let y = 0; y < 29; y++) {
    const filter = encoded[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const a = x >= 4 ? pixels[index - 4] : 0, b = y ? pixels[index - stride] : 0;
      const c = x >= 4 && y ? pixels[index - stride - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      if (predictor === undefined) throw new Error('Unsupported PNG row filter.');
      pixels[index] = (encoded[y * (stride + 1) + x + 1] + predictor) % 256;
    }
  }
  return pixels;
}
