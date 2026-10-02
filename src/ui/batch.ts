// Processing several images with the current settings into one ZIP.

import { makeZip, type ZipEntry } from '../export/zip';
import { app, collectOpts, nextSourceId } from './app';
import { $, field, isChecked } from './dom';
import { canvasBytes, saveBlob } from './downloads';
import { decodeFile, imageToData } from './input';
import { dropSource, processAsync, type WorkSource } from './processing';

export async function runBatch(files: File[]): Promise<void> {
  files = files.filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  const opts = collectOpts();
  opts.bg.pick = null;
  if (isChecked('batchPalette') && app.resultColors.length) {
    opts.palette = { ...opts.palette, mode: 'imported', imported: app.resultColors.map((c) => c.rgb) };
  }
  const status = $('batchStatus');
  const out: ZipEntry[] = [];
  let failed = 0;
  field('batchBtn').disabled = true;
  status.classList.remove('err');
  for (let k = 0; k < files.length; k++) {
    status.textContent = `Processing ${k + 1} of ${files.length}: ${files[k].name}`;
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
  field('batchBtn').disabled = false;
  if (!out.length) {
    status.textContent = 'None of the images could be processed.';
    status.classList.add('err');
    return;
  }
  status.textContent = `${out.length} done${failed ? `, ${failed} failed` : ''}.`;
  await saveBlob(new Blob([makeZip(out)], { type: 'application/zip' }), 'pixelize_batch.zip');
}

export function initBatch(): void {
  $('batchBtn').addEventListener('click', () => field('batchFiles').click());
  field('batchFiles').addEventListener('change', () => {
    const files = [...(field('batchFiles').files || [])];
    field('batchFiles').value = '';
    runBatch(files);
  });
}
