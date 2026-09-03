#!/usr/bin/env node
/**
 * Copy creator closet binaries from living-food-chain-sim → closet-overlay-widget
 * via GitHub Contents API (base64 GET/PUT). Does not invent pixels.
 *
 * Auth: GH_TOKEN / GITHUB_TOKEN / LIVING_FOOD_CHAIN_SIM_READ_TOKEN
 * Optional DEST_TOKEN for writes (defaults to same token).
 *
 * Usage:
 *   node scripts/copy-creator-from-sim.mjs
 *   node scripts/copy-creator-from-sim.mjs --dry-run
 *   node scripts/copy-creator-from-sim.mjs --local-only   # write to disk only (git add later)
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_REPO = process.env.SRC_REPO || 'MSheehy90/living-food-chain-sim';
const DEST_REPO = process.env.DEST_REPO || 'MSheehy90/closet-overlay-widget';
const SRC_REF = process.env.SRC_REF || 'main';
const DEST_BRANCH = process.env.DEST_BRANCH || 'main';
const DRY = process.argv.includes('--dry-run');
const LOCAL_ONLY = process.argv.includes('--local-only') || process.argv.includes('--local');

const READ_TOKEN =
  process.env.LIVING_FOOD_CHAIN_SIM_READ_TOKEN ||
  process.env.GH_PAT ||
  process.env.GH_TOKEN ||
  process.env.GITHUB_TOKEN ||
  '';
const WRITE_TOKEN = process.env.DEST_TOKEN || READ_TOKEN;

const PREFIXES = [
  'assets/creator/hires-pack/closet',
  'assets/creator/hires-pack/mannequin',
  'assets/creator/hires-pack/chibi-living',
  'assets/creator/hires-pack/hair-class',
  'assets/creator/hires-pack/hair-collection',
  'assets/creator/hires-pack/underwear',
  'assets/creator/hires-pack/pack-manifest.json',
];

const BODY_GLOBS = [
  'assets/creator/hires-pack/body-male-front.png',
  'assets/creator/hires-pack/body-male-side.png',
  'assets/creator/hires-pack/body-male-back.png',
  'assets/creator/hires-pack/body-female-front.png',
  'assets/creator/hires-pack/body-female-side.png',
  'assets/creator/hires-pack/body-female-back.png',
  'assets/creator/hires-pack/hair-bun-front.png',
  'assets/creator/hires-pack/hair-bun-side.png',
  'assets/creator/hires-pack/hair-bun-back.png',
  'assets/creator/hires-pack/hair-wavy-front.png',
  'assets/creator/hires-pack/hair-wavy-side.png',
  'assets/creator/hires-pack/hair-wavy-back.png',
  'assets/creator/hires-pack/hair-short-front.png',
  'assets/creator/hires-pack/hair-short-side.png',
  'assets/creator/hires-pack/hair-short-back.png',
];

function apiHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'closet-overlay-asset-copy',
  };
}

async function api(repo, path, { method = 'GET', token = READ_TOKEN, body } = {}) {
  const url = `https://api.github.com/repos/${repo}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      ...apiHeaders(token),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${method} ${url} → ${res.status}: ${json?.message || text.slice(0, 200)}`);
    err.status = res.status;
    err.json = json;
    throw err;
  }
  return json;
}

async function listDir(repo, path, ref) {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const data = await api(repo, `/contents/${path}${q}`);
  if (!Array.isArray(data)) return [data];
  return data;
}

async function walk(repo, path, ref, acc = []) {
  let entries;
  try {
    entries = await listDir(repo, path, ref);
  } catch (e) {
    if (e.status === 404) {
      console.warn('skip missing', path);
      return acc;
    }
    throw e;
  }
  for (const ent of entries) {
    if (ent.type === 'dir') {
      await walk(repo, ent.path, ref, acc);
    } else if (ent.type === 'file') {
      acc.push(ent);
    }
  }
  return acc;
}

function destPathFor(srcPath) {
  // assets/creator/hires-pack/... → public/creator/hires-pack/...
  if (srcPath.startsWith('assets/creator/')) {
    return 'public/creator/' + srcPath.slice('assets/creator/'.length);
  }
  return 'public/creator/' + srcPath;
}

async function getFileBase64(repo, path, ref) {
  const q = `?ref=${encodeURIComponent(ref)}`;
  const data = await api(repo, `/contents/${path}${q}`);
  if (data.encoding === 'base64' && data.content) {
    return { content: data.content.replace(/\n/g, ''), sha: data.sha, size: data.size };
  }
  // Large files may need git blob API
  if (data.sha && (!data.content || data.encoding === 'none')) {
    const blob = await api(repo, `/git/blobs/${data.sha}`);
    if (blob.encoding !== 'base64') throw new Error(`blob ${path} not base64`);
    return { content: blob.content.replace(/\n/g, ''), sha: data.sha, size: blob.size };
  }
  throw new Error(`Cannot read content for ${path}`);
}

async function putFile(repo, path, branch, base64Content, message) {
  let sha;
  try {
    const existing = await api(repo, `/contents/${path}?ref=${encodeURIComponent(branch)}`, {
      token: WRITE_TOKEN,
    });
    sha = existing.sha;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  return api(repo, `/contents/${path}`, {
    method: 'PUT',
    token: WRITE_TOKEN,
    body: {
      message,
      content: base64Content,
      branch,
      ...(sha ? { sha } : {}),
    },
  });
}

function writeLocal(relPath, base64Content) {
  const abs = join(ROOT, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, Buffer.from(base64Content, 'base64'));
}

async function collectSourceFiles() {
  const files = [];
  for (const p of PREFIXES) {
    if (p.endsWith('.json') || p.endsWith('.png')) {
      try {
        const meta = await listDir(SRC_REPO, p, SRC_REF);
        files.push(...(Array.isArray(meta) ? meta : [meta]).filter((e) => e.type === 'file'));
      } catch (e) {
        if (e.status === 404) console.warn('missing file', p);
        else throw e;
      }
      continue;
    }
    await walk(SRC_REPO, p, SRC_REF, files);
  }
  for (const p of BODY_GLOBS) {
    try {
      const meta = await listDir(SRC_REPO, p, SRC_REF);
      const list = Array.isArray(meta) ? meta : [meta];
      for (const ent of list) {
        if (ent.type === 'file' && !files.some((f) => f.path === ent.path)) files.push(ent);
      }
    } catch (e) {
      if (e.status === 404) console.warn('missing optional', p);
      else throw e;
    }
  }
  // Also scan hires-pack root for any underwear / extra hair / pack-manifest we missed
  try {
    const root = await listDir(SRC_REPO, 'assets/creator/hires-pack', SRC_REF);
    for (const ent of root) {
      if (ent.type === 'file' && /\.(png|json)$/i.test(ent.name)) {
        if (!files.some((f) => f.path === ent.path)) files.push(ent);
      }
    }
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  return files.filter((f) => /\.(png|json)$/i.test(f.path));
}

async function main() {
  if (!READ_TOKEN && !DRY) {
    console.error('No READ_TOKEN. Set LIVING_FOOD_CHAIN_SIM_READ_TOKEN or GH_TOKEN.');
    process.exit(2);
  }
  console.log('Source', SRC_REPO, '@', SRC_REF);
  console.log('Dest', DEST_REPO, 'branch', DEST_BRANCH, LOCAL_ONLY ? '(local disk)' : '(api PUT)');

  // Probe access
  try {
    const repo = await api(SRC_REPO, '');
    console.log('Source accessible:', repo.full_name, 'private=', repo.private);
  } catch (e) {
    console.error('Cannot access source repo:', e.message);
    process.exit(3);
  }

  const files = await collectSourceFiles();
  console.log('Found', files.length, 'files');
  if (DRY) {
    for (const f of files) console.log(' ', f.path, f.size);
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const f of files) {
    const dest = destPathFor(f.path);
    try {
      const { content } = await getFileBase64(SRC_REPO, f.path, SRC_REF);
      writeLocal(dest, content);
      if (!LOCAL_ONLY) {
        await putFile(
          DEST_REPO,
          dest,
          DEST_BRANCH,
          content,
          `Copy creator asset ${posix.basename(f.path)} from living-food-chain-sim`,
        );
      }
      ok++;
      if (ok % 10 === 0) console.log(`… ${ok}/${files.length}`);
    } catch (e) {
      fail++;
      console.error('FAIL', f.path, e.message);
    }
  }
  console.log(`Done. ok=${ok} fail=${fail}`);
  // Marker for catalog builder
  writeFileSync(
    join(ROOT, 'public/creator/COPY_META.json'),
    JSON.stringify({ source: SRC_REPO, ref: SRC_REF, copied: ok, failed: fail, at: new Date().toISOString() }, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
