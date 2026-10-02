# pixelize

Turns fake pixel art (ChatGPT style: large image, simulated pixels of uneven size,
slightly different colors) into real pixel art at its true resolution, with one shared palette.

```
npm install          # once
node pixelize.js image.png
```

Writes `image_pixel.png` (real size) and `image_pixel_x8.png` (preview at 8x).

How it works:
1. Finds the edges between simulated pixels and works out the cell size from the gaps between them.
2. Fits a grid that follows those edges, so cells of uneven size still line up.
3. Takes the dominant color of each cell's center (ignoring blurred borders).
4. Merges similar colors (Lab distance) into one palette and applies it to every pixel.

Options:
- `--colors 16` forces exactly 16 colors (k-means).
- `--tolerance 10` sets how similar two colors must be to merge (auto mode). Higher means fewer colors.
- `--size 64x64` forces the output size when you already know it.
- `--cell 16` forces the cell size in source px.
- `--palette` also writes `_palette.png` and prints hex codes.
- `--preview 0` skips the preview. `-o out.png` sets the output name.

## Web version

`index.html` is the full tool as a page that runs in the browser (open it with a double click). On top of the CLI it has:

- **Grid:** auto detection with a confidence rating, manual cell size (separate X/Y, sliders, offset, snap to edges) or an exact output size.
- **Colors:** auto tolerance, a fixed count, or snapping to an imported palette (PNG, .hex, .gpl or pasted hex codes). Colors can be locked, replaced or merged, and stray noise pixels cleaned.
- **Background removal**, by edge flood fill or by color, with a tolerance.
- **Editor:** pencil, eraser, fill, eyedropper and background picker on the result, with undo/redo, zoom/pan, a pixel grid and a before/after slider.
- **Spritesheets:** auto or grid split, reordering by drag, per-frame duration and nudging, onion skin, playback forward/reverse/ping-pong with loop or stop.
- **Exports:** PNG (1× or scaled), `_stripN.png` strip (GameMaker splits it on import), sheet with columns and padding, frames ZIP, and animated GIF.
- **Batch** processing to a ZIP, settings remembered in the browser, and heavy work in a Web Worker.

Shortcuts: H move, B pencil, E eraser, G fill, I eyedropper, +/− zoom, 0 fit, Space drag to pan, Ctrl+Z / Ctrl+Y undo/redo.
