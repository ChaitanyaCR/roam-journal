import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { downloadZip } from "client-zip";
import { journalFiles } from "../src/journal-export.js";

const window = new Window();
globalThis.document = window.document;
const trips = [
  { id: "first", title: "<Coast>", destination: "Goa", date: "2025-01-01", story: "First\nline", photos: [] },
  { id: "second", title: "<Coast>", date: "2025-01-02", end_date: "2025-01-03", tags: ["Beach"],
    photos: [{ key: "original", alt: "A & B" }], document: { version: 2, type: "doc", content: [
      { type: "daySection", attrs: { date: "2025-01-03" }, content: [
        { type: "paragraph", content: [{ type: "text", text: "Day two", marks: [{ type: "bold" }] }] },
        { type: "image", attrs: { index: 0, caption: "A & B" } },
      ] },
    ] } },
];
const original = Uint8Array.of(137, 80, 78, 71);
const files = entries => journalFiles(entries, () => {});
test("offline stories, index and manifest resolve to the archived originals", async t => {
  t.mock.method(globalThis, "fetch", async path => {
    assert.equal(path, "/api/photos/original");
    return new Response(original, { headers: { "Content-Type": "image/png" } });
  });
  const entries = new Map();
  for await (const { name, input } of files(trips)) entries.set(name, input);
  const manifest = JSON.parse(entries.get("journal.json"));
  for (const trip of manifest.trips) {
    assert.ok(entries.get("index.html").includes('href="' + trip.path + '"'));
    assert.ok(entries.has(trip.path));
  }
  const rich = entries.get(manifest.trips[1].path);
  assert.match(rich, /2025-01-03<\/h3>.*<strong>Day two<\/strong>.*src="photo-1.png".*<figcaption>A &amp; B<\/figcaption>/s);
  assert.doesNotMatch(rich, /\/api\/photos|<Coast>/);
  assert.match(entries.get(manifest.trips[0].path), /First\nline/);
  assert.deepEqual(new Uint8Array(await entries.get(manifest.trips[1].photos[0].path).arrayBuffer()), original);
  const zip = await downloadZip(files(trips)).arrayBuffer();
  assert.equal(new DataView(zip).getUint32(0, true), 0x04034b50);
});

test("an empty journal exports, and a missing original rejects the ZIP with the trip name", async t => {
  const entries = [];
  for await (const file of files([])) entries.push(file.name);
  assert.deepEqual(entries, ["index.html", "journal.json"]);
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 404 }));
  await assert.rejects(downloadZip(files(trips)).blob(), /photo 1 in “<Coast>”/);
});
