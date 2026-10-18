# Pixelize

Turns fake pixel art (AI images with big simulated pixels of uneven size and slightly shifting colors) into real pixel art at its true resolution, then lets you touch it up, fix the palette and build the animation.

## Use it

- **Web:** open `dist/pixelize.html` (build it first) or the published page. Everything runs in the browser.
- **Desktop (Windows):** `npm run desktop:dist` builds `release/Pixelize Setup <version>.exe` (installer) and `release/Pixelize-<version>-portable.exe`. `npm run desktop` runs it without packaging.
- **Terminal:** `npm run cli -- image.png` writes `image_pixel.png` and a scaled preview. `npm run cli -- --help` lists the options.

## Develop

```
npm install
npm run dev      # live page at http://localhost:5173
npm test         # core tests (detection, palette, background, GIF, ZIP, playback)
npm run build    # type-check, then bundle everything into dist/pixelize.html
```

## Layout

| Folder | What lives there |
| --- | --- |
| `src/core/` | Pure logic with no DOM: grid detection, cell sampling, palette, cleanup, background, crop, the `processImage` pipeline, frame splitting, playback order, the fake-image generator. Shared by the page, its worker, the CLI and the tests. |
| `src/export/` | GIF and ZIP writers (bytes in, bytes out). |
| `src/worker.ts` | Runs `processImage` off the main thread. |
| `src/ui/` | One module per part of the page: `app` (state and processing loop), `steps` (the step-by-step flow), `controls`, `views`, `editor`, `palettePanel`, `anim`, `downloads`, `batch`, `settings`, `input`. |
| `cli/` | The terminal tool. |
| `test/` | Vitest tests plus helpers (regular grids, an independent GIF decoder). |
| `scripts/postbuild.mjs` | Strips the document skeleton from the build so it publishes as an artifact, and keeps the full document in `dist/desktop/` for Electron. |
| `electron/` | The desktop shell: a window that loads `dist/desktop/index.html`, with native save dialogs. |
| `build/` | App icon (`icon.png`, 512×512) and the generated image it was cropped from. |

## Features

The page walks through seven steps: Image, Pixels, Colors, Background & crop, Touch up (optional), Animation (optional) and Export. Each step only shows its own settings; the later steps unlock once an image is loaded.

- **Grid:** auto detection with a confidence rating; manual cell size (separate X/Y, sliders, offset, snap to edges); or an exact output size.
- **Colors:** auto tolerance, a fixed count, or snapping to an imported palette (PNG, .hex, .gpl or pasted hex codes). Colors can be locked, replaced or merged, and stray noise pixels cleaned.
- **Background removal** by edge flood fill or by color, with a tolerance, and a picker to choose the background on the image.
- **Crop:** trim the empty space around the art (keeping a margin), or cut fixed margins from each side.
- **Editor:** pencil, eraser, fill and eyedropper, with undo/redo, zoom/pan, a pixel grid and a before/after slider.
- **Spritesheets:** auto or grid split, drag to reorder, per-frame duration, onion skin, forward/reverse/ping-pong playback with loop or stop. An align view shows the selected frame large over a ghost of the previous (or first) frame with center lines: drag it or use the arrow keys to move it pixel by pixel. Moved frames grow the canvas instead of being cut.
- **Exports:** PNG (1× or scaled), `_stripN.png` strip (GameMaker splits it on import), sheet with columns and padding, frames ZIP, animated GIF.
- **Batch** processing to a ZIP, and settings remembered in the browser.

Shortcuts: H move, B pencil, E eraser, G fill, I eyedropper (Touch up step), +/− zoom, 0 fit, Space drag to pan, Ctrl+Z / Ctrl+Y undo/redo, arrow keys move the selected frame (Animation step).
