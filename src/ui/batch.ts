// Processing several images with the current settings into one ZIP.

import { makeZip, type ZipEntry } from '../export/zip';
import { app, collectOpts, nextSourceId } from './app';
import { settings } from './settings';
import { canvasBytes, saveBlob } from './downloads';
import { decodeFile, imageToData } from './input';
import { dropSource, processAsync, type WorkSource } from './processing';

/** `report` shows progress (and errors) next to the button. */
export async function runBatch(files: File[], report: (msg: string, isError?: boolean) => void = () => {}): Promise<void> {
  files = files.filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  const opts = collectOpts();
  opts.bg.pick = null;
  if (settings.batchPalette && app.resultColors.length) {
    opts.palette = { ...opts.palette, mode: 'imported', imported: app.resultColors.map((c) => c.rgb) };
  }
  const out: ZipEntry[] = [];
  let failed = 0;
  for (let k = 0; k < files.length; k++) {
    report(`Processing ${k + 1} of ${files.length}: ${files[k].name}`);
    let src: WorkSource | null = null;
    try {
      const { data, w, h } = imageToData(await decodeFile(files[k]));
      src = { id: nextSourceId(), data, w, h };
      const r = await processAsync(src, opts);
      const c = document.createElement('canvas');
      c.width = r.width;
      c.height = r.height;
      c.getContext('2d')!.putImageData(new ImageData(r.pixels, r.width, r.height), 0, 0);
      const name = files[k].name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || `image_${k + 1}`;
      out.push({ name: `${name}_pixel.png`, data: await canvasBytes(c) });
    } catch {
      failed++;
    } finally {
      dropSource(src);
    }
  }
  if (!out.length) {
    report('None of the images could be processed.', true);
    return;
  }
  report(`${out.length} done${failed ? `, ${failed} failed` : ''}.`);
  await saveBlob(new Blob([makeZip(out)], { type: 'application/zip' }), 'pixelize_batch.zip');
}
