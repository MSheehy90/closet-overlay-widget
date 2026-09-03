import './styles.css';
import { loadSheetOrPng, canvasToDisplayUrl } from './io';
import {
  bodyLikelyHasArms,
  filterDetachedArms,
  runCleanup,
} from './cleanup/pipeline';
import {
  availableViews,
  composeOverlay,
  downloadImageData,
  urlToImageData,
  type BaseStyle,
  type BaseView,
  type OverlayState,
  type StageBg,
} from './overlay/compose';
import {
  armPathForView,
  assetUrl,
  defaultSelection,
  emptySelection,
  findBody,
  findWearable,
  hairFor,
  loadCatalog,
  pathForView,
  type CreatorCatalog,
  type OverlaySelection,
  clothesForSlot,
  bodiesFor,
} from './overlay/catalog';
import {
  createEmptySlots,
  type BodyDest,
  type CleanupResult,
  type SlotId,
} from './types';

type Tab = 'cleanup' | 'overlay';

const BASE = import.meta.env.BASE_URL;

const state = {
  tab: 'overlay' as Tab,
  catalog: null as CreatorCatalog | null,
  selection: emptySelection() as OverlaySelection,
  cleanupSource: null as ImageData | null,
  cleanupSourceName: '',
  cleanupResult: null as CleanupResult | null,
  showWraps: true,
  bodyDest: {
    rect: { x: 0, y: 0, w: 256, h: 512 },
    view: 'front' as BaseView,
    style: 'realism' as BaseStyle,
  } satisfies BodyDest,
  status: '',
  statusKind: '' as '' | 'ok' | 'err',
  overlay: {
    style: 'realism' as BaseStyle,
    view: 'front' as BaseView,
    bg: 'checker' as StageBg,
    slots: createEmptySlots(),
  } satisfies OverlayState,
  libraryGroup: 'Shirt' as string,
};

const app = document.querySelector<HTMLDivElement>('#app')!;

function setStatus(msg: string, kind: '' | 'ok' | 'err' = '') {
  state.status = msg;
  state.statusKind = kind;
  const el = document.getElementById('status');
  if (el) {
    el.textContent = msg;
    el.className = `status ${kind}`.trim();
  }
}

function catalogReady(): boolean {
  return !!state.catalog && state.catalog.status === 'ready' && state.catalog.counts.pngs > 0;
}

async function boot(): Promise<void> {
  setStatus('Loading creator closet…');
  try {
    state.catalog = await loadCatalog(BASE);
    if (catalogReady()) {
      state.selection = defaultSelection(state.catalog!, state.overlay.style, state.overlay.view);
      await applySelectionToSlots();
      setStatus(
        `Creator closet loaded · ${state.catalog!.counts.clothes} styles · ${state.catalog!.counts.pngs} PNGs`,
        'ok',
      );
    } else {
      setStatus(
        state.catalog?.message ||
          'Creator pack missing — waiting for living-food-chain-sim assets',
        'err',
      );
    }
  } catch (err) {
    setStatus(`Catalog failed: ${(err as Error).message}`, 'err');
  }
  render();
}

function render(): void {
  app.innerHTML = `
    <header class="topbar">
      <div class="brand-row">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true"></span>
          <p class="brand-name">Closet Overlay</p>
        </div>
      </div>
    </header>
    <div class="mode-rail" role="tablist" aria-label="Studio mode">
      <button type="button" class="mode-chip ${state.tab === 'overlay' ? 'active' : ''}" data-tab="overlay" role="tab">Overlay</button>
      <button type="button" class="mode-chip ${state.tab === 'cleanup' ? 'active' : ''}" data-tab="cleanup" role="tab">Cleanup</button>
    </div>
    <main class="view" id="main-view">
      ${state.tab === 'cleanup' ? renderCleanup() : renderOverlay()}
    </main>
    <p class="status ${state.statusKind}" id="status" style="padding: 0 0.85rem">${state.status}</p>
  `;
  bindCommon();
  if (state.tab === 'cleanup') bindCleanup();
  else bindOverlay();
  void paintStages();
}

function renderCleanup(): string {
  const lib = catalogReady()
    ? `<div class="panel">
        <h2>Creator library (cleanup source)</h2>
        <p class="hint">Pick an existing PNG to re-clean, or drop NEW art below.</p>
        <div class="chip-scroll" id="cleanup-lib-chips">${renderCleanupLibraryChips()}</div>
      </div>`
    : '';
  return `
    <div class="stage ${state.showWraps ? '' : 'checker'}" id="cleanup-stage">
      <p class="stage-empty" id="cleanup-empty">Pick library art or drop a new sheet</p>
      <canvas id="cleanup-canvas" class="hidden"></canvas>
    </div>
    ${lib}
    <div class="dropzone" id="cleanup-drop" tabindex="0">
      <strong>Drop NEW sheet or PNG</strong>
      <span>Extra path for new art only · wand wrap first</span>
      <input type="file" id="cleanup-file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" />
    </div>
    <div class="toolbar">
      <button type="button" class="chip-btn" id="btn-pick-cleanup">Load new</button>
      <button type="button" class="chip-btn" id="btn-run-cleanup" ${state.cleanupSource ? '' : 'disabled'}>Run cleanup</button>
      <button type="button" class="chip-btn ${state.showWraps ? 'active' : ''}" id="btn-toggle-wraps">Show wraps</button>
      <button type="button" class="chip-btn accent" id="btn-export-wraps" ${state.cleanupResult ? '' : 'disabled'}>Export wraps</button>
    </div>
    <div class="panel">
      <h2>Green mannequin dest</h2>
      <p class="hint">After studio key: align green wrap to body dest, then key shaded green + defringe ~48.</p>
      <div class="nudge-row" style="margin-top:0.5rem">
        <label>W <input type="number" id="dest-w" value="${state.bodyDest.rect.w}" min="8" step="1" /></label>
        <label>H <input type="number" id="dest-h" value="${state.bodyDest.rect.h}" min="8" step="1" /></label>
        <label>View
          <select id="dest-view">
            <option value="front" ${state.bodyDest.view === 'front' ? 'selected' : ''}>front</option>
            <option value="side" ${state.bodyDest.view === 'side' ? 'selected' : ''}>side</option>
            <option value="back" ${state.bodyDest.view === 'back' ? 'selected' : ''}>back</option>
          </select>
        </label>
      </div>
    </div>
    <div class="panel">
      <h2>Wraps</h2>
      <div class="wrap-list" id="wrap-list">
        ${state.cleanupResult ? renderWrapList(state.cleanupResult) : '<p class="hint">No wraps yet.</p>'}
      </div>
    </div>
  `;
}

function renderCleanupLibraryChips(): string {
  const c = state.catalog!;
  const paths: { label: string; path: string }[] = [];
  for (const b of [...c.bodies.realism, ...c.bodies.chibi].slice(0, 24)) {
    paths.push({ label: b.label, path: b.path });
  }
  for (const item of c.clothes.slice(0, 40)) {
    const p = item.views.front || Object.values(item.views)[0];
    if (p) paths.push({ label: item.label, path: p });
  }
  return paths
    .map(
      (p) =>
        `<button type="button" class="chip-btn lib-chip" data-cleanup-path="${p.path}">${escapeHtml(p.label)}</button>`,
    )
    .join('');
}

function renderWrapList(result: CleanupResult): string {
  if (!result.exports.length) return '<p class="hint">No content wraps.</p>';
  return result.exports
    .map((ex, i) => {
      const url = canvasToDisplayUrl(ex.image);
      return `
        <div class="wrap-item" data-export="${i}">
          <img class="wrap-swatch" src="${url}" alt="${ex.name}" />
          <div class="meta">
            <strong>${ex.name}</strong>
            <span>${ex.image.width}×${ex.image.height} · ${ex.kind}</span>
          </div>
          <button type="button" class="chip-btn" data-dl-export="${i}">PNG</button>
        </div>`;
    })
    .join('');
}

function renderOverlay(): string {
  const views = availableViews(state.overlay.style);
  const ready = catalogReady();
  return `
    <div class="stage ${state.overlay.bg}" id="overlay-stage">
      <p class="stage-empty" id="overlay-empty">${
        ready ? 'Loading stack…' : 'Creator closet not loaded yet'
      }</p>
      <canvas id="overlay-canvas" class="hidden"></canvas>
    </div>
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Base style">
        <button type="button" class="chip-btn ${state.overlay.style === 'realism' ? 'active' : ''}" data-style="realism">Realism</button>
        <button type="button" class="chip-btn ${state.overlay.style === 'chibi' ? 'active' : ''}" data-style="chibi">Chibi</button>
      </div>
      <div class="seg" role="group" aria-label="View">
        ${views
          .map(
            (v) =>
              `<button type="button" class="chip-btn ${state.overlay.view === v ? 'active' : ''}" data-view="${v}">${v === 'front' ? 'F' : v === 'side' ? 'S' : 'B'}</button>`,
          )
          .join('')}
      </div>
      <div class="seg" role="group" aria-label="Background">
        <button type="button" class="chip-btn ${state.overlay.bg === 'checker' ? 'active' : ''}" data-bg="checker">Checker</button>
        <button type="button" class="chip-btn ${state.overlay.bg === 'dark' ? 'active' : ''}" data-bg="dark">Dark</button>
      </div>
    </div>
    <p class="hint">${
      state.overlay.style === 'chibi'
        ? 'Living Sim chibi — front only. Side/back are not invented.'
        : 'Realism bodies: front / side / back. Z-order: body → underwear → shirt → pants → apron → coat → hair.'
    }</p>
    ${ready ? renderLibraryPanels() : renderMissingPack()}
    <div class="toolbar">
      <button type="button" class="chip-btn accent" id="btn-export-stack" ${ready ? '' : 'disabled'}>Export stack PNG</button>
      <button type="button" class="chip-btn" id="btn-export-layers" ${ready ? '' : 'disabled'}>Export per-layer PNGs</button>
    </div>
  `;
}

function renderMissingPack(): string {
  return `
    <div class="panel">
      <h2>Creator closet</h2>
      <p class="hint">Source of truth is living-food-chain-sim <code>assets/creator/hires-pack</code>. No clothes are invented. Once the pack is copied, shirts / bottoms / aprons / coats / uniforms / hair appear here automatically.</p>
    </div>`;
}

function renderLibraryPanels(): string {
  const c = state.catalog!;
  const style = state.overlay.style;
  const view = state.overlay.view;
  const bodies = bodiesFor(c, style, view);
  const groups = uniqueGroups(c);
  const activeGroup = groups.includes(state.libraryGroup) ? state.libraryGroup : groups[0];
  state.libraryGroup = activeGroup || 'Shirt';

  return `
    <div class="panel">
      <h2>Body</h2>
      <div class="chip-scroll">
        ${bodies
          .map(
            (b) =>
              `<button type="button" class="chip-btn lib-chip ${state.selection.bodyId === b.id ? 'active' : ''}" data-sel-body="${b.id}">${escapeHtml(b.label)}</button>`,
          )
          .join('') || '<span class="hint">No bodies for this view</span>'}
      </div>
    </div>
    <div class="panel">
      <h2>Closet</h2>
      <div class="seg group-rail">
        ${groups
          .map(
            (g) =>
              `<button type="button" class="chip-btn ${state.libraryGroup === g ? 'active' : ''}" data-group="${escapeHtml(g)}">${escapeHtml(g)}</button>`,
          )
          .join('')}
      </div>
      <div class="chip-scroll" style="margin-top:0.55rem">
        ${renderGroupChips(state.libraryGroup)}
      </div>
      <div class="sel-summary">
        ${selectionSummary()}
      </div>
    </div>
    <div class="panel">
      <h2>Nudge active layers</h2>
      <div class="slot-list compact">
        ${state.overlay.slots
          .filter((s) => s.image)
          .map(
            (slot) => `
          <div class="slot has-file">
            <div class="slot-meta" style="grid-column:1/-1">
              <div class="slot-title">${slot.label}</div>
              <div class="nudge-row">
                <label>X <input type="number" data-nudge="${slot.id}" data-axis="x" value="${slot.nudge.x}" step="1" /></label>
                <label>Y <input type="number" data-nudge="${slot.id}" data-axis="y" value="${slot.nudge.y}" step="1" /></label>
                <label>Scale <input type="number" data-nudge="${slot.id}" data-axis="scale" value="${slot.nudge.scale}" min="0.05" step="0.01" /></label>
              </div>
            </div>
          </div>`,
          )
          .join('') || '<p class="hint">Select body + clothes chips to stack.</p>'}
      </div>
    </div>
  `;
}

function uniqueGroups(c: CreatorCatalog): string[] {
  const set = new Set<string>();
  for (const item of c.clothes) set.add(item.group);
  if (c.underwear.length) set.add('Underwear');
  for (const h of c.hair) set.add(h.group);
  const preferred = c.groups.filter((g) => set.has(g));
  for (const g of set) if (!preferred.includes(g)) preferred.push(g);
  return preferred;
}

function renderGroupChips(group: string): string {
  const c = state.catalog!;
  const style = state.overlay.style;
  const view = state.overlay.view;
  if (group === 'Underwear') {
    const items = clothesForSlot(c, 'underwear', view, style);
    return items
      .map(
        (it) =>
          `<button type="button" class="chip-btn lib-chip ${state.selection.underwearId === it.id ? 'active' : ''}" data-sel-slot="underwear" data-sel-id="${it.id}">${escapeHtml(it.label)}</button>`,
      )
      .join('') || '<span class="hint">No underwear for this view</span>';
  }
  if (group.startsWith('Hair')) {
    const items = hairFor(c, view, style).filter((h) => h.group === group);
    return (
      items
        .map(
          (it) =>
            `<button type="button" class="chip-btn lib-chip ${state.selection.hairId === it.id ? 'active' : ''}" data-sel-slot="hair" data-sel-id="${it.id}">${escapeHtml(it.label)}</button>`,
        )
        .join('') || '<span class="hint">No hair for this view</span>'
    );
  }
  const items = c.clothes.filter(
    (cl) => cl.group === group && !!pathForView(cl, view, style),
  );
  return (
    items
      .map((it) => {
        const selKey = slotSelKey(it.slot as SlotId);
        const selected = selKey && state.selection[selKey] === it.id;
        return `<button type="button" class="chip-btn lib-chip ${selected ? 'active' : ''}" data-sel-slot="${it.slot}" data-sel-id="${it.id}">${escapeHtml(it.label)}</button>`;
      })
      .join('') || '<span class="hint">No items for this view</span>'
  );
}

function slotSelKey(
  slot: SlotId,
): 'underwearId' | 'shirtId' | 'pantsId' | 'apronId' | 'coatId' | 'hairId' | null {
  switch (slot) {
    case 'underwear':
      return 'underwearId';
    case 'shirt':
      return 'shirtId';
    case 'pants':
      return 'pantsId';
    case 'apron':
      return 'apronId';
    case 'coat':
      return 'coatId';
    case 'hair':
      return 'hairId';
    default:
      return null;
  }
}

function selectionSummary(): string {
  const parts = [
    ['Body', state.selection.bodyId],
    ['Underwear', state.selection.underwearId],
    ['Shirt', state.selection.shirtId],
    ['Pants', state.selection.pantsId],
    ['Apron', state.selection.apronId],
    ['Coat', state.selection.coatId],
    ['Hair', state.selection.hairId],
  ];
  return parts
    .map(([label, id]) => {
      const name =
        label === 'Body'
          ? findBody(state.catalog!, id as string)?.label
          : findWearable(state.catalog!, id as string)?.label;
      return `<span class="sel-pill">${label}: <strong>${escapeHtml(name || '—')}</strong></span>`;
    })
    .join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bindCommon(): void {
  app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tab = btn.dataset.tab as Tab;
      render();
    });
  });
}

function bindDropzone(
  zone: HTMLElement,
  input: HTMLInputElement,
  onFile: (file: File) => void,
): void {
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const f = e.dataTransfer?.files?.[0];
    if (f) onFile(f);
  });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) onFile(f);
  });
}

function bindCleanup(): void {
  const drop = document.getElementById('cleanup-drop');
  const input = document.getElementById('cleanup-file') as HTMLInputElement | null;
  if (drop && input) bindDropzone(drop, input, (file) => void loadCleanupFile(file));
  document.getElementById('btn-pick-cleanup')?.addEventListener('click', () => input?.click());
  document.getElementById('btn-run-cleanup')?.addEventListener('click', () => void doCleanup());
  document.getElementById('btn-toggle-wraps')?.addEventListener('click', () => {
    state.showWraps = !state.showWraps;
    render();
  });
  document.getElementById('btn-export-wraps')?.addEventListener('click', () => void exportAllWraps());
  document.getElementById('dest-w')?.addEventListener('change', (e) => {
    state.bodyDest.rect.w = Math.max(8, Number((e.target as HTMLInputElement).value) || 256);
  });
  document.getElementById('dest-h')?.addEventListener('change', (e) => {
    state.bodyDest.rect.h = Math.max(8, Number((e.target as HTMLInputElement).value) || 512);
  });
  document.getElementById('dest-view')?.addEventListener('change', (e) => {
    state.bodyDest.view = (e.target as HTMLSelectElement).value as BaseView;
  });
  app.querySelectorAll<HTMLButtonElement>('[data-dl-export]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.dlExport);
      const ex = state.cleanupResult?.exports[i];
      if (ex) void downloadImageData(ex.image, `${ex.name}.png`);
    });
  });
  app.querySelectorAll<HTMLButtonElement>('[data-cleanup-path]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const path = btn.dataset.cleanupPath!;
      void loadCleanupFromPath(path);
    });
  });
}

async function loadCleanupFromPath(path: string): Promise<void> {
  try {
    setStatus(`Loading ${path}…`);
    const img = await urlToImageData(assetUrl(BASE, path));
    state.cleanupSource = img;
    state.cleanupSourceName = path;
    state.cleanupResult = null;
    setStatus(`Loaded ${path}`, 'ok');
    render();
  } catch (err) {
    setStatus(`Load failed: ${(err as Error).message}`, 'err');
  }
}

async function loadCleanupFile(file: File): Promise<void> {
  try {
    setStatus('Loading…');
    const { frames, name } = await loadSheetOrPng(file);
    state.cleanupSource = frames[0];
    state.cleanupSourceName = name;
    state.cleanupResult = null;
    setStatus(`Loaded new art ${name} (${frames[0].width}×${frames[0].height})`, 'ok');
    render();
  } catch (err) {
    setStatus(`Load failed: ${(err as Error).message}`, 'err');
  }
}

async function doCleanup(): Promise<void> {
  if (!state.cleanupSource) return;
  try {
    setStatus('Running wand wrap → studio key → chrome strip…');
    await new Promise((r) => setTimeout(r, 20));
    const result = runCleanup(state.cleanupSource, {
      bodyDest: state.bodyDest,
      showWrapDebug: state.showWraps,
    });
    const arms = result.wraps.filter((w) => w.kind === 'arm');
    const figure = result.wraps.find((w) => w.kind === 'figure');
    const hasArms = bodyLikelyHasArms(figure, arms);
    const keep = new Set(
      filterDetachedArms(result.wraps, state.bodyDest.view, hasArms).map((w) => w.id),
    );
    result.exports = result.exports.filter((ex) => keep.has(ex.wrapId) || ex.kind !== 'arm');
    state.cleanupResult = result;
    setStatus(`Wrapped ${result.wraps.length} region(s) · ${result.exports.length} export(s)`, 'ok');
    render();
  } catch (err) {
    setStatus(`Cleanup failed: ${(err as Error).message}`, 'err');
  }
}

async function exportAllWraps(): Promise<void> {
  if (!state.cleanupResult) return;
  for (const ex of state.cleanupResult.exports) {
    await downloadImageData(ex.image, `${ex.name}.png`);
  }
  setStatus(`Exported ${state.cleanupResult.exports.length} PNG(s)`, 'ok');
}

function bindOverlay(): void {
  app.querySelectorAll<HTMLButtonElement>('[data-style]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.overlay.style = btn.dataset.style as BaseStyle;
      if (state.overlay.style === 'chibi') state.overlay.view = 'front';
      if (catalogReady()) {
        state.selection = defaultSelection(state.catalog!, state.overlay.style, state.overlay.view);
        void applySelectionToSlots().then(render);
      } else render();
    });
  });
  app.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view as BaseView;
      if (state.overlay.style === 'chibi' && v !== 'front') {
        setStatus('Chibi is front only — side/back are not invented.', 'err');
        return;
      }
      state.overlay.view = v;
      if (catalogReady()) {
        // Keep style selections where possible; refresh body for view
        const bodies = bodiesFor(state.catalog!, state.overlay.style, v);
        if (!bodies.some((b) => b.id === state.selection.bodyId)) {
          const current = findBody(state.catalog!, state.selection.bodyId);
          const sameSex = current
            ? bodies.find((b) => b.sex === current.sex)
            : null;
          state.selection.bodyId = sameSex?.id ?? bodies[0]?.id ?? null;
        }
        void applySelectionToSlots().then(render);
      } else render();
    });
  });
  app.querySelectorAll<HTMLButtonElement>('[data-bg]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.overlay.bg = btn.dataset.bg as StageBg;
      render();
    });
  });
  app.querySelectorAll<HTMLButtonElement>('[data-group]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.libraryGroup = btn.dataset.group!;
      render();
    });
  });
  app.querySelectorAll<HTMLButtonElement>('[data-sel-body]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selection.bodyId = btn.dataset.selBody!;
      void applySelectionToSlots().then(render);
    });
  });
  app.querySelectorAll<HTMLButtonElement>('[data-sel-slot]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const slot = btn.dataset.selSlot as SlotId;
      const id = btn.dataset.selId!;
      const key = slotSelKey(slot);
      if (!key) return;
      // Toggle off if same chip clicked
      state.selection[key] = state.selection[key] === id ? null : id;
      void applySelectionToSlots().then(render);
    });
  });
  app.querySelectorAll<HTMLInputElement>('[data-nudge]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.dataset.nudge as SlotId;
      const axis = input.dataset.axis as 'x' | 'y' | 'scale';
      const slot = state.overlay.slots.find((s) => s.id === id)!;
      const v = Number(input.value);
      if (axis === 'scale') slot.nudge.scale = Math.max(0.05, v || 1);
      else slot.nudge[axis] = v || 0;
      void paintStages();
    });
  });
  document.getElementById('btn-export-stack')?.addEventListener('click', () => void exportStack());
  document.getElementById('btn-export-layers')?.addEventListener('click', () => void exportLayers());
}

let applySelectionGen = 0;

async function applySelectionToSlots(): Promise<void> {
  if (!state.catalog) return;
  const gen = ++applySelectionGen;
  const style = state.overlay.style;
  const view = state.overlay.view;
  const prevNudges = new Map(
    state.overlay.slots.map((s) => [s.id, { ...s.nudge }] as const),
  );
  const slots = createEmptySlots();
  for (const slot of slots) {
    const prev = prevNudges.get(slot.id);
    if (prev) slot.nudge = prev;
  }

  const setSlot = async (slotId: SlotId, path: string | null, fileLabel: string) => {
    const slot = slots.find((s) => s.id === slotId)!;
    if (!path) {
      slot.image = null;
      slot.file = null;
      return;
    }
    const img = await urlToImageData(assetUrl(BASE, path));
    slot.image = img;
    slot.file = new File([], fileLabel);
  };

  const body = findBody(state.catalog, state.selection.bodyId);
  await setSlot('body', body?.path ?? null, body?.label ?? 'body');

  const und = findWearable(state.catalog, state.selection.underwearId);
  await setSlot('underwear', und ? pathForView(und, view, style) : null, und?.label ?? '');

  const shirt = findWearable(state.catalog, state.selection.shirtId);
  await setSlot('shirt', shirt ? pathForView(shirt, view, style) : null, shirt?.label ?? '');

  const pants = findWearable(state.catalog, state.selection.pantsId);
  await setSlot('pants', pants ? pathForView(pants, view, style) : null, pants?.label ?? '');

  const apron = findWearable(state.catalog, state.selection.apronId);
  await setSlot('apron', apron ? pathForView(apron, view, style) : null, apron?.label ?? '');

  const coat = findWearable(state.catalog, state.selection.coatId);
  await setSlot('coat', coat ? pathForView(coat, view, style) : null, coat?.label ?? '');

  const hair = findWearable(state.catalog, state.selection.hairId);
  await setSlot('hair', hair ? pathForView(hair, view, style) : null, hair?.label ?? '');

  // Detached arm: only when catalog has -arm for this view AND policy allows
  // Side: include if near arm missing from body (we treat explicit -arm files as the overlay)
  // Front/back: skip arm overlay when body already includes arms — catalog -arm is optional add-on for side.
  if (state.selection.includeArm && coat) {
    const arm = armPathForView(coat, view, style);
    // Arms are not a separate z-slot; if present for side views, composite onto coat layer after coat
    if (arm && view === 'side') {
      const coatSlot = slots.find((s) => s.id === 'coat')!;
      if (coatSlot.image) {
        const armImg = await urlToImageData(assetUrl(BASE, arm));
        coatSlot.image = stackTwo(coatSlot.image, armImg);
      }
    }
  }
  // Also check shirt/pants arm files for side
  for (const wear of [shirt, pants, apron]) {
    if (!wear || view !== 'side') continue;
    const arm = armPathForView(wear, view, style);
    if (!arm) continue;
    const slot = slots.find((s) => s.id === wear.slot)!;
    if (slot.image) {
      const armImg = await urlToImageData(assetUrl(BASE, arm));
      slot.image = stackTwo(slot.image, armImg);
    }
  }

  if (gen !== applySelectionGen) return;
  state.overlay.slots = slots;
}

function stackTwo(base: ImageData, overlay: ImageData): ImageData {
  const w = Math.max(base.width, overlay.width);
  const h = Math.max(base.height, overlay.height);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const draw = (img: ImageData) => {
    const t = document.createElement('canvas');
    t.width = img.width;
    t.height = img.height;
    t.getContext('2d')!.putImageData(img, 0, 0);
    const dx = (w - img.width) / 2;
    const dy = (h - img.height) / 2;
    ctx.drawImage(t, dx, dy);
  };
  draw(base);
  draw(overlay);
  return ctx.getImageData(0, 0, w, h);
}

async function paintStages(): Promise<void> {
  if (state.tab === 'cleanup') {
    const canvas = document.getElementById('cleanup-canvas') as HTMLCanvasElement | null;
    const empty = document.getElementById('cleanup-empty');
    if (!canvas) return;
    const src =
      state.showWraps && state.cleanupResult?.debugOverlay
        ? state.cleanupResult.debugOverlay
        : state.cleanupResult?.cleaned ?? state.cleanupSource;
    if (!src) {
      canvas.classList.add('hidden');
      empty?.classList.remove('hidden');
      return;
    }
    canvas.width = src.width;
    canvas.height = src.height;
    canvas.getContext('2d')!.putImageData(src, 0, 0);
    canvas.classList.remove('hidden');
    empty?.classList.add('hidden');
    return;
  }

  const canvas = document.getElementById('overlay-canvas') as HTMLCanvasElement | null;
  const empty = document.getElementById('overlay-empty');
  if (!canvas) return;
  const hasAny = state.overlay.slots.some((s) => s.image);
  if (!hasAny) {
    canvas.classList.add('hidden');
    empty?.classList.remove('hidden');
    return;
  }
  const composed = composeOverlay(state.overlay);
  canvas.width = composed.width;
  canvas.height = composed.height;
  canvas.getContext('2d')!.putImageData(composed.stacked, 0, 0);
  canvas.classList.remove('hidden');
  empty?.classList.add('hidden');
}

async function exportStack(): Promise<void> {
  if (!state.overlay.slots.some((s) => s.image)) {
    setStatus('Nothing to export — select creator items.', 'err');
    return;
  }
  const composed = composeOverlay(state.overlay);
  await downloadImageData(
    composed.stacked,
    `closet-${state.overlay.style}-${state.overlay.view}-stack.png`,
  );
  setStatus('Exported stacked PNG', 'ok');
}

async function exportLayers(): Promise<void> {
  if (!state.overlay.slots.some((s) => s.image)) {
    setStatus('Nothing to export — select creator items.', 'err');
    return;
  }
  const composed = composeOverlay(state.overlay);
  for (const layer of composed.perLayer) {
    await downloadImageData(
      layer.image,
      `closet-${state.overlay.style}-${state.overlay.view}-${layer.id}.png`,
    );
  }
  setStatus(`Exported ${composed.perLayer.length} layer PNG(s)`, 'ok');
}

void boot();

if (import.meta.env.PROD) {
  void import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => {});
}
