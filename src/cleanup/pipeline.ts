import {
  type BodyDest,
  type CleanupExport,
  type CleanupResult,
  type Wrap,
} from '../types';
import {
  alignGreenToDest,
  exportWrapCrop,
  drawWrapOverlay,
  keyGreenAndDefringe,
  keyStudioOutsideWraps,
  stripChrome,
  wandWrap,
} from './wand';

export interface CleanupOptions {
  /** When set, green wraps are aligned to this dest then keyed+defringed */
  bodyDest?: BodyDest | null;
  showWrapDebug?: boolean;
}

/**
 * Locked cleanup order:
 * 1) Wand wrap FIRST (flood studio from edges; wrap figures/hair/arms; split on gaps)
 * 2) Key leftover studio outside wraps only (fill holes off)
 * 3) Strip chrome
 * 4) Green mannequin: AFTER studio key → ALIGN to body dest → key green → defringe ~48
 * 5) Export tight bbox + 4px pad, native res
 */
export function runCleanup(source: ImageData, options: CleanupOptions = {}): CleanupResult {
  const { studioMask, wraps } = wandWrap(source);

  // Studio key ONLY outside wraps
  let cleaned = keyStudioOutsideWraps(source, studioMask, wraps);
  cleaned = stripChrome(cleaned, wraps);

  const contentWraps = wraps.filter((w) => w.kind !== 'chrome');
  const exports: CleanupExport[] = [];

  for (const wrap of contentWraps) {
    if (wrap.isGreen || wrap.kind === 'green') {
      const dest = options.bodyDest?.rect ?? {
        x: 0,
        y: 0,
        w: wrap.bbox.w,
        h: wrap.bbox.h,
      };
      // AFTER studio key: align, THEN key green + defringe
      const aligned = alignGreenToDest(cleaned, wrap, dest);
      const keyed = keyGreenAndDefringe(aligned);
      exports.push({
        wrapId: wrap.id,
        kind: 'green',
        name: `green-mannequin-${wrap.id}`,
        image: keyed,
        bbox: { x: 0, y: 0, w: keyed.width, h: keyed.height },
      });
    } else {
      const crop = exportWrapCrop(cleaned, wrap);
      exports.push({
        wrapId: wrap.id,
        kind: wrap.kind,
        name: `${wrap.kind}-${wrap.id}`,
        image: crop,
        bbox: wrap.bbox,
      });
    }
  }

  const debugOverlay = options.showWrapDebug
    ? drawWrapOverlay(cleaned, contentWraps)
    : undefined;

  return {
    width: source.width,
    height: source.height,
    cleaned,
    wraps: contentWraps,
    exports,
    debugOverlay,
  };
}

/**
 * Detached arm policy:
 * - front/back: no separate arm overlay if an arm is already on the body wrap
 * - side: only include detached arm if that view is missing the near arm
 */
export function filterDetachedArms(
  wraps: Wrap[],
  view: 'front' | 'side' | 'back',
  bodyHasNearArm: boolean,
): Wrap[] {
  return wraps.filter((w) => {
    if (w.kind !== 'arm') return true;
    // front/back: no detached-arm overlay if the arm is already on the body
    if (view === 'front' || view === 'back') {
      return !bodyHasNearArm;
    }
    // side: only if that view is missing the near arm
    return !bodyHasNearArm;
  });
}

export function bodyLikelyHasArms(figureWrap: Wrap | undefined, armWraps: Wrap[]): boolean {
  if (!figureWrap) return armWraps.length === 0;
  // If figure bbox is wide enough relative to height, arms are probably attached
  const ratio = figureWrap.bbox.w / Math.max(1, figureWrap.bbox.h);
  return ratio > 0.42 || armWraps.length === 0;
}
