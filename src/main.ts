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
  fileToImageData,
  urlToImageData,
  type BaseStyle,
  type BaseView,
  type OverlayState,
  type StageBg,
} from './overlay/compose';
import {
  createEmptySlots,
  type BodyDest,
  type CleanupResult,
  type OverlaySlot,
  type SlotId,
} from './types';

type Tab = 'cleanup' | 'overlay';

const state = {
  tab: 'cleanup' as Tab,
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
      <button type="button" class="mode-chip ${state.tab === 'cleanup' ? 'active' : ''}" data-tab="cleanup" role="tab" aria-selected="${state.tab === 'cleanup'}">Cleanup</button>
      <button type="button" class="mode-chip ${state.tab === 'overlay' ? 'active' : ''}" data-tab="overlay" role="tab" aria-selected="${state.tab === 'overlay'}">Overlay</button>
    </div>
    <main class="view" id="main-view">
      ${state.tab === 'cleanup' ? renderCleanup() : renderOverlay()}
    </main>
    <p class="status ${state.statusKind}" id="status" style="padding: 0 0.85rem">${state.status}</p>
  `;
  bindCommon();
  if (state.tab === 'cleanup') bindCleanup();
  else bindOverlay();
  paintStages();
}

function renderCleanup(): string {
  return `
    <div class="stage ${state.showWraps ? '' : 'checker'}" id="cleanup-stage">
      <p class="stage-empty" id="cleanup-empty">Load a sheet or PNG to wrap figures</p>
      <canvas id="cleanup-canvas" class="hidden"></canvas>
    </div>
    <div class="dropzone" id="cleanup-drop" tabindex="0">
      <strong>Drop sheet or PNG</strong>
      <span>Wand wrap first · studio key outside wraps · chrome strip</span>
      <input type="file" id="cleanup-file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" />
    </div>
    <div class="toolbar">
      <button type="button" class="chip-btn" id="btn-pick-cleanup">Load</button>
      <button type="button" class="chip-btn" id="btn-demo-cleanup">Demo sheet</button>
      <button type="button" class="chip-btn" id="btn-run-cleanup" ${state.cleanupSource ? '' : 'disabled'}>Run cleanup</button>
      <button type="button" class="chip-btn ${state.showWraps ? 'active' : ''}" id="btn-toggle-wraps">Show wraps</button>
      <button type="button" class="chip-btn accent" id="btn-export-wraps" ${state.cleanupResult ? '' : 'disabled'}>Export wraps</button>
    </div>
    <div class="panel">
      <h2>Green mannequin dest</h2>
      <p class="hint">After studio key: align green wrap to body dest, then key shaded green + defringe ~48 on keyed border.</p>
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
  return `
    <div class="stage ${state.overlay.bg}" id="overlay-stage">
      <p class="stage-empty" id="overlay-empty">Drop files into slots — nothing invented</p>
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
              `<button type="button" class="chip-btn ${state.overlay.view === v ? 'active' : ''}" data-view="${v}">${v}</button>`,
          )
          .join('')}
      </div>
      <div class="seg" role="group" aria-label="Background">
        <button type="button" class="chip-btn ${state.overlay.bg === 'checker' ? 'active' : ''}" data-bg="checker">Checker</button>
        <button type="button" class="chip-btn ${state.overlay.bg === 'dark' ? 'active' : ''}" data-bg="dark">Dark</button>
      </div>
    </div>
    <p class="hint">${state.overlay.style === 'chibi' ? 'Chibi is front only — side/back are not invented.' : 'Realism bases: front, side, back.'}</p>
    <div class="panel">
      <h2>Slots</h2>
      <div class="slot-list" id="slot-list">
        ${state.overlay.slots.map(renderSlot).join('')}
      </div>
    </div>
    <div class="toolbar">
      <button type="button" class="chip-btn" id="btn-demo-overlay">Load demo layers</button>
      <button type="button" class="chip-btn accent" id="btn-export-stack">Export stack PNG</button>
      <button type="button" class="chip-btn" id="btn-export-layers">Export per-layer PNGs</button>
      <button type="button" class="ghost-btn" id="btn-clear-slots">Clear slots</button>
    </div>
  `;
}

function renderSlot(slot: OverlaySlot): string {
  const thumb = slot.image
    ? `<img src="${canvasToDisplayUrl(slot.image)}" alt="" />`
    : `<span class="empty-mark">Empty</span>`;
  const hairExtras =
    slot.id === 'hair'
      ? `
        <div class="row" style="margin-top:0.25rem">
          <label class="sr-only" for="tint-${slot.id}">Hair tint</label>
          <input type="color" id="tint-${slot.id}" value="${slot.tintColor ?? '#5a3a28'}" title="Hair tint" />
          <button type="button" class="chip-btn" data-tint-map="${slot.id}">Tint map</button>
          <button type="button" class="ghost-btn" data-clear-tint="${slot.id}">No tint</button>
        </div>`
      : '';
  return `
    <div class="slot ${slot.image ? 'has-file' : ''}" data-slot="${slot.id}">
      <div class="slot-thumb">${thumb}</div>
      <div class="slot-meta">
        <div class="slot-title">${slot.label}</div>
        <div class="slot-file">${slot.file?.name ?? 'Drop a PNG — never auto-filled'}</div>
        <div class="toolbar">
          <button type="button" class="chip-btn" data-pick-slot="${slot.id}">Load</button>
          <button type="button" class="ghost-btn" data-clear-slot="${slot.id}" ${slot.image ? '' : 'disabled'}>Clear</button>
        </div>
        <div class="nudge-row">
          <label>X <input type="number" data-nudge="${slot.id}" data-axis="x" value="${slot.nudge.x}" step="1" /></label>
          <label>Y <input type="number" data-nudge="${slot.id}" data-axis="y" value="${slot.nudge.y}" step="1" /></label>
          <label>Scale <input type="number" data-nudge="${slot.id}" data-axis="scale" value="${slot.nudge.scale}" min="0.05" step="0.01" /></label>
        </div>
        ${hairExtras}
        <input type="file" data-file-slot="${slot.id}" accept="image/png,image/webp,.png,.webp" />
        <input type="file" data-tint-file="${slot.id}" accept="image/png,image/webp,.png,.webp" />
      </div>
    </div>`;
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
  const drop = document.getElementById('cleanup-drop')!;
  const input = document.getElementById('cleanup-file') as HTMLInputElement;
  bindDropzone(drop, input, (file) => void loadCleanupFile(file));
  document.getElementById('btn-pick-cleanup')?.addEventListener('click', () => input.click());
  document.getElementById('btn-demo-cleanup')?.addEventListener('click', () => void loadDemoCleanup());
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
}

async function loadCleanupFile(file: File): Promise<void> {
  try {
    setStatus('Loading…');
    const { frames, name } = await loadSheetOrPng(file);
    state.cleanupSource = frames[0];
    state.cleanupSourceName = name;
    state.cleanupResult = null;
    setStatus(`Loaded ${name} (${frames[0].width}×${frames[0].height})`, 'ok');
    render();
  } catch (err) {
    setStatus(`Load failed: ${(err as Error).message}`, 'err');
  }
}

async function doCleanup(): Promise<void> {
  if (!state.cleanupSource) return;
  try {
    setStatus('Running wand wrap → studio key → chrome strip…');
    // Yield so status paints
    await new Promise((r) => setTimeout(r, 20));
    const result = runCleanup(state.cleanupSource, {
      bodyDest: state.bodyDest,
      showWrapDebug: state.showWraps,
    });

    // Detached arm policy for export list
    const arms = result.wraps.filter((w) => w.kind === 'arm');
    const figure = result.wraps.find((w) => w.kind === 'figure');
    const hasArms = bodyLikelyHasArms(figure, arms);
    const keep = new Set(
      filterDetachedArms(result.wraps, state.bodyDest.view, hasArms).map((w) => w.id),
    );
    result.exports = result.exports.filter((ex) => keep.has(ex.wrapId) || ex.kind !== 'arm');

    state.cleanupResult = result;
    setStatus(
      `Wrapped ${result.wraps.length} region(s) · ${result.exports.length} export(s)`,
      'ok',
    );
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
      render();
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
      render();
    });
  });
  app.querySelectorAll<HTMLButtonElement>('[data-bg]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.overlay.bg = btn.dataset.bg as StageBg;
      render();
    });
  });

  app.querySelectorAll<HTMLButtonElement>('[data-pick-slot]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.pickSlot as SlotId;
      const input = app.querySelector<HTMLInputElement>(`[data-file-slot="${id}"]`);
      input?.click();
    });
  });
  app.querySelectorAll<HTMLInputElement>('[data-file-slot]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.dataset.fileSlot as SlotId;
      const f = input.files?.[0];
      if (f) void assignSlot(id, f);
    });
  });
  app.querySelectorAll<HTMLElement>('[data-slot]').forEach((el) => {
    const id = el.dataset.slot as SlotId;
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const f = e.dataTransfer?.files?.[0];
      if (f) void assignSlot(id, f);
    });
  });
  app.querySelectorAll<HTMLButtonElement>('[data-clear-slot]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.clearSlot as SlotId;
      const slot = state.overlay.slots.find((s) => s.id === id)!;
      slot.file = null;
      slot.image = null;
      slot.tintMap = null;
      render();
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
      paintStages();
    });
  });
  app.querySelectorAll<HTMLInputElement>('[id^="tint-"]').forEach((input) => {
    input.addEventListener('input', () => {
      const id = input.id.replace('tint-', '') as SlotId;
      const slot = state.overlay.slots.find((s) => s.id === id)!;
      slot.tintColor = input.value;
      paintStages();
    });
  });
  app.querySelectorAll<HTMLButtonElement>('[data-clear-tint]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.clearTint as SlotId;
      const slot = state.overlay.slots.find((s) => s.id === id)!;
      slot.tintColor = null;
      slot.tintMap = null;
      paintStages();
      setStatus('Hair tint cleared', 'ok');
    });
  });
  app.querySelectorAll<HTMLButtonElement>('[data-tint-map]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tintMap as SlotId;
      app.querySelector<HTMLInputElement>(`[data-tint-file="${id}"]`)?.click();
    });
  });
  app.querySelectorAll<HTMLInputElement>('[data-tint-file]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.dataset.tintFile as SlotId;
      const f = input.files?.[0];
      if (!f) return;
      void fileToImageData(f).then((img) => {
        const slot = state.overlay.slots.find((s) => s.id === id)!;
        slot.tintMap = img;
        if (!slot.tintColor) slot.tintColor = '#5a3a28';
        paintStages();
        setStatus('Tint map loaded', 'ok');
      });
    });
  });

  document.getElementById('btn-demo-overlay')?.addEventListener('click', () => void loadDemoOverlay());
  document.getElementById('btn-export-stack')?.addEventListener('click', () => void exportStack());
  document.getElementById('btn-export-layers')?.addEventListener('click', () => void exportLayers());
  document.getElementById('btn-clear-slots')?.addEventListener('click', () => {
    state.overlay.slots = createEmptySlots();
    render();
  });
}

function fixtureUrl(name: string): string {
  return `${import.meta.env.BASE_URL}fixtures/${name}`;
}

async function loadDemoCleanup(): Promise<void> {
  try {
    setStatus('Loading demo sheet…');
    const img = await urlToImageData(fixtureUrl('cleanup-studio.png'));
    state.cleanupSource = img;
    state.cleanupSourceName = 'cleanup-studio.png';
    state.cleanupResult = null;
    setStatus(`Loaded demo sheet (${img.width}×${img.height})`, 'ok');
    render();
    await doCleanup();
  } catch (err) {
    setStatus(`Demo load failed: ${(err as Error).message}`, 'err');
  }
}

async function loadDemoOverlay(): Promise<void> {
  try {
    setStatus('Loading demo layers…');
    const mapping: { id: SlotId; file: string }[] = [
      { id: 'body', file: 'body.png' },
      { id: 'shirt', file: 'shirt.png' },
      { id: 'pants', file: 'pants.png' },
      { id: 'hair', file: 'hair.png' },
    ];
    for (const m of mapping) {
      const img = await urlToImageData(fixtureUrl(m.file));
      const slot = state.overlay.slots.find((s) => s.id === m.id)!;
      slot.image = img;
      slot.file = new File([], m.file);
    }
    const hair = state.overlay.slots.find((s) => s.id === 'hair')!;
    hair.tintMap = await urlToImageData(fixtureUrl('hair-tint-map.png'));
    hair.tintColor = '#6b3a1e';
    setStatus('Demo layers loaded (empty slots stay empty)', 'ok');
    render();
  } catch (err) {
    setStatus(`Demo overlay failed: ${(err as Error).message}`, 'err');
  }
}

async function assignSlot(id: SlotId, file: File): Promise<void> {
  try {
    const img = await fileToImageData(file);
    const slot = state.overlay.slots.find((s) => s.id === id)!;
    slot.file = file;
    slot.image = img;
    setStatus(`${slot.label}: ${file.name}`, 'ok');
    render();
  } catch (err) {
    setStatus(`Slot load failed: ${(err as Error).message}`, 'err');
  }
}

function paintStages(): void {
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
  const hasAny = state.overlay.slots.some((s) => s.image);
  if (!hasAny) {
    setStatus('Drop files into slots before export — nothing is invented.', 'err');
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
  const hasAny = state.overlay.slots.some((s) => s.image);
  if (!hasAny) {
    setStatus('Drop files into slots before export — nothing is invented.', 'err');
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

render();

// Register PWA SW (vite-plugin-pwa injects virtual module in build)
if (import.meta.env.PROD) {
  void import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => {
      /* optional in dev */
    });
}
