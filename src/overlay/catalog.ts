import type { BaseStyle, BaseView } from './compose';
import type { SlotId } from '../types';

export interface CatalogBody {
  id: string;
  sex: string;
  view: string;
  path: string;
  label: string;
  mannequin?: boolean;
}

export interface CatalogWearable {
  id: string;
  folder?: string;
  slot: Exclude<SlotId, 'body'> | 'hair';
  group: string;
  label: string;
  style?: string;
  source?: string;
  views: Partial<Record<BaseView, string>>;
  arms?: Partial<Record<BaseView, string>>;
}

export interface CreatorCatalog {
  version: number;
  source: string;
  status: 'ready' | 'empty';
  message?: string;
  zOrder: SlotId[];
  slotLabels: Record<string, string>;
  groups: string[];
  bodies: { realism: CatalogBody[]; chibi: CatalogBody[] };
  underwear: CatalogWearable[];
  clothes: CatalogWearable[];
  hair: CatalogWearable[];
  counts: {
    pngs: number;
    clothes: number;
    hair: number;
    realismBodies: number;
    chibiBodies: number;
    underwear: number;
  };
}

export interface OverlaySelection {
  bodyId: string | null;
  underwearId: string | null;
  shirtId: string | null;
  pantsId: string | null;
  apronId: string | null;
  coatId: string | null;
  hairId: string | null;
  /** Include detached arm layer when catalog has -arm for this view */
  includeArm: boolean;
}

export function emptySelection(): OverlaySelection {
  return {
    bodyId: null,
    underwearId: null,
    shirtId: null,
    pantsId: null,
    apronId: null,
    coatId: null,
    hairId: null,
    includeArm: true,
  };
}

export async function loadCatalog(baseUrl: string): Promise<CreatorCatalog> {
  const url = `${baseUrl}creator/catalog.json`;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) {
    return {
      version: 1,
      source: 'missing',
      status: 'empty',
      message: `catalog.json missing (${res.status})`,
      zOrder: ['body', 'underwear', 'shirt', 'pants', 'apron', 'coat', 'hair'],
      slotLabels: {},
      groups: [],
      bodies: { realism: [], chibi: [] },
      underwear: [],
      clothes: [],
      hair: [],
      counts: { pngs: 0, clothes: 0, hair: 0, realismBodies: 0, chibiBodies: 0, underwear: 0 },
    };
  }
  return (await res.json()) as CreatorCatalog;
}

export function bodiesFor(catalog: CreatorCatalog, style: BaseStyle, view: BaseView): CatalogBody[] {
  if (style === 'chibi') {
    return catalog.bodies.chibi.filter((b) => b.view === 'front');
  }
  return catalog.bodies.realism.filter((b) => b.view === view && !b.mannequin);
}

export function mannequinsFor(catalog: CreatorCatalog, view: BaseView): CatalogBody[] {
  return catalog.bodies.realism.filter((b) => b.mannequin && b.view === view);
}

export function clothesForSlot(
  catalog: CreatorCatalog,
  slot: SlotId,
  view: BaseView,
  style: BaseStyle,
): CatalogWearable[] {
  if (slot === 'body' || slot === 'hair') return [];
  if (slot === 'underwear') {
    return catalog.underwear.filter((u) => !!pathForView(u, view, style));
  }
  return catalog.clothes.filter((c) => c.slot === slot && !!pathForView(c, view, style));
}

export function hairFor(catalog: CreatorCatalog, view: BaseView, style: BaseStyle): CatalogWearable[] {
  return catalog.hair.filter((h) => !!pathForView(h, view, style));
}

export function pathForView(
  item: CatalogWearable,
  view: BaseView,
  style: BaseStyle,
): string | null {
  if (style === 'chibi') {
    // Chibi front only — never invent side/back
    return item.views.front || null;
  }
  return item.views[view] || null;
}

export function armPathForView(
  item: CatalogWearable,
  view: BaseView,
  style: BaseStyle,
): string | null {
  if (style === 'chibi') return null;
  return item.arms?.[view] || null;
}

export function findWearable(catalog: CreatorCatalog, id: string | null): CatalogWearable | null {
  if (!id) return null;
  return (
    catalog.clothes.find((c) => c.id === id) ||
    catalog.hair.find((h) => h.id === id) ||
    catalog.underwear.find((u) => u.id === id) ||
    null
  );
}

export function findBody(catalog: CreatorCatalog, id: string | null): CatalogBody | null {
  if (!id) return null;
  return (
    catalog.bodies.realism.find((b) => b.id === id) ||
    catalog.bodies.chibi.find((b) => b.id === id) ||
    null
  );
}

/** Pick sensible defaults once catalog loads — real creator items only. */
export function defaultSelection(
  catalog: CreatorCatalog,
  style: BaseStyle,
  view: BaseView,
): OverlaySelection {
  const bodies = bodiesFor(catalog, style, view);
  const shirts = clothesForSlot(catalog, 'shirt', view, style);
  const pants = clothesForSlot(catalog, 'pants', view, style);
  const aprons = clothesForSlot(catalog, 'apron', view, style);
  const coats = clothesForSlot(catalog, 'coat', view, style);
  const hairs = hairFor(catalog, view, style);
  const undies = clothesForSlot(catalog, 'underwear', view, style);
  return {
    bodyId: bodies[0]?.id ?? null,
    underwearId: undies[0]?.id ?? null,
    shirtId: shirts[0]?.id ?? null,
    pantsId: pants[0]?.id ?? null,
    apronId: aprons[0]?.id ?? null,
    coatId: coats[0]?.id ?? null,
    hairId: hairs[0]?.id ?? null,
    includeArm: true,
  };
}

export function assetUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path.replace(/^\//, '')}`;
}
