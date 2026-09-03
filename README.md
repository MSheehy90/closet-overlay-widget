# Closet Overlay

Standalone phone PWA for clothes/hair **Cleanup** and **Overlay**. Not Railway. Not inside living-food-chain-sim.

**Live:** https://msheehy90.github.io/closet-overlay-widget/

## Tabs

### Cleanup (locked)

1. Load sheet or PNG
2. **Wand wrap FIRST** — flood studio from edges; wrap whole figures, hair, detached arms; split on gaps; never a grid; never key before wrap
3. **Key leftover studio outside wraps only** — fill holes off; never key interior cloth, hair, or white fabric
4. **Strip chrome** — labels, hex chips, ticks, dashes
5. **Green mannequin** — after studio key, align green wrap to selected body dest rect, then key shaded green and defringe ~48 on keyed border only
6. **Hair** — never crop to skull; hair-aware top
7. **Export** — tight bbox, 4px pad, native resolution
8. **Detached arm** — no overlay on front/back if arm already on body; side only if that view is missing the near arm

### Overlay

- Realism vs Chibi bases (chibi front only; do not invent side/back)
- Slots combine: body → underwear → shirt → pants → apron → coat → hair
- Nudge x / y / scale per slot
- Hair tint + optional tint map
- Checker or dark stage
- Export stacked PNG and per-layer PNGs
- Empty slots until you drop files — does not invent clothes, hair, or bodies
- No Kenney 64

## Develop

```bash
npm install
npm run dev
npm run build
```

Vite `base` is `/closet-overlay-widget/` for GitHub Pages.

## Publish

Built site is served from the `gh-pages` branch (contents of `dist/`).
