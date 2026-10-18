# Contributing to Pixelize

Thanks for helping! This page explains how the code is put together and what to check before a pull request.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173, reloads as you edit
npm test           # Vitest on the core
npm run build      # type-check (tsc), then the one-file build in dist/
```

Node 20.17 or newer. Vite is pinned to 5 and TypeScript to 5.6 on purpose (TypeScript 5.7+ makes typed arrays generic and every `ImageData` call fails to type-check).

## How the code is organized

| Folder | What lives there |
| --- | --- |
| `src/core/` | Pure logic, no DOM: grid detection, sampling, palette, background, crop, the `processImage` pipeline, frame splitting and playback order; the sprite document (`sprite.ts`: layers, frames, tags, variants, compositing, saving), pixel operations (`bitmap.ts`), ramps and variants (`shading.ts`) and the checks (`lint.ts`). Shared by the page, its worker, the CLI and the tests. |
| `src/export/` | GIF and ZIP writers (bytes in, bytes out). |
| `src/worker.ts` | Runs `processImage` off the main thread. |
| `src/main.tsx`, `src/ui/Page.tsx` | Start-up and the React page: the header and both modes. |
| `src/ui/` | Pixelize state and logic: `app` (state, processing loop, events), `settings`, `steps`, `mode`, `editor` (result editor engine), `anim` (frames, playback, align view, exports), `palette`, `downloads`, `batch`, `input`, `processing` (worker client), `bus` (events React can follow), `keys` (shortcut registry), `theme`. |
| `src/ui/pixelize/` | The Pixelize mode's React components. |
| `src/ui/components/` | Components shared by both modes (segmented control, swatch, number field, HSV picker, drag to reorder, floating panel, Options dialog). |
| `src/ui/sprite/` | The sprite editor: `components/` (one per panel), `state` (document, selection, undo, events), `canvas` (the drawing engine), `actions`, `animation`, `io` (open, save, export, clipboard, autosave), `prefs`, `shortcuts`. |
| `cli/` | The command-line tool (and an optional OpenAI image generator script). |
| `electron/` | The desktop shell: a window around the built page, with native save dialogs. |
| `test/` | Vitest tests and helpers. |
| `scripts/` | Build helpers and `screenshots.cjs` (`npm run screenshots` regenerates the images in `docs/screenshots`). |

## A few rules

- **`src/core/` and `src/export/` stay pure** (no DOM, no `window`) so the worker, the CLI and the tests can use them. Anything that touches the page goes in `src/ui/`. New core logic comes with tests.
- **State lives in plain modules, not in React.** Modules announce changes on an event bus; components re-render with a hook and read the module directly (`pxBus.use('result')` in Pixelize, `useSp('pixels')` in the sprite editor). Don't copy that state into React state.
- **Canvases with pointer interaction are imperative engines** (`sprite/canvas.ts`, `editor.ts`, the align view in `anim.ts`) that their component attaches with `attach…()`. Strokes and gestures never go through React renders.
- **Undo in the sprite editor:** call `pushCel()` before changing one cel's pixels and `pushDoc()` before changing layers, frames or the canvas size. Change frames through the core functions so tags follow them.
- **Keyboard shortcuts** go through the registry in `src/ui/keys.ts`, so they show up in Options and can be rebound.
- **Comments and UI text in English.** Comments explain why, not what.

## Before you open a pull request

```bash
npm test
npm run build
```

Both run in CI too. If you change something you can see, try it in `npm run dev`, and if the README screenshots no longer match, run `npm run screenshots`.

Keep pull requests focused: one fix or feature each, with a short description of what changed and how you checked it.

## Reporting bugs

Open an issue with what you did, what you expected and what happened instead. A screenshot, or the image or `.pixelize` file that shows the problem, helps a lot.
