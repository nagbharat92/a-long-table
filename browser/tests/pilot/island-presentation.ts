import type { Locator } from '@playwright/test';

/** Read the authoritative canvas, never the hidden CPU layout/reference canvas. */
export async function presentationImage(surface: Locator): Promise<string> {
  return surface.evaluate((node: HTMLCanvasElement) => {
    const gpu = node.closest('.island-ocean-scene')?.querySelector<HTMLCanvasElement>('.island-orbit-canvas');
    return (gpu && !gpu.hidden ? gpu : node).toDataURL();
  });
}

export async function presentationPixels(surface: Locator): Promise<number[]> {
  return surface.evaluate((node: HTMLCanvasElement) => {
    const gpu = node.closest('.island-ocean-scene')?.querySelector<HTMLCanvasElement>('.island-orbit-canvas');
    if (!gpu || gpu.hidden) return Array.from(node.getContext('2d')!.getImageData(0,0,node.width,node.height).data);
    const gl = gpu.getContext('webgl')!;
    const pixels = new Uint8Array(gpu.width*gpu.height*4);
    gl.readPixels(0,0,gpu.width,gpu.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    // Canvas readback is top-down; WebGL readback is bottom-up.
    const result = new Uint8Array(pixels.length), row = gpu.width*4;
    for (let y = 0; y < gpu.height; y++) result.set(pixels.subarray(y*row,(y+1)*row),(gpu.height-y-1)*row);
    return Array.from(result);
  });
}
