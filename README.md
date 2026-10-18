# Pixelize

Two tools in one app, switched from the top right:

- **Pixelize an image** turns fake pixel art (AI images with big simulated pixels of uneven size and slightly shifting colors) into real pixel art at its true resolution, then lets you touch it up, fix the palette and build the animation.
- **Sprite editor** draws and animates sprites from scratch, with layers and frames.

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
| `src/core/` | Pure logic with no DOM: grid detection, cell sampling, palette, cleanup, background, crop, the `processImage` pipeline, frame splitting, playback order, the fake-image generator, and the sprite editor's document (`sprite.ts`: layers, frames, compositing, saving) and pixel operations (`bitmap.ts`: brush, lines, rectangles, fill, selections, moving and scaling pieces). Shared by the page, its worker, the CLI and the tests. |
| `src/export/` | GIF and ZIP writers (bytes in, bytes out). |
| `src/worker.ts` | Runs `processImage` off the main thread. |
| `src/ui/` | One module per part of the page: `mode` (Pixelize or Sprite editor), `app` (state and processing loop), `steps` (the step-by-step flow), `controls`, `views`, `editor`, `palettePanel`, `anim`, `downloads`, `batch`, `settings`, `input`. |
| `index.html` + `src/html/` | The Pixelize mode's markup. `index.html` is only the skeleton; each part lives in a partial (`header.html`, `pixelize/<step>.html` and the workspace pieces) pulled in with `<!-- @include path -->`. A small plugin in `vite.config.ts` inlines them at build time, so the output is still one HTML file. |
| `src/ui/sprite/` | The sprite editor, in React: `components/` (one per panel: top bar, tools, tool options, canvas, color, palettes, layers, timeline, plus shared pieces), `state` (document, selection, undo, events), `hooks` (`useSp`), `canvas` (the drawing engine: view, rendering, tools), `actions`, `io` (open, save, export, clipboard, autosave), `prefs`, `shortcuts`, `mount`. |
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

### Sprite editor

- **Tools:** pencil and eraser with a brush size, paint bucket (fill an area, or replace a color on the layer in this frame or in every frame), rectangle and ellipse (outline or filled, Shift for squares and circles), eyedropper. Left click draws with the primary color, right click with the secondary one; Shift+click draws a straight line, Alt+click picks a color.
- **Canvas size:** with the Canvas tool, drag the squares on the edges of the paper to resize it live, either keeping the art's pixel size (adding or cutting space on that side) or stretching the art with it. The size fields in the top bar do the same, keeping the art centered.
- **Selections:** rectangle select and select by color (Shift adds, Alt subtracts). Drag a selection to move it, drag its squares to resize it (Shift keeps the proportions), or use ×2, ½ and the flips. Cut, copy and paste, also with images from other apps.
- **Colors:** an in-app color picker with hex input, the colors used in the sprite, and your own palette (add colors, or load a Lospec .hex, .gpl or PNG palette).
- **Layers:** add, duplicate, delete, merge down, hide, rename (double click), opacity, and drag to reorder.
- **Frames:** add, duplicate, delete, per-frame duration, drag to reorder, onion skin and a live preview.
- **Paper and grid:** draw over a checkerboard or a flat color (picked with the app's color picker; only for viewing, exports keep transparency), with the pixel grid and an optional bigger grid (for example 16 × 16 tiles). The editor fills the window, with the tools as icons on the left.
- **Files:** open a PNG (a `_stripN.png` opens as N frames) or a `.pixelize` project, save the project, export the frame as PNG, all frames as a GameMaker strip, or a GIF. The last sprite is kept in the browser. "Edit in the sprite editor" on the Pixelize Export step sends the result (or its animation frames) over.

Sprite editor shortcuts: B pencil, E eraser, G bucket, U rectangle, O ellipse, I eyedropper, M select, W select by color, V move, C canvas size, H hand, X swap colors, [ ] brush size, Ctrl+A/D select all/none, Ctrl+C/X/V, Delete, Enter puts a moved selection down, Esc deselects, arrow keys nudge the selection, , and . previous/next frame, P play.

Pixelize shortcuts: H move, B pencil, E eraser, G fill, I eyedropper (Touch up step), +/− zoom, 0 fit, Space drag to pan, Ctrl+Z / Ctrl+Y undo/redo, arrow keys move the selected frame (Animation step).
