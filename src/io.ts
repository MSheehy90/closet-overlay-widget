/** Decode sheet (multi-frame strip) or single PNG into ImageData frames. */

export async function loadSheetOrPng(file: File): Promise<{ frames: ImageData[]; name: string }> {
  const bmp = await createImageBitmap(file);
  const w = bmp.width;
  const h = bmp.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const full = ctx.getImageData(0, 0, w, h);

  // Heuristic sheet split: if very wide and divisible into square-ish cells by gaps — NO.
  // Spec: never a grid. Sheets are loaded as a single canvas unless user picks a frame later.
  // We expose the whole image as one frame; multi-select via wrap split handles figures.
  return { frames: [full], name: file.name };
}

export function imageDataToCanvas(img: ImageData): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

export function canvasToDisplayUrl(img: ImageData): string {
  return imageDataToCanvas(img).toDataURL('image/png');
}
