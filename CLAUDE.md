# CLAUDE.md

Pixelize converts fake AI pixel art into real pixel art, and has a sprite editor. Vite + TypeScript + React. See README.md for the folder layout and features.

## Commands

- `npm test`: Vitest on the core. Run it after any change in `src/core/` or `src/export/`.
- `npm run build`: `tsc`, then Vite bundles everything (CSS, JS and the inline worker) into `dist/pixelize.html`.
- `npm run cli -- <image> [options]`: the terminal tool (runs `cli/pixelize.ts` with tsx).
- `npm run desktop` / `npm run desktop:dist`: run the Electron app / build the Windows installer and portable exe into `release/` (git-ignored). `electron/main.cjs` only wraps `dist/desktop/index.html`; keep app logic out of it so the web page and the desktop app stay the same code.
- `npm run image -- "<prompt>" [options]`: generates images with the OpenAI Images API (`cli/generate-image.mjs`, plain Node, needs `OPENAI_API_KEY`; `--help` lists the options). Output goes to `generated/` (git-ignored) unless `--out` says otherwise.

## Rules

- `src/core/` and `src/export/` stay pure (no DOM, no `window`), so the worker, the CLI and the tests can use them. Anything that touches the page goes in `src/ui/`.
- React 19 with `@vitejs/plugin-react` 4.7 (the last line that supports Vite 5). After installing or upgrading React, delete `node_modules/.vite` and restart `npm run dev`, or the dev server can serve two copies of React ("Invalid hook call").
- The page is one React tree (`src/ui/Page.tsx`, mounted by `src/main.tsx` into `#root`): the header, the Pixelize mode (`src/ui/pixelize/`) and the sprite editor (`src/ui/sprite/components/`). Both modes stay mounted and only the open one shows, so each keeps its state and canvases. Shared components (segmented control, swatch, number field, HSV picker, drag-to-reorder) live in `src/ui/components/`.
- State lives in plain modules, not in React: Pixelize in `app.ts`, `settings.ts`, `steps.ts`, `editor.ts`, `anim.ts`, `palette.ts`; the sprite editor in `sprite/state.ts`. They announce changes with events, and components re-render with a hook, then read the module directly: `pxBus.use('result', …)` for Pixelize (events listed at the top of `app.ts`, bus from `bus.ts`), `useSp('pixels', …)` for the sprite editor. Plain modules listen with `on(...)`, which returns an unsubscribe function. Don't copy module state into React state.
- Pixelize settings are one typed object (`settings.ts`); change them with `setSettings()`, which announces, saves and reprocesses when needed. Form controls bound to one setting are in `pixelize/fields.tsx`. Saved as `pixelize.settings.v2`; the old `v1` format (form values by id) is migrated on load.
- Canvases with pointer interaction are imperative engines that their component attaches with `attach…()` (returns the cleanup): the sprite canvas (`sprite/canvas.ts`), the result editor (`editor.ts`) and the animation preview and align view (`anim.ts`). Don't move strokes or gestures into React state. Actions shared by components and shortcuts never look up elements by id.
- Keyboard shortcuts go through the registry in `src/ui/keys.ts` (actions with default keys, changeable in Options and saved as `pixelize.keys.v1`). Add new shortcuts there and handle them by action id (`actionFor(e, group)`); don't compare `e.key` directly, except for the fixed arrow keys. Labels that show a key use `keyLabel(id)`.
- The app has two modes (`src/ui/mode.ts`). Global keyboard, paste and drop handlers must check `currentMode()` so one mode never reacts to the other's input; the sprite editor catches paste and drop in the capture phase while it is open.
- Pixelize is a step-by-step flow (`steps.ts`): the side column renders the current step's panel; workspace pieces that only belong to some steps use `stepClass('<step> <step>…')`, which adds `offstep` elsewhere. The step and mode also go on `<body data-step>` / `<body data-mode>` for the layout rules in `styles.css`.
- Sprite documents have tags (`SpriteDoc.tags`, frame index ranges). Change frames only through the core functions in `core/sprite.ts` (`addFrame`, `duplicateFrame`, `removeFrame`, `moveFrame`, `mirrorFrames`) so tags follow their frames.
- Sprite editor: call `pushCel()` before changing one cel's pixels and `pushDoc()` before changing layers, frames or the canvas size, so undo works. Selected pixels being moved or scaled live in `sp.floating` until `commitFloating()`.
- Cropping runs at the end of the pipeline, so `ProcessResult.pixels` may be smaller than the sampled image: `preBg` stays uncropped (`fullW` × `fullH`) and `crop` says where the result sits in it. Background picks are stored in those full coordinates.
- TypeScript is pinned to 5.6: 5.7+ makes typed arrays generic and every `ImageData`/`Blob` call fails to type-check.
- Windows file names ignore case: don't create a file that differs from another only in case (e.g. `App.tsx` next to `app.ts`).
- If electron-builder fails extracting `winCodeSign` ("Cannot create symbolic link"), extract the cached `.7z` by hand into `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0` (or turn on Windows Developer Mode).
- Vite is pinned to 5 because the machine runs Node 20.17 (Vite 7 needs 20.19+).
- Grid detection is tuned against the tests in `test/grid.test.ts`. If you change it, keep regular grids exact and the lantern sample at 90%+ exact (the remaining misses are blank stretches that are genuinely ambiguous).
- Write comments and UI text in English.

## Publishing

The page is published as a Claude artifact at https://claude.ai/artifact/EW6Wi2rM13LVgpVCPkYDQp with the `downloads` capability. To update it, run `npm run build` and publish `dist/pixelize.html` with that `url`. The postbuild step removes the doctype/html/head/body tags because the artifact host adds its own.

For browser checks, `window.pixelize` exposes `app`, `settings`, `setMode(mode)`, `spriteState()`, `isBusy()`, `usingWorker()`, `animState()`, `runBatch()`, `sampleCanvas()`, `loadSample()` and `goTo(step)`. The Claude app's browser pane only runs local files that sit inside the session's project folder; from any session, start `npm run dev` and open http://localhost:5173 in the pane instead. When the pane is in the background, React and ResizeObserver updates can wait until something is drawn: take a screenshot before reading layout-dependent values (zoom, canvas sizes) from a script.
