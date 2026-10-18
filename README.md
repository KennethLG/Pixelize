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
| `src/core/` | Pure logic with no DOM (`shading.ts`: ramps, shading, palette snapping, variants; `lint.ts`: the checks): grid detection, cell sampling, palette, cleanup, background, crop, the `processImage` pipeline, frame splitting, playback order, the fake-image generator, and the sprite editor's document (`sprite.ts`: layers, frames, compositing, saving) and pixel operations (`bitmap.ts`: brush, lines, rectangles, fill, selections, moving and scaling pieces). Shared by the page, its worker, the CLI and the tests. |
| `src/export/` | GIF and ZIP writers (bytes in, bytes out). |
| `src/worker.ts` | Runs `processImage` off the main thread. |
| `src/main.tsx`, `src/ui/Page.tsx` | Start-up, and the React page: the header and both modes. |
| `src/ui/` | Pixelize state and logic, one module each: `app` (state, processing loop, events), `settings`, `steps`, `mode`, `editor` (the result editor engine), `anim` (frames, playback, align view, exports), `palette`, `downloads`, `batch`, `input`, `processing` (the worker), `bus` (events React can follow), `keys` (the shortcut registry), `theme`. |
| `src/ui/pixelize/` | The Pixelize mode's React components: the step bar, one panel per step, the workspace (drop zone, stats, original and result, palette, animation) and form fields bound to the settings. |
| `src/ui/components/` | Components shared by both modes: segmented control, swatch, number field, the in-app HSV color picker, drag-to-reorder, the Options dialog. |
| `src/ui/sprite/` | The sprite editor: `components/` (one per panel: top bar, tools, tool options, canvas, color, palettes, layers, timeline), `state` (document, selection, undo, events), `hooks` (`useSp`), `canvas` (the drawing engine: view, rendering, tools), `actions`, `animation` (playback, quick flip, cels, tags, mirror), `io` (open, save, export, clipboard, autosave), `prefs`, `shortcuts`, `mount`. |
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
- **Editor:** pencil, eraser, fill and eyedropper, the in-app color picker, undo/redo, zoom/pan, a pixel grid and a before/after slider.
- **Spritesheets:** auto or grid split, drag to reorder, per-frame duration, onion skin, forward/reverse/ping-pong playback with loop or stop. An align view shows the selected frame large over a ghost of the previous (or first) frame with center lines: drag it or use the arrow keys to move it pixel by pixel. Moved frames grow the canvas instead of being cut.
- **Exports:** PNG (1× or scaled), `_stripN.png` strip (GameMaker splits it on import), sheet with columns and padding, frames ZIP, animated GIF.
- **Batch** processing to a ZIP, and settings remembered in the browser.

### Sprite editor

- **Tools:** pencil and eraser with a brush size (the pencil can be "pixel perfect": no L-shaped corners in freehand strokes), line (Shift for straight or 45°), paint bucket (fill an area, or replace a color on the layer in this frame or in every frame), rectangle and ellipse (outline or filled, Shift for squares and circles), eyedropper.
- **Symmetry and tiles:** mirror the drawing tools left/right and top/bottom across the canvas center. Tile mode shows 3 × 3 copies of the canvas and wraps strokes around the edges, for seamless tiles.
- **Outline:** one click outlines the art on the layer (or the selected art) with the primary color; Shift+click also fills the diagonal corners. Left click draws with the primary color, right click with the secondary one; Shift+click draws a straight line, Alt+click picks a color.
- **Canvas size:** with the Canvas tool, drag the squares on the edges of the paper to resize it live, either keeping the art's pixel size (adding or cutting space on that side) or stretching the art with it. The size fields in the top bar do the same, keeping the art centered.
- **Selections:** rectangle select and select by color (Shift adds, Alt subtracts). Drag a selection to move it, drag its squares to resize it (Shift keeps the proportions), or use ×2, ½, the flips and the quarter and half turns. Cut, copy and paste, also with images from other apps.
- **Colors:** an in-app color picker with hex input, the colors used in the sprite, and your own palette (add colors, or load a Lospec .hex, .gpl or PNG palette).
- **Smart palette:** build hue-shifted ramps from a color (shadows turn toward blue, highlights toward yellow) and save them. The shading brush (D) makes each pixel one step lighter (left click) or darker (right click) along its ramp, or along My palette in its order. "Lock to my palette" snaps everything you paint, fill or paste to the closest color of My palette.
- **Check:** lists orphan pixels, jaggies (doubled corners in 1 px lines), banding and colors that are almost the same, for this frame or all of them. Click one to go to it; the canvas rings every problem while the panel is open, and the list updates as you fix them.
- **Variants:** color swaps of the whole sprite (red team, blue team…), saved with the project. Show one on the canvas, and export the original and every variant at once (strips, GIFs or the current frame) in a ZIP.
- **Layers:** add, duplicate, delete, merge down, hide, rename (double click), opacity, and drag to reorder. "Ref" adds an image as a reference layer: it shows (half transparent) while you draw but is left out of the exports, thumbnails and colors in use.
- **Timeline:** a grid of layers × frames with a thumbnail per cel. Click a cel to edit it, drag frame numbers to reorder, Shift+click to select a range of frames (durations and pasted cels apply to the whole range). Copy a cel and paste it into other frames; Alt+arrows move the whole frame.
- **Tags:** name a run of frames (idle, walk…) with its own direction (forward, reverse, ping-pong). The preview plays the current frame's tag; Strip and GIF can export one tag. "Mirror" adds left/right flipped copies of the selected frames (or of a tag, which gets its own mirrored tag).
- **Animation help:** onion skin with several frames behind (red) and ahead (blue) and adjustable opacity; hold Q to flip to the previous frame; a floating preview at game scale (1×–6×) over the checkerboard, the paper color or a background image.
- **Paper and grid:** draw over a checkerboard or a flat color (picked with the app's color picker; only for viewing, exports keep transparency), with the pixel grid and an optional bigger grid (for example 16 × 16 tiles). The editor fills the window, with the tools as icons on the left.
- **Files:** open a PNG (a `_stripN.png` opens as N frames) or a `.pixelize` project, save the project, export the frame as PNG, all frames as a GameMaker strip, or a GIF. The last sprite is kept in the browser. "Edit in the sprite editor" on the Pixelize Export step sends the result (or its animation frames) over.

Every shortcut can be changed in Options (⚙ in the header), which also sets the theme. Defaults in the sprite editor: B pencil, E eraser, L line, D shading brush, G bucket, U rectangle, O ellipse, I eyedropper, M select, W select by color, V move, C canvas size, H hand, X swap colors, [ ] brush size, Ctrl+A/D select all/none, Ctrl+C/X/V, Delete, Enter puts a moved selection down, Esc deselects, arrow keys nudge the selection, , and . previous/next frame, P play, Q (hold) previous frame, N new frame, Shift+N duplicate frame, Shift+C / Shift+V copy / paste cel, Shift+O onion skin, Alt+arrows move the frame.

Pixelize shortcuts: H move, B pencil, E eraser, G fill, I eyedropper (Touch up step), +/− zoom, 0 fit, Space drag to pan, Ctrl+Z / Ctrl+Y undo/redo, arrow keys move the selected frame (Animation step).
