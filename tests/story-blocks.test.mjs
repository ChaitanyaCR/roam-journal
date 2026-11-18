import assert from "node:assert/strict";
import test from "node:test";
import worker from "../dist/server/index.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=", "base64");

function storage({ failInsert = false } = {}) {
  const rows = new Map();
  const objects = new Map();
  const DB = { prepare(sql) { return { bind(...args) { return {
    async all() { return { results: [...rows.values()].filter(row => row.owner === args[0]) }; },
    async first() { return rows.get(args[0] + ":" + args[1]) ?? null; },
    async run() {
      if (sql.startsWith("UPDATE trips")) {
        const [title, destination, date, story, photos, blocks, document, tags, revision, owner, id, expectedRevision] = args;
        const key = owner + ":" + id;
        const row = rows.get(key);
        if (!row || row.revision !== expectedRevision) return { meta: { changes: 0 } };
        rows.set(key, { ...row, title, destination, date, story, photos, blocks, document, tags, revision });
        return { meta: { changes: 1 } };
      }
      assert.match(sql, /INSERT INTO trips/);
      if (failInsert) throw new Error("Database unavailable");
      const [id, owner, title, destination, date, story, photos, blocks, document, tags] = args;
      rows.set(owner + ":" + id, { id, owner, title, destination, date, story, photos, blocks, document, tags, revision: null });
    },
  }; } }; } };
  const BUCKET = {
    async put(key, stream, metadata) {
      objects.set(key, { ...metadata, body: await new Response(stream).arrayBuffer(),
        writeHttpMetadata(headers) { headers.set("Content-Type", this.httpMetadata.contentType); } });
    },
    async head(key) { return objects.has(key) ? { size: objects.get(key).body.byteLength } : null; },
    async get(key) { return objects.get(key); },
    async delete(key) { objects.delete(key); },
  };
  return { DB, BUCKET, rows, objects };
}

function form(blocks, photoCount = 0) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ id: crypto.randomUUID(), title: "A trip", destination: "Goa", date: "2026-11-13" })) data.set(key, value);
  if (blocks !== undefined) data.set("blocks", JSON.stringify(blocks));
  for (let index = 0; index < photoCount; index++) {
    data.append("photos", new Blob([png], { type: "image/png" }), "photo.png");
    data.set("alt" + index, "Caption " + index);
  }
  return data;
}

function request(method, data, owner = "alice", path = "/api/trips") {
  return new Request("https://journal.example" + path, {
    method, body: data, headers: owner ? { "oai-authenticated-user-id": owner } : {},
  });
}

test("mixed story sections survive save, reload, and retry in the same order", async () => {
  const env = storage();
  const blocks = [
    { type: "text", text: "Arriving." }, { type: "photo", index: 0 },
    { type: "text", text: "Walking along the beach." }, { type: "photo", index: 1 },
    { type: "text", text: "The way home." },
  ];
  const data = form(blocks, 2);
  data.set("tags", " Coast, hiking, coast, ");
  const response = await worker.fetch(request("POST", data), env);
  assert.equal(response.status, 201);
  const saved = await response.json();
  assert.deepEqual(saved.tags, ["Coast", "hiking"]);
  assert.deepEqual(saved.blocks, blocks);
  assert.equal(saved.story, "Arriving.\n\nWalking along the beach.\n\nThe way home.");
  assert.equal(saved.photos[1].alt, "Caption 1");
  const listed = await (await worker.fetch(request("GET"), env)).json();
  assert.deepEqual(listed[0].tags, saved.tags);
  assert.deepEqual(listed[0].blocks, blocks);
  assert.equal((await worker.fetch(request("POST", data), env)).status, 200);
  assert.equal(env.objects.size, 2);
  assert.deepEqual(await (await worker.fetch(request("GET", undefined, "bob"), env)).json(), []);
  assert.equal((await worker.fetch(request("GET", undefined, "bob", "/api/photos/" + saved.photos[0].key), env)).status, 404);
});

test("existing entries and submissions still produce readable story sections", async () => {
  const env = storage();
  const data = form(undefined, 1);
  data.set("story", "An older story.");
  assert.equal((await worker.fetch(request("POST", data), env)).status, 201);
  const row = [...env.rows.values()][0];
  row.blocks = null;
  const [legacy] = await (await worker.fetch(request("GET"), env)).json();
  assert.deepEqual(legacy.blocks, [{ type: "text", text: "An older story." }, { type: "photo", index: 0 }]);
});

test("invalid sections and missing, duplicate, or out-of-range photo references are rejected before storage", async () => {
  const text = { type: "text", text: "Story" };
  for (const [blocks, count] of [
    [null, 0], [[], 0], [[null], 0], [[{ type: "html", text: "<script>" }], 0],
    [[{ type: "text", text: 123 }], 0],
    [[text, { type: "photo", index: 2 }], 1],
    [[text, { type: "photo", index: -1 }], 1],
    [[text, { type: "photo", index: 0.5 }], 1],
    [[text, { type: "photo", index: 0 }, { type: "photo", index: 0 }], 2],
    [[text], 1], [Array(101).fill(text), 0],
  ]) {
    const env = storage();
    assert.equal((await worker.fetch(request("POST", form(blocks, count)), env)).status, 400);
    assert.equal(env.rows.size, 0);
    assert.equal(env.objects.size, 0);
  }
});

test("malformed JSON, empty stories, and excessive total text are rejected", async () => {
  for (const blocks of ["{", JSON.stringify([{ type: "text", text: "   " }]), JSON.stringify([
    { type: "text", text: "x".repeat(10000) }, { type: "text", text: "y".repeat(10000) },
  ])]) {
    const data = form();
    data.set("blocks", blocks);
    assert.equal((await worker.fetch(request("POST", data), storage())).status, 400);
  }
});

test("photo uploads are cleaned up if saving story sections fails", async () => {
  const env = storage({ failInsert: true });
  const data = form([{ type: "text", text: "Story" }, { type: "photo", index: 0 }], 1);
  assert.equal((await worker.fetch(request("POST", data), env)).status, 503);
  assert.equal(env.objects.size, 0);
});

test("rich documents preserve formatting, captions, and photo positions after reload and retries", async () => {
  const env = storage();
  const document = { version: 1, type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "The beach" }] },
    { type: "paragraph", content: [{ type: "text", text: "We arrived.", marks: [{ type: "bold" }] }] },
    { type: "image", attrs: { index: 0, caption: "Sunset" } },
    { type: "bulletList", content: [{ type: "listItem", content: [
      { type: "paragraph", content: [{ type: "text", text: "A walk", marks: [{ type: "italic" }] }] },
    ] }] },
    { type: "image", attrs: { index: 1, caption: "The way home" } },
  ] };
  const data = form(undefined, 2);
  data.set("document", JSON.stringify(document));
  const response = await worker.fetch(request("POST", data), env);
  assert.equal(response.status, 201);
  const saved = await response.json();
  assert.deepEqual(saved.document, document);
  assert.equal(saved.photos[0].alt, "Sunset");
  assert.match(saved.story, /A walk/);
  const [reloaded] = await (await worker.fetch(request("GET"), env)).json();
  assert.deepEqual(reloaded.document, document);
  assert.equal((await worker.fetch(request("POST", data), env)).status, 200);
  assert.equal(env.objects.size, 2);
  assert.deepEqual(await (await worker.fetch(request("GET", undefined, "bob"), env)).json(), []);
});

test("rich documents reject unsafe formatting, invalid structure, and foreign photo references", async () => {
  const text = { type: "paragraph", content: [{ type: "text", text: "A story" }] };
  for (const [document, count] of [
    [{ version: 2, type: "doc", content: [text] }, 0],
    [{ version: 1, type: "doc", content: [{ type: "script", content: [] }] }, 0],
    [{ version: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Link", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] }, 0],
    [{ version: 1, type: "doc", content: [text, { type: "image", attrs: { index: 8, src: "/api/photos/foreign" } }] }, 1],
    [{ version: 1, type: "doc", content: [text] }, 1],
    [{ version: 1, type: "doc", content: [{ type: "bulletList", content: [text] }] }, 0],
    [{ version: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(20001) }] }] }, 0],
  ]) {
    const data = form(undefined, count);
    data.set("document", JSON.stringify(document));
    const env = storage();
    assert.equal((await worker.fetch(request("POST", data), env)).status, 400);
    assert.equal(env.objects.size, 0);
  }
});

test("failed rich-document saves clean up photos", async () => {
  const env = storage({ failInsert: true });
  const data = form(undefined, 1);
  data.set("document", JSON.stringify({ version: 1, type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "A story" }] },
    { type: "image", attrs: { index: 0, caption: "" } },
  ] }));
  assert.equal((await worker.fetch(request("POST", data), env)).status, 503);
  assert.equal(env.objects.size, 0);
});

test("editing an existing trip keeps its ID, reuses retained photos, and rejects stale or foreign changes", async () => {
  const env = storage();
  const original = form(undefined, 2);
  original.set("story", "Original story.");
  const saved = await (await worker.fetch(request("POST", original), env)).json();
  const [removed, retained] = saved.photos;
  const path = `/api/trips/${saved.id}`;
  const edited = form(undefined, 1);
  edited.set("title", "Updated title");
  edited.set("revision", "");
  edited.set("photoKeys", JSON.stringify([null, retained.key]));
  edited.set("document", JSON.stringify({ version: 1, type: "doc", content: [
    { type: "image", attrs: { index: 0, caption: "New cover" } },
    { type: "paragraph", content: [{ type: "text", text: "Edited story", marks: [{ type: "italic" }] }] },
    { type: "image", attrs: { index: 1, caption: "Updated caption" } },
  ] }));
  assert.equal((await worker.fetch(request("PATCH", edited, "bob", path), env)).status, 404);
  edited.set("photoKeys", JSON.stringify([null, crypto.randomUUID()]));
  assert.equal((await worker.fetch(request("PATCH", edited, "alice", path), env)).status, 400);
  edited.set("photoKeys", JSON.stringify([null, retained.key]));
  const response = await worker.fetch(request("PATCH", edited, "alice", path), env);
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.id, saved.id);
  assert.equal(updated.title, "Updated title");
  assert.deepEqual(updated.photos[1], { key: retained.key, alt: "Updated caption" });
  assert.ok(!env.objects.has(removed.key));
  assert.ok(env.objects.has(retained.key));
  assert.ok(env.objects.has(updated.photos[0].key));
  assert.deepEqual((await (await worker.fetch(request("PATCH", edited, "alice", path), env)).json()).photos, updated.photos);
  assert.equal(env.objects.size, 2);
  edited.set("id", crypto.randomUUID());
  assert.equal((await worker.fetch(request("PATCH", edited, "alice", path), env)).status, 409);
  const rows = await (await worker.fetch(request("GET"), env)).json();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].document, updated.document);
  assert.equal(rows[0].revision, updated.revision);
});
