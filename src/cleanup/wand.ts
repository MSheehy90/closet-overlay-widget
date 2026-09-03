import {
  type Rect,
  type Rgba,
  type Wrap,
  type WrapKind,
  colorDist2,
  getPixel,
  idx,
  padRect,
} from '../types';

const STUDIO_TOL2 = 42 * 42; // flood tolerance vs edge-sampled studio
const GREEN_HUE_MIN = 70;
const GREEN_HUE_MAX = 160;
const GREEN_SAT_MIN = 0.22;
const GREEN_VAL_MIN = 0.18;
const MIN_WRAP_PIXELS = 80;
const CHROME_MAX_DIM = 96;
const CHROME_ASPECT_EXTREME = 8;
const DEFRINGE_RADIUS = 48;
const EXPORT_PAD = 4;

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

export function isShadedGreen(p: Rgba): boolean {
  if (p.a < 8) return false;
  const { h, s, v } = rgbToHsv(p.r, p.g, p.b);
  // Shaded green mannequin: green-dominant even when dark
  const greenDom = p.g > p.r + 12 && p.g > p.b + 8;
  const hsvOk = h >= GREEN_HUE_MIN && h <= GREEN_HUE_MAX && s >= GREEN_SAT_MIN && v >= GREEN_VAL_MIN;
  return greenDom || hsvOk;
}

/** Sample edge pixels and return representative studio colors (up to a few clusters). */
export function sampleStudioColors(img: ImageData): Rgba[] {
  const { width: w, height: h, data } = img;
  const samples: Rgba[] = [];
  const push = (x: number, y: number) => {
    const p = getPixel(data, x, y, w);
    if (p.a < 8) return;
    samples.push(p);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  // Simple clustering: keep colors far from existing centroids
  const centroids: Rgba[] = [];
  for (const s of samples) {
    let near = false;
    for (const c of centroids) {
      if (colorDist2(s, c) < STUDIO_TOL2) {
        near = true;
        break;
      }
    }
    if (!near) centroids.push(s);
    if (centroids.length >= 8) break;
  }
  return centroids.length ? centroids : [{ r: 245, g: 245, b: 245, a: 255 }];
}

function matchesStudio(p: Rgba, studio: Rgba[]): boolean {
  if (p.a < 8) return true;
  for (const s of studio) {
    if (colorDist2(p, s) <= STUDIO_TOL2) return true;
  }
  return false;
}

/**
 * Wand wrap FIRST: flood studio from edges, then wrap whole figures
 * (hair, detached arms included). Split on gaps. Never a grid. Never key first.
 */
export function wandWrap(img: ImageData): { studioMask: Uint8Array; wraps: Wrap[] } {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const studio = sampleStudioColors(img);
  const studioMask = new Uint8Array(n); // 1 = studio (reachable from edges)
  const visited = new Uint8Array(n);
  const qx = new Int32Array(n);
  const qy = new Int32Array(n);

  // Seed flood from every edge pixel that matches studio
  let qh = 0;
  let qt = 0;
  const trySeed = (x: number, y: number) => {
    const i = y * w + x;
    if (visited[i]) return;
    const p = getPixel(data, x, y, w);
    if (!matchesStudio(p, studio)) return;
    visited[i] = 1;
    studioMask[i] = 1;
    qx[qt] = x;
    qy[qt] = y;
    qt++;
  };
  for (let x = 0; x < w; x++) {
    trySeed(x, 0);
    trySeed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    trySeed(0, y);
    trySeed(w - 1, y);
  }

  while (qh < qt) {
    const x = qx[qh];
    const y = qy[qh];
    qh++;
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (visited[ni]) continue;
      const p = getPixel(data, nx, ny, w);
      if (!matchesStudio(p, studio)) continue;
      visited[ni] = 1;
      studioMask[ni] = 1;
      qx[qt] = nx;
      qy[qt] = ny;
      qt++;
    }
  }

  // Connected components of NON-studio → wraps (split on gaps)
  const wrapVisited = new Uint8Array(n);
  const wraps: Wrap[] = [];
  let nextId = 1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (studioMask[i] || wrapVisited[i]) continue;
      const p0 = getPixel(data, x, y, w);
      if (p0.a < 8) {
        wrapVisited[i] = 1;
        continue;
      }

      // BFS component
      const mask = new Uint8Array(n);
      let qh2 = 0;
      let qt2 = 0;
      qx[0] = x;
      qy[0] = y;
      qt2 = 1;
      wrapVisited[i] = 1;
      mask[i] = 1;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let count = 0;
      let greenCount = 0;

      while (qh2 < qt2) {
        const cx = qx[qh2];
        const cy = qy[qh2];
        qh2++;
        count++;
        const cp = getPixel(data, cx, cy, w);
        if (isShadedGreen(cp)) greenCount++;
        if (cx < minX) minX = cx;
        if (cy < minY) minY = cy;
        if (cx > maxX) maxX = cx;
        if (cy > maxY) maxY = cy;
        const neigh = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
        for (const [nx, ny] of neigh) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (wrapVisited[ni] || studioMask[ni]) continue;
          const np = getPixel(data, nx, ny, w);
          if (np.a < 8) {
            wrapVisited[ni] = 1;
            continue;
          }
          wrapVisited[ni] = 1;
          mask[ni] = 1;
          qx[qt2] = nx;
          qy[qt2] = ny;
          qt2++;
        }
      }

      if (count < MIN_WRAP_PIXELS) continue;

      const bbox: Rect = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
      const isGreen = greenCount / count > 0.35;
      const kind = classifyWrap(bbox, count, isGreen, w, h, data, mask);
      wraps.push({
        id: nextId++,
        bbox,
        mask,
        kind,
        pixelCount: count,
        isGreen,
      });
    }
  }

  return { studioMask, wraps };
}

function classifyWrap(
  bbox: Rect,
  count: number,
  isGreen: boolean,
  imgW: number,
  imgH: number,
  data: Uint8ClampedArray,
  mask: Uint8Array,
): WrapKind {
  if (isGreen) return 'green';

  // Chrome: small chips, thin ticks/dashes, label-sized blobs near edges
  const thin = bbox.w / bbox.h > CHROME_ASPECT_EXTREME || bbox.h / bbox.w > CHROME_ASPECT_EXTREME;
  const small = bbox.w <= CHROME_MAX_DIM && bbox.h <= CHROME_MAX_DIM && count < 2500;
  const nearEdge =
    bbox.x <= 4 ||
    bbox.y <= 4 ||
    bbox.x + bbox.w >= imgW - 4 ||
    bbox.y + bbox.h >= imgH - 4;
  if ((thin || small) && nearEdge) return 'chrome';

  // Hair-ish: wider than tall top mass, or high in frame with irregular top
  const topHeavy = bbox.y < imgH * 0.35 && bbox.w > bbox.h * 0.85;
  if (topHeavy && !isGreen) {
    // Check if mostly non-skin midtones in upper portion — soft heuristic
    let darkish = 0;
    let sampled = 0;
    for (let y = bbox.y; y < bbox.y + Math.min(12, bbox.h); y++) {
      for (let x = bbox.x; x < bbox.x + bbox.w; x += 2) {
        const i = y * imgW + x;
        if (!mask[i]) continue;
        const p = getPixel(data, x, y, imgW);
        sampled++;
        if (p.r + p.g + p.b < 360) darkish++;
      }
    }
    if (sampled > 20 && darkish / sampled > 0.55) return 'hair';
  }

  // Detached arm: elongated vertical-ish mid-size component
  const elong = bbox.h > bbox.w * 1.6 && count < 18000 && bbox.w < imgW * 0.35;
  if (elong) return 'arm';

  return 'figure';
}

/**
 * Key leftover studio OUTSIDE wraps only.
 * Fill holes OFF — never key interior cloth/hair/white fabric inside wraps.
 */
export function keyStudioOutsideWraps(
  img: ImageData,
  studioMask: Uint8Array,
  wraps: Wrap[],
): ImageData {
  const { width: w, height: h, data } = img;
  const out = new ImageData(new Uint8ClampedArray(data), w, h);
  const insideAny = new Uint8Array(w * h);
  for (const wrap of wraps) {
    if (wrap.kind === 'chrome') continue;
    for (let i = 0; i < insideAny.length; i++) {
      if (wrap.mask[i]) insideAny[i] = 1;
    }
  }
  for (let i = 0; i < w * h; i++) {
    // Only key studio that is NOT inside a wrap. Never punch holes in wrap interiors.
    if (studioMask[i] && !insideAny[i]) {
      out.data[i * 4 + 3] = 0;
    }
  }
  return out;
}

/** Strip chrome wraps (labels, hex chips, ticks, dashes) by clearing their pixels. */
export function stripChrome(img: ImageData, wraps: Wrap[]): ImageData {
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  for (const wrap of wraps) {
    if (wrap.kind !== 'chrome') continue;
    for (let i = 0; i < wrap.mask.length; i++) {
      if (wrap.mask[i]) out.data[i * 4 + 3] = 0;
    }
  }
  return out;
}

/**
 * Hair-aware top: never crop to skull — expand bbox upward to include
 * all hair pixels already in the wrap mask (and a little breathing room).
 */
export function hairAwareBBox(wrap: Wrap, imgW: number, imgH: number): Rect {
  let minX = wrap.bbox.x + wrap.bbox.w;
  let minY = wrap.bbox.y + wrap.bbox.h;
  let maxX = wrap.bbox.x;
  let maxY = wrap.bbox.y;
  for (let y = 0; y < imgH; y++) {
    for (let x = 0; x < imgW; x++) {
      if (!wrap.mask[y * imgW + x]) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX) return { ...wrap.bbox };
  // Extra top pad for hair wisps (never skull-crop)
  const topExtra = wrap.kind === 'hair' || wrap.kind === 'figure' ? 6 : 0;
  minY = Math.max(0, minY - topExtra);
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Align green wrap content into dest rect (scale+translate), then return aligned ImageData. */
export function alignGreenToDest(
  src: ImageData,
  wrap: Wrap,
  dest: Rect,
): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = dest.w;
  canvas.height = dest.h;
  const ctx = canvas.getContext('2d')!;
  // Draw only wrap pixels into a temp canvas at source size
  const tmp = document.createElement('canvas');
  tmp.width = src.width;
  tmp.height = src.height;
  const tctx = tmp.getContext('2d')!;
  const isolated = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
  for (let i = 0; i < wrap.mask.length; i++) {
    if (!wrap.mask[i]) isolated.data[i * 4 + 3] = 0;
  }
  tctx.putImageData(isolated, 0, 0);
  const bb = hairAwareBBox(wrap, src.width, src.height);
  ctx.clearRect(0, 0, dest.w, dest.h);
  ctx.drawImage(
    tmp,
    bb.x,
    bb.y,
    bb.w,
    bb.h,
    0,
    0,
    dest.w,
    dest.h,
  );
  return ctx.getImageData(0, 0, dest.w, dest.h);
}

/**
 * Key shaded green AFTER align. Defringe ~48 on keyed border only.
 */
export function keyGreenAndDefringe(aligned: ImageData): ImageData {
  const { width: w, height: h, data } = aligned;
  const out = new ImageData(new Uint8ClampedArray(data), w, h);
  const keyed = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = getPixel(out.data, x, y, w);
      if (p.a < 8) continue;
      if (isShadedGreen(p)) {
        keyed[y * w + x] = 1;
        out.data[idx(x, y, w) + 3] = 0;
      }
    }
  }

  // Border of keyed region: neighbors that remain opaque
  const border = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!keyed[y * w + x]) continue;
      const neigh = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      for (const [nx, ny] of neigh) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (keyed[ni]) continue;
        if (out.data[ni * 4 + 3] > 8) border[ni] = 1;
      }
    }
  }

  // Defringe ~48: desaturate / pull green cast on border neighborhood
  const r = DEFRINGE_RADIUS;
  // Distance transform approx via multi-pass box on border seeds (cheap)
  const dist = new Float32Array(w * h);
  dist.fill(1e9);
  for (let i = 0; i < border.length; i++) if (border[i]) dist[i] = 0;

  // Two-pass chamfer
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
      if (y > 0) dist[i] = Math.min(dist[i], dist[i - w] + 1);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
      if (y < h - 1) dist[i] = Math.min(dist[i], dist[i + w] + 1);
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (keyed[i]) continue;
      const a = out.data[i * 4 + 3];
      if (a < 8) continue;
      const d = dist[i];
      if (d > r) continue;
      const t = 1 - d / r; // 1 at border
      // Remove green fringe: blend toward luminance, drop G excess
      const pr = out.data[i * 4];
      const pg = out.data[i * 4 + 1];
      const pb = out.data[i * 4 + 2];
      const lum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
      const ng = pg - (pg - Math.min(pr, pb)) * t * 0.85;
      const nr = pr * (1 - t * 0.15) + lum * t * 0.15;
      const nb = pb * (1 - t * 0.15) + lum * t * 0.15;
      out.data[i * 4] = Math.round(nr);
      out.data[i * 4 + 1] = Math.round(Math.max(0, ng));
      out.data[i * 4 + 2] = Math.round(nb);
      // Soften alpha slightly right on the keyed edge
      if (d < 2) out.data[i * 4 + 3] = Math.round(a * (1 - t * 0.35));
    }
  }

  return out;
}

/** Crop wrap to tight bbox + 4px pad at native resolution. */
export function exportWrapCrop(
  img: ImageData,
  wrap: Wrap,
  pad = EXPORT_PAD,
): ImageData {
  const bb0 = hairAwareBBox(wrap, img.width, img.height);
  const bb = padRect(bb0, pad, img.width, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = bb.w;
  canvas.height = bb.h;
  const ctx = canvas.getContext('2d')!;
  const isolated = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  for (let i = 0; i < wrap.mask.length; i++) {
    if (!wrap.mask[i]) isolated.data[i * 4 + 3] = 0;
  }
  // Put isolated then crop
  const full = document.createElement('canvas');
  full.width = img.width;
  full.height = img.height;
  full.getContext('2d')!.putImageData(isolated, 0, 0);
  ctx.clearRect(0, 0, bb.w, bb.h);
  ctx.drawImage(full, bb.x, bb.y, bb.w, bb.h, 0, 0, bb.w, bb.h);
  return ctx.getImageData(0, 0, bb.w, bb.h);
}

/** Draw wrap outlines for debug preview */
export function drawWrapOverlay(img: ImageData, wraps: Wrap[]): ImageData {
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  const colors: Record<WrapKind, [number, number, number]> = {
    figure: [232, 196, 120],
    hair: [180, 120, 220],
    arm: [120, 180, 220],
    green: [80, 220, 120],
    chrome: [200, 80, 80],
    unknown: [200, 200, 200],
  };
  for (const wrap of wraps) {
    const [cr, cg, cb] = colors[wrap.kind];
    const { x, y, w, h } = wrap.bbox;
    const drawPx = (px: number, py: number) => {
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) return;
      const i = idx(px, py, img.width);
      out.data[i] = cr;
      out.data[i + 1] = cg;
      out.data[i + 2] = cb;
      out.data[i + 3] = 255;
    };
    for (let px = x; px < x + w; px++) {
      drawPx(px, y);
      drawPx(px, y + h - 1);
    }
    for (let py = y; py < y + h; py++) {
      drawPx(x, py);
      drawPx(x + w - 1, py);
    }
  }
  return out;
}

export { EXPORT_PAD, DEFRINGE_RADIUS };
