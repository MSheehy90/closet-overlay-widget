import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '../public/fixtures');
mkdirSync(outDir, { recursive: true });

function writePng(name: string, w: number, h: number, paint: (x: number, y: number, set: (r: number, g: number, b: number, a?: number) => void) => void) {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = 236, g = 232, b = 224, a = 255; // studio
      const set = (nr: number, ng: number, nb: number, na = 255) => {
        r = nr; g = ng; b = nb; a = na;
      };
      paint(x, y, set);
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = a;
    }
  }
  // Chrome: hex chip + label ticks
  const stampChrome = () => {
    // hex chip bottom-right
    for (let y = h - 28; y < h - 8; y++) {
      for (let x = w - 70; x < w - 10; x++) {
        const i = (y * w + x) * 4;
        png.data[i] = 40;
        png.data[i + 1] = 40;
        png.data[i + 2] = 40;
        png.data[i + 3] = 255;
      }
    }
    // tick marks top
    for (let x = 8; x < 80; x += 6) {
      for (let y = 4; y < 14; y++) {
        const i = (y * w + x) * 4;
        png.data[i] = 30;
        png.data[i + 1] = 30;
        png.data[i + 2] = 30;
        png.data[i + 3] = 255;
      }
    }
  };
  stampChrome();
  writeFileSync(join(outDir, name), PNG.sync.write(png));
  console.log('wrote', name, w, h);
}

// Studio sheet with figure + detached arm + hair mass + green mannequin
writePng('cleanup-studio.png', 420, 520, (x, y, set) => {
  // Main figure body (skin/cloth) — includes white fabric
  const inBody =
    x > 150 && x < 270 && y > 140 && y < 460 &&
    !(x > 180 && x < 240 && y > 200 && y < 280); // torso hole? no — keep solid, fill holes OFF means we don't fill
  const inHead = (x - 210) ** 2 / 35 ** 2 + (y - 110) ** 2 / 40 ** 2 < 1;
  // Hair above skull — must not be skull-cropped
  const inHair =
    (x - 210) ** 2 / 55 ** 2 + (y - 70) ** 2 / 45 ** 2 < 1 && y < 120;
  // White shirt fabric
  const inShirt = x > 165 && x < 255 && y > 160 && y < 260;
  // Detached arm (gap from body)
  const inArm = x > 40 && x < 90 && y > 200 && y < 360;
  // Green mannequin on the right
  const inGreen =
    x > 320 && x < 390 && y > 120 && y < 450;

  if (inHair) set(45, 28, 18);
  else if (inHead) set(220, 175, 145);
  else if (inShirt) set(250, 250, 250); // white fabric — never key
  else if (inBody) set(55, 70, 120); // blue pants/cloth
  else if (inArm) set(220, 175, 145);
  else if (inGreen) {
    // shaded green
    const shade = 0.55 + 0.35 * ((x - 320) / 70);
    set(Math.round(40 * shade), Math.round(160 * shade), Math.round(70 * shade));
  }
});

// Overlay layer fixtures (transparent PNG figures)
function writeLayer(name: string, w: number, h: number, paint: (x: number, y: number, set: (r: number, g: number, b: number, a?: number) => void) => void) {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = 0, g = 0, b = 0, a = 0;
      const set = (nr: number, ng: number, nb: number, na = 255) => {
        r = nr; g = ng; b = nb; a = na;
      };
      paint(x, y, set);
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = a;
    }
  }
  writeFileSync(join(outDir, name), PNG.sync.write(png));
  console.log('wrote', name);
}

writeLayer('body.png', 256, 512, (x, y, set) => {
  const cx = 128;
  if ((x - cx) ** 2 / 40 ** 2 + (y - 70) ** 2 / 48 ** 2 < 1) set(230, 180, 150);
  if (x > 88 && x < 168 && y > 110 && y < 300) set(230, 180, 150);
  if (x > 95 && x < 125 && y > 300 && y < 470) set(230, 180, 150);
  if (x > 131 && x < 161 && y > 300 && y < 470) set(230, 180, 150);
  // arms on body
  if (x > 50 && x < 90 && y > 130 && y < 280) set(230, 180, 150);
  if (x > 166 && x < 206 && y > 130 && y < 280) set(230, 180, 150);
});

writeLayer('shirt.png', 256, 512, (x, y, set) => {
  if (x > 90 && x < 166 && y > 120 && y < 270) set(200, 70, 70);
});

writeLayer('pants.png', 256, 512, (x, y, set) => {
  if (x > 95 && x < 125 && y > 265 && y < 460) set(50, 60, 110);
  if (x > 131 && x < 161 && y > 265 && y < 460) set(50, 60, 110);
  if (x > 95 && x < 161 && y > 250 && y < 290) set(50, 60, 110);
});

writeLayer('hair.png', 256, 512, (x, y, set) => {
  if ((x - 128) ** 2 / 58 ** 2 + (y - 55) ** 2 / 50 ** 2 < 1 && y < 120) set(40, 25, 18);
});

writeLayer('hair-tint-map.png', 256, 512, (x, y, set) => {
  if ((x - 128) ** 2 / 58 ** 2 + (y - 55) ** 2 / 50 ** 2 < 1 && y < 120) {
    const v = Math.round(180 + 75 * ((x - 70) / 116));
    set(v, v, v);
  }
});

console.log('fixtures ready in', outDir);
