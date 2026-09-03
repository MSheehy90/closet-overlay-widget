/** Shared image types for cleanup + overlay */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type WrapKind = 'figure' | 'hair' | 'arm' | 'green' | 'chrome' | 'unknown';

export interface Wrap {
  id: number;
  bbox: Rect;
  /** 1 = pixel belongs to this wrap's connected component */
  mask: Uint8Array;
  kind: WrapKind;
  pixelCount: number;
  isGreen: boolean;
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface CleanupResult {
  width: number;
  height: number;
  /** Full canvas after studio key + chrome strip (alpha out studio/chrome) */
  cleaned: ImageData;
  wraps: Wrap[];
  /** Per-wrap cropped exports (tight bbox + pad), keyed if green after align */
  exports: CleanupExport[];
  debugOverlay?: ImageData;
}

export interface CleanupExport {
  wrapId: number;
  kind: WrapKind;
  name: string;
  image: ImageData;
  bbox: Rect;
}

export interface BodyDest {
  /** Destination rect on the composition canvas (native body space) */
  rect: Rect;
  view: 'front' | 'side' | 'back';
  style: 'realism' | 'chibi';
}

export const SLOT_ORDER = [
  'body',
  'underwear',
  'shirt',
  'pants',
  'apron',
  'coat',
  'hair',
] as const;

export type SlotId = (typeof SLOT_ORDER)[number];

export interface LayerNudge {
  x: number;
  y: number;
  scale: number;
}

export interface OverlaySlot {
  id: SlotId;
  label: string;
  file: File | null;
  image: ImageData | null;
  nudge: LayerNudge;
  /** Optional hair tint map (grayscale or alpha map) */
  tintMap: ImageData | null;
  tintColor: string | null;
  enabled: boolean;
}

export function createEmptySlots(): OverlaySlot[] {
  const labels: Record<SlotId, string> = {
    body: 'Body',
    underwear: 'Underwear',
    shirt: 'Shirt',
    pants: 'Pants',
    apron: 'Apron',
    coat: 'Coat',
    hair: 'Hair',
  };
  return SLOT_ORDER.map((id) => ({
    id,
    label: labels[id],
    file: null,
    image: null,
    nudge: { x: 0, y: 0, scale: 1 },
    tintMap: null,
    tintColor: null,
    enabled: true,
  }));
}

export function cloneImageData(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
}

export function rectIntersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const btm = Math.min(a.y + a.h, b.y + b.h);
  if (r <= x || btm <= y) return null;
  return { x, y, w: r - x, h: btm - y };
}

export function padRect(r: Rect, pad: number, maxW: number, maxH: number): Rect {
  const x = Math.max(0, r.x - pad);
  const y = Math.max(0, r.y - pad);
  const right = Math.min(maxW, r.x + r.w + pad);
  const bottom = Math.min(maxH, r.y + r.h + pad);
  return { x, y, w: right - x, h: bottom - y };
}

export function colorDist2(a: Rgba, b: Rgba): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

export function idx(x: number, y: number, w: number): number {
  return (y * w + x) * 4;
}

export function getPixel(data: Uint8ClampedArray, x: number, y: number, w: number): Rgba {
  const i = idx(x, y, w);
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
}

export function setAlpha(data: Uint8ClampedArray, x: number, y: number, w: number, a: number): void {
  data[idx(x, y, w) + 3] = a;
}
