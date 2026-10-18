// Takes the README screenshots into docs/screenshots: `npm run screenshots`
// (it builds first). Opens the built page in a hidden Electron window with a
// throwaway profile, so your own settings and sprites are not touched.

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const W = 1440, H = 900;
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const PAGE = path.join(__dirname, '..', 'dist', 'desktop', 'index.html');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'pixelize-shots-')));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: W, height: H, useContentSize: true, show: false, backgroundColor: '#141824',
    // a hidden window would otherwise slow its timers down and skip animation frames
    webPreferences: { backgroundThrottling: false } });
  await win.loadFile(PAGE);
  // runs in the page; `P` is window.pixelize, `$`/`$$` query the page, `click(text)` presses a button by its label
  const run = (code) => win.webContents.executeJavaScript(`(async () => {
    const P = window.pixelize, $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
    const tick = (ms = 200) => new Promise((r) => setTimeout(r, ms));
    const click = (text, root = document) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text)?.click();
    const idle = async () => { for (let i = 0; i < 200 && (P.isBusy() || !P.app.result); i++) await tick(50); await tick(300); };
    ${code}
  })()`);
  const shot = async (name) => {
    // a hidden window may hold on to an old frame: ask for a fresh paint first
    win.webContents.invalidate();
    await wait(1200);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
    console.log(`${name}.png ${img.getSize().width}×${img.getSize().height}`);
  };

  await run(`
    window.confirm = () => true;
    document.documentElement.dataset.theme = 'dark';
    window.dispatchEvent(new Event('themechange'));
    P.setMode('pixelize');
    P.loadSample();
    await idle();
    await tick(800);
    return JSON.stringify({ result: P.app.result && [P.app.result.width, P.app.result.height], status: $('#status')?.textContent });
  `).then((r) => console.log('pixelize step:', r));
  await shot('pixelize-grid');

  await run(`P.goTo('colors'); await tick(300); $$('#swatches .sw')[4]?.click(); await tick();`);
  await shot('pixelize-colors');

  await run(`P.goTo('frames'); await tick(400);`);
  await shot('pixelize-animation');

  // the sample goes to the sprite editor: a tag, onion skin, the ramps open
  await run(`
    // a transparent background, so the onion skin shows in the editor
    P.goTo('clean'); await tick(300);
    [...$$('#pixelizeMode label.check')].find((l) => l.textContent.includes('Make the background transparent'))?.querySelector('input')?.click();
    await idle();
    P.goTo('export'); await tick(300);
    click('Edit in the sprite editor'); await tick(500);
    const sp = P.spriteState();
    $$('.sp-tl-frame')[0].click(); await tick();
    $$('.sp-tl-frame')[3].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); await tick();
    click('+ Tag'); await tick();
    const name = $('.sp-tag-editor input[type=text]');
    name.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, 'idle');
    name.dispatchEvent(new Event('input', { bubbles: true }));
    // a hidden window gives no focus, so blur never fires: React's onBlur listens to focusout
    name.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await tick(300);
    click('Close'); await tick();
    $$('.sp-tl-frame')[1].click(); await tick();
    const onion = [...$$('.sp-canvas-panel label.check')].find((l) => l.textContent.trim() === 'Onion skin')?.querySelector('input');
    if (onion && !onion.checked) onion.click();
    sp.primary = [217, 115, 43, 255];
    $('#spPrimary').click(); await tick();
    const ramps = $('.sp-ramps'); if (ramps) ramps.open = true;
    click('Fit'); await tick(400);
    return JSON.stringify({ tags: sp.doc.tags.map((t) => t.name), onion: sp.onion, ramps: !!ramps?.open, primary: $('#spHex')?.value, editor: !!$('.sp-tag-editor') });
  `).then((r) => console.log('sprite step:', r));
  await shot('sprite-editor');

  await run(`
    click('Check'); await tick(600);
    const kinds = [...$$('.sp-check .chk-title')];
    kinds.find((t) => /Orphan/.test(t.textContent))?.click(); await tick(300);
  `);
  await shot('sprite-check');

  await run(`
    click('Check'); await tick();
    click('Variants'); await tick();
    const vp = $('.sp-variants');
    click('+ New variant', vp); await tick();
    const v = P.spriteState().doc.variants[0];
    // a "blue" version of the lantern: the warm colors swap red and blue
    for (const row of $$('.sp-variants .var-row')) {
      const from = row.querySelector('i').style.getPropertyValue('--c');
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(from.slice(i, i + 2), 16));
      if (r > b + 40 && r > 120) v.map[from] = '#' + [b, Math.round((g + b) / 2), r].map((x) => x.toString(16).padStart(2, '0')).join('');
    }
    v.name = 'Blue';
    // the panel's own Show box redraws the canvas with the swaps
    const show = [...vp.querySelectorAll('label.check')].find((l) => l.textContent.trim() === 'Show')?.querySelector('input');
    if (show?.checked) { show.click(); await tick(); }
    show?.click(); await tick(300);
    $$('.sp-variants .var-row')[1]?.click(); await tick();
  `);
  await shot('sprite-variants');

  await run(`
    click('Variants'); await tick();
    $('.opt-open').click(); await tick(400);
  `);
  await shot('options');

  app.quit();
}).catch((err) => { console.error(err); app.exit(1); });
