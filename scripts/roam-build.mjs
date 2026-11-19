import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

import { mapAssets } from "./map-assets.mjs";

const files = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/journal.css": ["journal.css", "text/css; charset=utf-8"],
  "/roam.svg": ["roam.svg", "image/svg+xml"],
  "/icons.svg": ["icons.svg", "image/svg+xml"],
  "/editor-prototype": ["editor-prototype.html", "text/html; charset=utf-8"],
  "/editor-prototype.css": ["editor-prototype.css", "text/css; charset=utf-8"],
};

const assets = await mapAssets();
for (const [path, [file, type]] of Object.entries(files)) {
  assets[path] = { type, body: await readFile(new URL("../src/" + file, import.meta.url), "utf8") };
}
for (const name of ["journal", "editor-prototype"]) {
  const bundle = await build({
    entryPoints: [`src/${name}.js`], bundle: true, format: "esm",
    platform: "browser", target: "es2022", minify: true, write: false,
  });
  assets[`/${name}.js`] = { type: "text/javascript; charset=utf-8", body: bundle.outputFiles[0].text };
}
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
const worker = await build({
  entryPoints: ["worker/index.mjs"], bundle: true, format: "esm",
  platform: "browser", target: "es2022", write: false,
  banner: { js: "const assets = " + JSON.stringify(assets) + ";" },
});
await writeFile("dist/server/index.js", worker.outputFiles[0].text);
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
