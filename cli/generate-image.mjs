#!/usr/bin/env node
// Generates images with the OpenAI Images API and saves them as PNG.
//
//   node cli/generate-image.mjs "<prompt>" [options]
//   npm run image -- "<prompt>" [options]
//
// Options:
//   --out <file.png>        output path (default: generated/<timestamp>.png); with --n > 1, -1, -2... are appended
//   --prompt-file <file>    read the prompt from a text file instead of the first argument
//   --size <WxH|auto>       1024x1024 (default), 1536x1024, 1024x1536 or auto
//   --quality <q>           low, medium, high or auto (default: auto)
//   --background <b>        transparent, opaque or auto (default: auto)
//   --ref <file.png>        reference image(s) to edit or to copy the style from; repeatable (uses the edits endpoint)
//   --n <count>             number of images (default: 1)
//   --model <id>            default: $OPENAI_IMAGE_MODEL or gpt-image-1
//
// The key comes from OPENAI_API_KEY. On Windows, if the process doesn't have it yet
// (it was set with setx after the app started), it is read from the user environment.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, basename, extname, join, resolve } from "node:path";
import { execSync } from "node:child_process";

function parseArgs(argv) {
  const opts = { refs: [], n: 1, size: "1024x1024", quality: "auto", background: "auto" };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${a}`);
      return argv[++i];
    };
    switch (a) {
      case "--out": opts.out = next(); break;
      case "--prompt-file": opts.prompt = readFileSync(next(), "utf8").trim(); break;
      case "--size": opts.size = next(); break;
      case "--quality": opts.quality = next(); break;
      case "--background": opts.background = next(); break;
      case "--ref": opts.refs.push(next()); break;
      case "--n": opts.n = parseInt(next(), 10); break;
      case "--model": opts.model = next(); break;
      case "-h":
      case "--help": opts.help = true; break;
      default: rest.push(a);
    }
  }
  if (!opts.prompt && rest.length) opts.prompt = rest.join(" ");
  return opts;
}

function getApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  if (process.platform === "win32") {
    try {
      const out = execSync('reg query "HKCU\\Environment" /v OPENAI_API_KEY', { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const m = out.match(/OPENAI_API_KEY\s+REG_\w+\s+(\S+)/);
      if (m) return m[1];
    } catch {}
  }
  throw new Error("OPENAI_API_KEY is not set");
}

function mimeFor(file) {
  const ext = extname(file).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.prompt) {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
    process.exit(opts.help ? 0 : 1);
  }

  const key = getApiKey();
  const model = opts.model || process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const headers = { Authorization: `Bearer ${key}` };
  let res;

  if (opts.refs.length) {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", opts.prompt);
    form.append("size", opts.size);
    form.append("quality", opts.quality);
    form.append("background", opts.background);
    form.append("n", String(opts.n));
    const field = opts.refs.length > 1 ? "image[]" : "image";
    for (const ref of opts.refs) {
      form.append(field, new Blob([readFileSync(ref)], { type: mimeFor(ref) }), basename(ref));
    }
    res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers, body: form });
  } else {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: opts.prompt,
        size: opts.size,
        quality: opts.quality,
        background: opts.background,
        n: opts.n,
      }),
    });
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${json.error?.message || res.statusText}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const out = resolve(opts.out || join("generated", `${stamp}.png`));
  mkdirSync(dirname(out), { recursive: true });
  const ext = extname(out);
  const stem = out.slice(0, out.length - ext.length);

  json.data.forEach((img, i) => {
    const file = json.data.length > 1 ? `${stem}-${i + 1}${ext}` : out;
    writeFileSync(file, Buffer.from(img.b64_json, "base64"));
    console.log(file);
  });
  if (json.usage) console.error(`tokens: ${JSON.stringify(json.usage)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
