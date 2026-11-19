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
        const [title, destination, date, end_date, city_pin, story, photos, blocks, document, tags, revision, owner, id, expectedRevision] = args;
        const key = owner + ":" + id;
        const row = rows.get(key);
        if (!row || row.revision !== expectedRevision) return { meta: { changes: 0 } };
        rows.set(key, { ...row, title, destination, date, end_date, city_pin, story, photos, blocks, document, tags, revision });
        return { meta: { changes: 1 } };
      }
      assert.match(sql, /INSERT INTO trips/);
      if (failInsert) throw new Error("Database unavailable");
      const [id, owner, title, destination, date, end_date, city_pin, story, photos, blocks, document, tags] = args;
      rows.set(owner + ":" + id, { id, owner, title, destination, date, end_date, city_pin, story, photos, blocks, document, tags, revision: null });
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
    [{ version: 3, type: "doc", content: [text] }, 0],
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

test("trash and restore preserve the entire trip and reject stale and cross-account requests", async t => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readdir, readFile } = await import("node:fs/promises");
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const migrations = new URL("../drizzle/", import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name.endsWith(".sql")).sort()) {
    sqlite.exec(await readFile(new URL(name, migrations), "utf8"));
  }
  const env = storage();
  env.DB = { prepare(sql) {
    const stmt = sqlite.prepare(sql);
    return { bind(...args) { return {
      first: () => stmt.get(...args) ?? null,
      all: () => ({ results: stmt.all(...args) }),
      run: () => ({ meta: stmt.run(...args) }),
    }; } };
  } };
  const data = form(undefined, 1);
  const paragraph = text => ({ type: "paragraph", content: [{ type: "text", text }] });
  data.set("document", JSON.stringify({ type: "doc", version: 1, content: [
    paragraph("Arrival"), { type: "image", attrs: { index: 0, caption: "At the station" } }, paragraph("Home"),
  ] }));
  data.set("tags", "Family, travel");
  data.set("map_city", "Tokyo, Japan");
  const saved = await (await worker.fetch(request("POST", data), env)).json();
  const path = "/api/trips/" + saved.id;
  const move = (action, revision, requestId, owner) => worker.fetch(request("POST",
    JSON.stringify({ requestId, revision }), owner, path + "/" + action), env);
  const list = async (owner, query = "") => (await worker.fetch(request("GET", undefined, owner, "/api/trips" + query), env)).json();
  const deletion = crypto.randomUUID();
  assert.equal((await move("trash", null, deletion)).status, 200);
  assert.equal((await move("trash", null, deletion)).status, 200);
  assert.deepEqual(await list(), []);
  const [trashed] = await list("alice", "?include=trash");
  assert.equal(trashed.city_pin.label, "Tokyo, Japan");
  assert.ok(Math.abs(trashed.city_pin.lng - 140) < 1);
  assert.ok(trashed.deleted_at);
  assert.equal(trashed.revision, deletion);
  assert.deepEqual(await list("bob", "?include=trash"), []);
  assert.equal((await move("restore", deletion, crypto.randomUUID(), "bob")).status, 404);
  assert.equal((await worker.fetch(request("POST", data), env)).status, 409);
  const stale = form();
  stale.set("document", data.get("document"));
  stale.set("revision", "");
  stale.set("photoKeys", JSON.stringify([saved.photos[0].key]));
  assert.equal((await worker.fetch(request("PATCH", stale, "alice", path), env)).status, 409);
  const restoration = crypto.randomUUID();
  assert.equal((await move("restore", deletion, restoration)).status, 200);
  assert.equal((await move("restore", deletion, restoration)).status, 200);
  assert.equal((await move("trash", null, deletion)).status, 409);
  assert.equal((await worker.fetch(request("PATCH", stale, "alice", path), env)).status, 409);
  const [restored] = await list();
  assert.deepEqual(restored, { ...saved, deleted_at: null, revision: restoration });
  const photo = await worker.fetch(request("GET", undefined, "alice", "/api/photos/" + saved.photos[0].key), env);
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png);
});

test("a legacy story can gain dated sections and retain its photo and date range across edits", async () => {
  const env = storage();
  const create = form(undefined, 1);
  create.set("date", "2026-12-31");
  create.set("story", "Before midnight");
  const saved = await (await worker.fetch(request("POST", create), env)).json();
  assert.equal(saved.end_date, null);
  const path = "/api/trips/" + saved.id;
  const edit = form();
  edit.set("date", saved.date);
  edit.set("end_date", "2027-01-01");
  edit.set("revision", "");
  edit.set("photoKeys", JSON.stringify([saved.photos[0].key]));
  const paragraph = text => ({ type: "paragraph", content: [{ type: "text", text }] });
  const day = { type: "daySection", attrs: { date: "2027-01-01" }, content: [
    paragraph("First sunrise"), { type: "image", attrs: { index: 0, caption: "Dawn" } },
  ] };
  const doc = { type: "doc", version: 2, content: [paragraph(saved.story), day] };
  edit.set("document", JSON.stringify(doc));
  const patch = () => worker.fetch(request("PATCH", edit, "alice", path), env);
  const updated = await (await patch()).json();
  assert.deepEqual(updated.document, doc);
  assert.equal(updated.end_date, "2027-01-01");
  assert.match(updated.story, /Before midnight[\s\S]*First sunrise/);
  assert.deepEqual(updated.photos, [{ key: saved.photos[0].key, alt: "Dawn" }]);
  edit.set("revision", updated.revision);
  edit.set("id", crypto.randomUUID());
  for (const invalidEnd of ["2026-12-30", "2027-02-29", ""]) {
    edit.set("end_date", invalidEnd);
    assert.equal((await patch()).status, 400);
  }
  edit.delete("end_date");
  day.attrs.date = "2027-01-02";
  edit.set("document", JSON.stringify(doc));
  assert.equal((await patch()).status, 400);
  day.attrs.date = "2027-01-01";
  edit.set("document", JSON.stringify(doc));
  assert.equal((await (await patch()).json()).end_date, "2027-01-01");
  const [listed] = await (await worker.fetch(request("GET"), env)).json();
  assert.deepEqual(listed.document, doc);
  assert.equal(listed.end_date, "2027-01-01");
});

test("city pins use catalog coordinates and support changing, preserving and removing a pin", async () => {
  const env = storage();
  const data = form();
  data.set("story", "A walk through the market");
  data.set("map_city", JSON.stringify({ label: "Unknown", lat: 190, lng: 360 }));
  assert.equal((await worker.fetch(request("POST", data), env)).status, 400);
  data.set("map_city", "tokyo, japan");
  const saved = await (await worker.fetch(request("POST", data), env)).json();
  assert.equal(saved.city_pin.label, "Tokyo, Japan");
  assert.ok(Math.abs(saved.city_pin.lat - 35.7) < 1);
  assert.equal(saved.destination, "Goa");
  const edit = form();
  edit.set("photoKeys", "[]");
  edit.set("document", JSON.stringify({ version: 1, type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: saved.story }] },
  ] }));
  let revision = "";
  for (const city of [undefined, "Kyoto, Japan", ""]) {
    edit.set("id", crypto.randomUUID());
    edit.set("revision", revision);
    if (city !== undefined) edit.set("map_city", city);
    const response = await worker.fetch(request("PATCH", edit, "alice", "/api/trips/" + saved.id), env);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.city_pin?.label ?? "", city ?? saved.city_pin.label);
    revision = result.revision;
  }
  const [trip] = await (await worker.fetch(request("GET"), env)).json();
  assert.equal(trip.city_pin, null);
  assert.equal(trip.story, saved.story);
});

test("Indian place suggestions resolve to distinct saved pins using common spellings", async () => {
  const { indexPlaces, findPlaces } = await import("../src/place-search.js");
  const catalog = await worker.fetch(request("GET", undefined, null, "/map-cities.json"), {});
  const index = indexPlaces(await catalog.json());
  const env = storage();
  for (const [query, label] of [
    ["Rishikesh", "Rishikesh, Uttarakhand, India"],
    ["Spiti Valley", "Spiti Valley, Himachal Pradesh, India"],
    ["Havlock Islands", "Swaraj Dweep, Andaman and Nicobar Islands, India"],
    ["Havelock Island", "Swaraj Dweep, Andaman and Nicobar Islands, India"],
    ["Palolem", "Palolem Beach, Goa, India"],
    ["Canacona", "Canacona, Goa, India"],
    ["Bangalore", "Bengaluru, Karnataka, India"],
  ]) {
    assert.equal(findPlaces(index, query)[0].label, label);
    const data = form();
    data.set("map_city", label);
    data.set("story", "A holiday memory");
    const response = await worker.fetch(request("POST", data), env);
    assert.equal(response.status, 201);
    const saved = await response.json();
    assert.equal(saved.city_pin.label, label);
  }
});
