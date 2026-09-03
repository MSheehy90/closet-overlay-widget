import {
  SLOT_ORDER,
  type LayerNudge,
  type OverlaySlot,
  type SlotId,
  cloneImageData,
} from '../types';

export type BaseStyle = 'realism' | 'chibi';
export type BaseView = 'front' | 'side' | 'back';
export type StageBg = 'checker' | 'dark';

export interface OverlayState {
  style: BaseStyle;
  view: BaseView;
  bg: StageBg;
  slots: OverlaySlot[];
}

/** Chibi is front-only — do not invent side/back. */
export function availableViews(style: BaseStyle): BaseView[] {
  if (style === 'chibi') return ['front'];
  return ['front', 'side', 'back'];
}

export function applyHairTint(
  hair: ImageData,
  tintColor: string | null,
  tintMap: ImageData | null,
): ImageData {
  if (!tintColor) return hair;
  const out = cloneImageData(hair);
  const hex = tintColor.replace('#', '');
  const tr = parseInt(hex.slice(0, 2), 16);
  const tg = parseInt(hex.slice(2, 4), 16);
  const tb = parseInt(hex.slice(4, 6), 16);

  for (let i = 0; i < out.data.length; i += 4) {
    const a = out.data[i + 3];
    if (a < 8) continue;
    let strength = 0.65;
    if (tintMap) {
      const mi = i;
      if (mi + 3 < tintMap.data.length) {
        // Luma of tint map controls strength
        const mr = tintMap.data[mi];
        const mg = tintMap.data[mi + 1];
        const mb = tintMap.data[mi + 2];
        const ma = tintMap.data[mi + 3];
        strength = ((mr + mg + mb) / (3 * 255)) * (ma / 255);
      }
    }
    const r = out.data[i];
    const g = out.data[i + 1];
    const b = out.data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // Preserve shading via luminosity multiply
    out.data[i] = Math.round(tr * (lum / 255) * strength + r * (1 - strength));
    out.data[i + 1] = Math.round(tg * (lum / 255) * strength + g * (1 - strength));
    out.data[i + 2] = Math.round(tb * (lum / 255) * strength + b * (1 - strength));
  }
  return out;
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: ImageData,
  nudge: LayerNudge,
  canvasW: number,
  canvasH: number,
): void {
  const tmp = document.createElement('canvas');
  tmp.width = layer.width;
  tmp.height = layer.height;
  tmp.getContext('2d')!.putImageData(layer, 0, 0);

  const scale = nudge.scale;
  const dw = layer.width * scale;
  const dh = layer.height * scale;
  const dx = (canvasW - dw) / 2 + nudge.x;
  const dy = (canvasH - dh) / 2 + nudge.y;
  ctx.drawImage(tmp, dx, dy, dw, dh);
}

function stageSize(slots: OverlaySlot[]): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const s of slots) {
    if (!s.image || !s.enabled) continue;
    w = Math.max(w, Math.ceil(s.image.width * s.nudge.scale));
    h = Math.max(h, Math.ceil(s.image.height * s.nudge.scale));
  }
  // Native res of largest layer; empty stage stays modest placeholder
  if (w === 0 || h === 0) return { w: 512, h: 768 };
  return { w, h };
}

function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number, bg: StageBg): void {
  if (bg === 'dark') {
    ctx.fillStyle = '#1a1410';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const size = 16;
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w; x += size) {
      const on = ((x / size) + (y / size)) % 2 === 0;
      ctx.fillStyle = on ? '#2a211c' : '#1a1410';
      ctx.fillRect(x, y, size, size);
    }
  }
}

export interface ComposeResult {
  stacked: ImageData;
  perLayer: { id: SlotId; label: string; image: ImageData }[];
  width: number;
  height: number;
}

/**
 * Stack slots in locked order. Empty slots stay empty — never invent clothes/hair/bodies.
 */
export function composeOverlay(state: OverlayState): ComposeResult {
  const { w, h } = stageSize(state.slots);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  paintBackground(ctx, w, h, state.bg);

  const perLayer: ComposeResult['perLayer'] = [];

  for (const id of SLOT_ORDER) {
    const slot = state.slots.find((s) => s.id === id);
    if (!slot || !slot.enabled || !slot.image) continue;

    let layer = slot.image;
    if (id === 'hair') {
      layer = applyHairTint(layer, slot.tintColor, slot.tintMap);
    }

    drawLayer(ctx, layer, slot.nudge, w, h);

    // Per-layer PNG: transparent bg, same placement
    const lc = document.createElement('canvas');
    lc.width = w;
    lc.height = h;
    const lctx = lc.getContext('2d')!;
    drawLayer(lctx, layer, slot.nudge, w, h);
    perLayer.push({ id, label: slot.label, image: lctx.getImageData(0, 0, w, h) });
  }

  return {
    stacked: ctx.getImageData(0, 0, w, h),
    perLayer,
    width: w,
    height: h,
  };
}

export function imageDataToPngBlob(img: ImageData): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

export async function downloadImageData(img: ImageData, filename: string): Promise<void> {
  const blob = await imageDataToPngBlob(img);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function fileToImageData(file: File): Promise<ImageData> {
  const url = URL.createObjectURL(file);
  try {
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return ctx.getImageData(0, 0, c.width, c.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function urlToImageData(url: string): Promise<ImageData> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}
