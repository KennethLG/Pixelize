# CLAUDE.md

Pixelize converts fake AI pixel art into real pixel art. Vite + TypeScript, no framework. See README.md for the folder layout and features.

## Commands

- `npm test`: Vitest on the core. Run it after any change in `src/core/` or `src/export/`.
- `npm run build`: `tsc`, then Vite bundles everything (CSS, JS and the inline worker) into `dist/pixelize.html`.
- `npm run cli -- <image> [options]`: the terminal tool (runs `cli/pixelize.ts` with tsx).

## Rules

- `src/core/` and `src/export/` stay pure (no DOM, no `window`), so the worker, the CLI and the tests can use them. Anything that touches the page goes in `src/ui/`.
- UI modules react to `onSource` / `onBase` / `onResult` in `src/ui/app.ts` instead of calling each other's render functions. Result listeners run in the order they register in `src/main.ts` (palette, editor, animation), and the palette must run first because it fills `app.resultColors`.
- TypeScript is pinned to 5.6: 5.7+ makes typed arrays generic and every `ImageData`/`Blob` call fails to type-check.
- Vite is pinned to 5 because the machine runs Node 20.17 (Vite 7 needs 20.19+).
- Grid detection is tuned against the tests in `test/grid.test.ts`. If you change it, keep regular grids exact and the lantern sample at 90%+ exact (the remaining misses are blank stretches that are genuinely ambiguous).
- Write comments and UI text in English.

## Publishing

The page is published as a Claude artifact at https://claude.ai/artifact/EW6Wi2rM13LVgpVCPkYDQp with the `downloads` capability. To update it, run `npm run build` and publish `dist/pixelize.html` with that `url`. The postbuild step removes the doctype/html/head/body tags because the artifact host adds its own.

For browser checks, `window.pixelize` exposes `app`, `isBusy()`, `usingWorker()`, `animState()`, `runBatch()` and `sampleCanvas()`. The Claude app's browser pane only runs local files that sit inside the session's project folder, so copy the build there temporarily to test it, then delete the copy.
