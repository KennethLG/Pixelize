# CLAUDE.md

Pixelize converts fake AI pixel art into real pixel art. Vite + TypeScript, no framework. See README.md for the folder layout and features.

## Commands

- `npm test`: Vitest on the core. Run it after any change in `src/core/` or `src/export/`.
- `npm run build`: `tsc`, then Vite bundles everything (CSS, JS and the inline worker) into `dist/pixelize.html`.
- `npm run cli -- <image> [options]`: the terminal tool (runs `cli/pixelize.ts` with tsx).
- `npm run desktop` / `npm run desktop:dist`: run the Electron app / build the Windows installer and portable exe into `release/` (git-ignored). `electron/main.cjs` only wraps `dist/desktop/index.html`; keep app logic out of it so the web page and the desktop app stay the same code.
- `npm run image -- "<prompt>" [options]`: generates images with the OpenAI Images API (`cli/generate-image.mjs`, plain Node, needs `OPENAI_API_KEY`; `--help` lists the options). Output goes to `generated/` (git-ignored) unless `--out` says otherwise.

## Rules

- `src/core/` and `src/export/` stay pure (no DOM, no `window`), so the worker, the CLI and the tests can use them. Anything that touches the page goes in `src/ui/`.
- The app has two modes (`src/ui/mode.ts`): `#pixelizeMode` (the step flow) and `#spriteMode` (the sprite editor). Global keyboard, paste and drop handlers must check `currentMode()` so one mode never reacts to the other's input; the sprite editor catches paste and drop in the capture phase while it is open.
- The sprite editor (`src/ui/sprite/`) keeps its state in `sp` (`state.ts`) and its modules talk through `on(...)`/`emit(...)` events (`pixels`, `structure`, `cursor`, `selection`, `color`, `tool`). Call `pushCel()` before changing one cel's pixels and `pushDoc()` before changing layers, frames or the canvas size, so undo works. Selected pixels being moved or scaled live in `sp.floating` until `commitFloating()`.
- UI modules react to `onSource` / `onBase` / `onResult` in `src/ui/app.ts` instead of calling each other's render functions. Result listeners run in the order they register in `src/main.ts` (palette, editor, animation), and the palette must run first because it fills `app.resultColors`.
- The page is a step-by-step flow (`src/ui/steps.ts`). Each step's settings live in a `data-panel="<step>"` section of the side column; anything else that only belongs to some steps carries `data-show="<step> <step>…"` and gets the `offstep` class elsewhere. Modules that care about the step use `currentStep()` / `onStep()`. `initSteps()` runs last in `src/main.ts` so every `onStep` listener is registered first.
- Cropping runs at the end of the pipeline, so `ProcessResult.pixels` may be smaller than the sampled image: `preBg` stays uncropped (`fullW` × `fullH`) and `crop` says where the result sits in it. Background picks are stored in those full coordinates.
- TypeScript is pinned to 5.6: 5.7+ makes typed arrays generic and every `ImageData`/`Blob` call fails to type-check.
- If electron-builder fails extracting `winCodeSign` ("Cannot create symbolic link"), extract the cached `.7z` by hand into `%LOCALAPPDATA%electron-builderCachewinCodeSignwinCodeSign-2.6.0` (or turn on Windows Developer Mode).
- Vite is pinned to 5 because the machine runs Node 20.17 (Vite 7 needs 20.19+).
- Grid detection is tuned against the tests in `test/grid.test.ts`. If you change it, keep regular grids exact and the lantern sample at 90%+ exact (the remaining misses are blank stretches that are genuinely ambiguous).
- Write comments and UI text in English.

## Publishing

The page is published as a Claude artifact at https://claude.ai/artifact/EW6Wi2rM13LVgpVCPkYDQp with the `downloads` capability. To update it, run `npm run build` and publish `dist/pixelize.html` with that `url`. The postbuild step removes the doctype/html/head/body tags because the artifact host adds its own.

For browser checks, `window.pixelize` exposes `app`, `setMode(mode)`, `spriteState()`, `isBusy()`, `usingWorker()`, `animState()`, `runBatch()`, `sampleCanvas()`, `loadSample()` and `goTo(step)`. The Claude app's browser pane only runs local files that sit inside the session's project folder; from any session, start `npm run dev` and open http://localhost:5173 in the pane instead.
