#!/usr/bin/env node
/**
 * Build public/creator/catalog.json from copied hires-pack files + pack-manifest.json.
 * Slot labels match the character creator (Shirt, Bottoms A/B, apron, coat, uniforms…).
 * Never invents PNG paths that are not on disk.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, relative, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACK = join(ROOT, 'public/creator/hires-pack');
const OUT = join(ROOT, 'public/creator/catalog.json');

const CLOSET_FOLDER_META = {
  shirt: { slot: 'shirt', group: 'Shirt', label: 'Shirt' },
  'bottoms-a': { slot: 'pants', group: 'Bottoms A', label: 'Bottoms A' },
  'bottoms-b': { slot: 'pants', group: 'Bottoms B', label: 'Bottoms B' },
  'class-bottoms': { slot: 'pants', group: 'Class bottoms', label: 'Class bottoms' },
  apron: { slot: 'apron', group: 'Apron', label: 'Apron' },
  'chef-long-apron': { slot: 'apron', group: 'Apron', label: 'Chef long apron' },
  'chef-waist-apron': { slot: 'apron', group: 'Apron', label: 'Chef waist apron' },
  coat: { slot: 'coat', group: 'Coat', label: 'Coat' },
  'fur-coat': { slot: 'coat', group: 'Coat', label: 'Fur coat' },
  'crew-coat': { slot: 'coat', group: 'Uniforms', label: 'Crew coat' },
  'crew-vest': { slot: 'coat', group: 'Uniforms', label: 'Crew vest' },
  'service-blazer': { slot: 'coat', group: 'Uniforms', label: 'Service blazer' },
  'service-vest': { slot: 'coat', group: 'Uniforms', label: 'Service vest' },
  'first-class': { slot: 'coat', group: 'Uniforms', label: 'First class' },
  'second-class': { slot: 'coat', group: 'Uniforms', label: 'Second class' },
  'third-class': { slot: 'coat', group: 'Uniforms', label: 'Third class' },
  tail: { slot: 'coat', group: 'Coat', label: 'Tail' },
};

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function viewFromName(name) {
  const n = name.toLowerCase();
  if (/(^|[-_])front([-_.]|$)/.test(n)) return 'front';
  if (/(^|[-_])side([-_.]|$)/.test(n)) return 'side';
  if (/(^|[-_])back([-_.]|$)/.test(n)) return 'back';
  return null;
}

function isArm(name) {
  return /(^|[-_])arm([-_.]|$)/i.test(name);
}

function styleIdFromFile(file, folder) {
  let base = basename(file, extname(file));
  base = base.replace(/[-_](front|side|back|arm)/gi, '');
  base = base.replace(/[-_]+$/g, '');
  return `${folder}/${base || folder}`;
}

function loadManifest() {
  const p = join(PACK, 'pack-manifest.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function prettyLabel(meta, styleId, folder) {
  const rest = styleId.slice(folder.length + 1);
  if (!rest || rest === folder) return meta.label;
  return `${meta.label} · ${rest.replace(/[-_]/g, ' ')}`;
}

function main() {
  mkdirSync(dirname(OUT), { recursive: true });

  if (!existsSync(PACK)) {
    console.error('Missing', PACK, '— run copy-creator-from-sim.mjs first');
    writeFileSync(
      OUT,
      JSON.stringify(
        {
          version: 1,
          source: 'living-food-chain-sim',
          status: 'empty',
          message: 'Creator pack not copied yet',
          zOrder: ['body', 'underwear', 'shirt', 'pants', 'apron', 'coat', 'hair'],
          bodies: { realism: [], chibi: [] },
          underwear: [],
          clothes: [],
          hair: [],
          counts: { pngs: 0, clothes: 0, hair: 0, realismBodies: 0, chibiBodies: 0, underwear: 0 },
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  const manifest = loadManifest();
  const allPngs = walk(PACK).filter((p) => extname(p).toLowerCase() === '.png');
  const rel = (p) => relative(join(ROOT, 'public'), p).split('\\').join('/');

  const bodies = { realism: [], chibi: [] };
  const underwear = [];
  const hair = [];
  const clothesById = new Map();

  for (const abs of allPngs) {
    const r = rel(abs);
    const parts = r.split('/');
    const name = basename(abs);
    const view = viewFromName(name);
    const arm = isArm(name);

    if (/^creator\/hires-pack\/body-(male|female)-(front|side|back)\.png$/i.test(r)) {
      const m = r.match(/body-(male|female)-(front|side|back)/i);
      bodies.realism.push({
        id: `body-${m[1]}-${m[2]}`,
        sex: m[1].toLowerCase(),
        view: m[2].toLowerCase(),
        path: r,
        label: `${m[1]} ${m[2]}`,
      });
      continue;
    }

    if (r.includes('/mannequin/')) {
      bodies.realism.push({
        id: `mannequin-${name.replace(/\.png$/i, '')}`,
        sex: /female/i.test(name) ? 'female' : /male/i.test(name) ? 'male' : 'neutral',
        view: view || 'front',
        path: r,
        label: `Mannequin ${name.replace(/\.png$/i, '')}`,
        mannequin: true,
      });
      continue;
    }

    if (r.includes('/chibi-living/')) {
      if (view && view !== 'front') continue;
      bodies.chibi.push({
        id: `chibi-${name.replace(/\.png$/i, '')}`,
        sex: /female/i.test(name) ? 'female' : /male/i.test(name) ? 'male' : 'neutral',
        view: 'front',
        path: r,
        label: name.replace(/\.png$/i, ''),
      });
      continue;
    }

    if (r.includes('/underwear/')) {
      underwear.push({
        id: `underwear-${name.replace(/\.png$/i, '')}`,
        view: view || 'front',
        path: r,
        label: name.replace(/\.png$/i, ''),
        slot: 'underwear',
        arm,
      });
      continue;
    }

    if (/^creator\/hires-pack\/hair-(bun|wavy|short)-(front|side|back)\.png$/i.test(r)) {
      const m = name.match(/hair-(bun|wavy|short)-(front|side|back)/i);
      const style = m[1].toLowerCase();
      const v = m[2].toLowerCase();
      let item = hair.find((h) => h.style === style && h.source === 'tint-map');
      if (!item) {
        item = {
          id: `hair-${style}`,
          style,
          source: 'tint-map',
          label: style.charAt(0).toUpperCase() + style.slice(1),
          group: 'Hair',
          slot: 'hair',
          views: {},
          arms: {},
        };
        hair.push(item);
      }
      item.views[v] = r;
      continue;
    }

    if (r.includes('/hair-class/') || r.includes('/hair-collection/')) {
      const collection = r.includes('/hair-class/') ? 'hair-class' : 'hair-collection';
      const style = name.replace(/\.png$/i, '').replace(/[-_](front|side|back|arm)/gi, '');
      const id = `${collection}/${style}`;
      let item = hair.find((h) => h.id === id);
      if (!item) {
        item = {
          id,
          style,
          source: collection,
          label: style.replace(/[-_]/g, ' '),
          group: collection === 'hair-class' ? 'Hair class' : 'Hair collection',
          slot: 'hair',
          views: {},
          arms: {},
        };
        hair.push(item);
      }
      if (arm && view) item.arms[view] = r;
      else if (view) item.views[view] = r;
      else item.views.front = item.views.front || r;
      continue;
    }

    if (r.includes('/closet/')) {
      const idx = parts.indexOf('closet');
      const folder = parts[idx + 1];
      const meta = CLOSET_FOLDER_META[folder];
      if (!meta) {
        console.warn('Unknown closet folder', folder, r);
        continue;
      }
      const styleId = styleIdFromFile(name, folder);
      let item = clothesById.get(styleId);
      if (!item) {
        item = {
          id: styleId,
          folder,
          slot: meta.slot,
          group: meta.group,
          label: prettyLabel(meta, styleId, folder),
          views: {},
          arms: {},
        };
        clothesById.set(styleId, item);
      }
      if (arm && view) item.arms[view] = r;
      else if (view) item.views[view] = r;
      else item.views.front = item.views.front || r;
    }
  }

  const clothes = [...clothesById.values()];

  if (manifest) {
    const labelMap = manifest.labels || manifest.items || manifest.closet || null;
    if (labelMap && typeof labelMap === 'object') {
      for (const item of clothes) {
        const hit = labelMap[item.id] || labelMap[item.folder] || labelMap[item.label];
        if (typeof hit === 'string') item.label = hit;
        else if (hit && hit.label) item.label = hit.label;
      }
    }
  }

  clothes.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  hair.sort((a, b) => a.label.localeCompare(b.label));
  bodies.realism.sort((a, b) => a.id.localeCompare(b.id));
  bodies.chibi.sort((a, b) => a.id.localeCompare(b.id));

  const catalog = {
    version: 1,
    source: 'living-food-chain-sim',
    status: allPngs.length ? 'ready' : 'empty',
    zOrder: ['body', 'underwear', 'shirt', 'pants', 'apron', 'coat', 'hair'],
    slotLabels: {
      body: 'Body',
      underwear: 'Underwear',
      shirt: 'Shirt',
      pants: 'Pants',
      apron: 'Apron',
      coat: 'Coat',
      hair: 'Hair',
    },
    groups: [
      'Shirt',
      'Bottoms A',
      'Bottoms B',
      'Class bottoms',
      'Apron',
      'Coat',
      'Uniforms',
      'Hair',
      'Hair class',
      'Hair collection',
    ],
    bodies,
    underwear,
    clothes,
    hair,
    counts: {
      pngs: allPngs.length,
      clothes: clothes.length,
      hair: hair.length,
      realismBodies: bodies.realism.length,
      chibiBodies: bodies.chibi.length,
      underwear: underwear.length,
    },
    manifestPresent: !!manifest,
  };

  writeFileSync(OUT, JSON.stringify(catalog, null, 2));
  console.log('Wrote', OUT, catalog.counts);
}

main();
