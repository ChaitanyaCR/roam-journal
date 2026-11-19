import { searchPlaces, verifyPlace } from "./online-places.mjs";
import { normalizeDocument, documentText, validDate } from "../shared/story-document.mjs";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const MB = 1024 * 1024;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const tripColumns = "id, title, destination, date, story, photos, blocks, document, revision, tags, deleted_at, end_date, city_pin";
const photoLimit = "Choose up to 12 JPG, PNG, or WebP photos, up to 8 MB each and 28 MB total.";
const formats = {
  "image/jpeg": b => b[0] === 255 && b[1] === 216 && b[2] === 255,
  "image/png": b => [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v),
  "image/webp": b => String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.slice(8, 12)) === "WEBP",
};

function json(body, status = 200) {
  return Response.json(body, { status, headers });
}

function error(message, status) {
  return json({ message }, status);
}

function trip(row) {
  const photos = JSON.parse(row.photos);
  const blocks = row.blocks ? JSON.parse(row.blocks) : [
    { type: "text", text: row.story },
    ...photos.map((_, index) => ({ type: "photo", index })),
  ];
  return { ...row, city_pin: JSON.parse(row.city_pin ?? "null"), tags: JSON.parse(row.tags), photos, blocks, document: row.document ? JSON.parse(row.document) : null };
}

async function listTrips(db, owner, includeTrash) {
  const filter = includeTrash ? "" : " AND deleted_at IS NULL";
  const query = db.prepare(`SELECT ${tripColumns} FROM trips WHERE owner = ?${filter} ORDER BY date DESC, id DESC`);
  const { results } = await query.bind(owner).all();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(owner));
  const scope = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return Response.json(results.map(trip), { headers: { ...headers, "X-Roam-Draft-Scope": scope } });
}

function editConflict() {
  return error("This trip was updated in another session. Copy any changes you want to keep, then refresh the journal for the latest version.", 409);
}

async function changeTrash(request, db, owner, id, restore) {
  const data = await request.json().catch(() => null);
  if (typeof data?.requestId !== "string" || !uuid.test(data.requestId) || data.requestId === data.revision ||
      (data.revision !== null && (typeof data.revision !== "string" || !uuid.test(data.revision)))) {
    return error("The trip revision could not be read.", 400);
  }
  const condition = restore ? "deleted_at IS NOT NULL" : "deleted_at IS NULL";
  const row = await db.prepare(`UPDATE trips SET deleted_at = ?, revision = ?
    WHERE owner = ? AND id = ? AND revision IS ? AND ${condition} RETURNING ${tripColumns}`)
    .bind(restore ? null : new Date().toISOString(), data.requestId, owner, id, data.revision).first();
  if (row) return json(trip(row));

  const existing = await db.prepare(`SELECT ${tripColumns} FROM trips WHERE owner = ? AND id = ?`).bind(owner, id).first();
  if (!existing) return error("Trip not found.", 404);
  if (existing.revision === data.requestId && (existing.deleted_at === null) === restore) return json(trip(existing));
  return editConflict();
}

async function deletePhotos(bucket, photos, keep) {
  const keptKeys = new Set(keep.map(photo => photo.key));
  if (bucket) await Promise.allSettled(photos.filter(photo => !keptKeys.has(photo.key)).map(photo => bucket.delete(photo.key)));
}

let cityCatalog;
function resolveCity(label) {
  if (!cityCatalog) {
    cityCatalog = new Map(JSON.parse(assets["/map-cities.json"].body).map(([label, lat, lng]) => [
      label.toLowerCase(), { label, lat, lng },
    ]));
  }
  return cityCatalog.get(label.toLowerCase());
}

async function saveTrip(request, { DB: db, BUCKET: bucket, GEOAPIFY_API_KEY: geoKey }, owner, tripId = null) {
  if (Number(request.headers.get("content-length")) > 29 * MB) {
    return error("Keep the combined photo size under 28 MB.", 413);
  }

  const data = await request.formData().catch(() => null);
  if (!data) return error("The trip form could not be read.", 400);
  const field = name => String(data.get(name) ?? "").trim();
  const requestId = field("id");
  const id = tripId ?? requestId;
  const lookup = () => db.prepare(`SELECT ${tripColumns} FROM trips WHERE owner = ? AND id = ?`).bind(owner, id).first();
  const title = field("title");
  const destination = field("destination");
  const rawTags = field("tags");
  if (rawTags.length > 500) return error("Keep tags under 501 characters in total.", 400);
  const tags = [];
  const seenTags = new Set();
  for (const part of rawTags.split(",")) {
    const tag = part.trim();
    const key = tag.toLowerCase();
    if (tag && !seenTags.has(key)) {
      tags.push(tag);
      seenTags.add(key);
    }
  }
  const date = field("date");
  const cityLabel = field("map_city");
  let pin = cityLabel ? resolveCity(cityLabel) : null;
  let endDate = field("end_date") || null;
  let story = field("story");
  const files = data.getAll("photos");
  const revision = tripId ? requestId : null;
  const expectedRevision = field("revision") || null;
  let existingPhotos = [];
  let photoKeys = files.map(() => null);
  if (tripId) {
    if (!uuid.test(requestId) || !data.has("revision") ||
        (expectedRevision && !uuid.test(expectedRevision)) || expectedRevision === revision || !data.has("document")) {
      return error("The trip edit could not be read.", 400);
    }
    const existing = await lookup();
    if (!existing) return error("Trip not found.", 404);
    if (existing.deleted_at) return editConflict();
    if (existing.revision === revision) return json(trip(existing));
    if (existing.revision !== expectedRevision) return editConflict();
    const savedPin = JSON.parse(existing.city_pin ?? "null");
    if (!data.has("map_city") || cityLabel === savedPin?.label) pin = savedPin;
    if (!data.has("end_date")) endDate = existing.end_date ?? null;
    if (!data.has("tags")) tags.push(...JSON.parse(existing.tags));
    existingPhotos = JSON.parse(existing.photos);
    const rawKeys = field("photoKeys");
    if (rawKeys.length > 1024) return error(photoLimit, 400);
    try { photoKeys = JSON.parse(rawKeys); } catch { return error("The story photos could not be read.", 400); }
    if (!Array.isArray(photoKeys) || photoKeys.length > 12) return error(photoLimit, 400);
    const retained = photoKeys.filter(key => key !== null);
    const allowed = new Set(existingPhotos.map(photo => photo.key));
    if (photoKeys.length - retained.length !== files.length || new Set(retained).size !== retained.length ||
        retained.some(key => !allowed.has(key))) {
      return error("The story contains an invalid photo.", 400);
    }
  }
  if (field("online_place")) {
    pin = await verifyPlace(field("online_place"), geoKey, owner, cityLabel);
    if (!pin) return error("Select the place again using Search more places.", 400);
  }
  if (cityLabel && !pin) return error("Choose a city from the map suggestions or clear the map city field.", 400);
  let blocks;
  let document = null;
  if (data.has("document")) {
    const raw = field("document");
    if (raw.length > 250000) return error("The story is too long.", 400);
    try { document = normalizeDocument(JSON.parse(raw), photoKeys.length, { start: date, end: endDate }); }
    catch (failure) { return error(failure.message || "The story could not be read.", 400); }
    story = documentText(document);
    blocks = [{ type: "text", text: story }, ...photoKeys.map((_, index) => ({ type: "photo", index }))];
  } else if (data.has("blocks")) {
    const raw = field("blocks");
    if (raw.length > 150000) return error("The story is too long.", 400);
    try { blocks = JSON.parse(raw); } catch { return error("The story could not be read.", 400); }
    if (!Array.isArray(blocks) || !blocks.length || blocks.length > 100 || blocks.some(block =>
      !block || (block.type !== "text" && block.type !== "photo") ||
      (block.type === "text" && typeof block.text !== "string") ||
      (block.type === "photo" && (!Number.isInteger(block.index) || block.index < 0 || block.index >= files.length)))) {
      return error("The story contains an invalid text or photo section.", 400);
    }
    const references = blocks.filter(block => block.type === "photo").map(block => block.index);
    if (references.length !== files.length || new Set(references).size !== references.length) {
      return error("Each photo must appear once in the story.", 400);
    }
    blocks = blocks.map(block => block.type === "text"
      ? { type: "text", text: block.text.trim() }
      : { type: "photo", index: block.index });
    story = blocks.filter(block => block.type === "text").map(block => block.text).filter(Boolean).join("\n\n");
  } else {
    blocks = [{ type: "text", text: story }, ...files.map((_, index) => ({ type: "photo", index }))];
  }
  if (!uuid.test(id) || !title || title.length > 100 || !destination || destination.length > 100 ||
      !story || story.length > 20000 || !validDate(date)) {
    return error("Add a title, destination, valid date, and story.", 400);
  }

  if (endDate && (!validDate(endDate) || endDate < date)) {
    return error("Choose an end date on or after the start date.", 400);
  }

  if (!tripId) {
    const existing = await lookup();
    if (existing?.deleted_at) return editConflict();
    if (existing) return json(trip(existing));
  }

  const uploadBytes = files.reduce((sum, file) => sum + (file.size ?? 0), 0);
  if (files.length > 12 || files.some(file => typeof file === "string" ||
      !file.size || file.size > 8 * MB || !Object.hasOwn(formats, file.type)) || uploadBytes > 28 * MB) {
    return error(photoLimit, 400);
  }
  for (const file of files) {
    const signature = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (!formats[file.type](signature)) return error("One of the photos could not be read.", 400);
  }

  if (files.length && !bucket) return error("Photo storage is temporarily unavailable.", 503);
  if (files.length && tripId) {
    const kept = await Promise.all(photoKeys.filter(key => key !== null).map(key => bucket.head(key)));
    if (kept.some(photo => !photo)) return error("A saved photo could not be found. Reopen the trip or remove the missing photo.", 409);
    if (kept.reduce((sum, photo) => sum + photo.size, uploadBytes) > 28 * MB) return error(photoLimit, 400);
  }

  const captions = [];
  function readCaptions(node) {
    if (node.type === "image") captions[node.attrs.index] = node.attrs.caption;
    node.content?.forEach(readCaptions);
  }
  if (document) readCaptions(document);

  const photos = [];
  const uploaded = [];
  let fileIndex = 0;
  let writeAttempted = false;
  let conflict = false;
  try {
    for (const [index, keptKey] of photoKeys.entries()) {
      const photo = { key: keptKey ?? crypto.randomUUID(), alt: captions[index] ?? field("alt" + index).slice(0, 160) };
      photos.push(photo);
      if (keptKey === null) {
        const file = files[fileIndex++];
        uploaded.push(photo);
        await bucket.put(photo.key, file.stream(), {
          httpMetadata: { contentType: file.type },
          customMetadata: { owner },
        });
      }
    }
    const values = [title, destination, date, endDate, pin ? JSON.stringify(pin) : null, story, JSON.stringify(photos), JSON.stringify(blocks), document ? JSON.stringify(document) : null, JSON.stringify(tags)];
    writeAttempted = true;
    if (tripId) {
      const update = await db.prepare("UPDATE trips SET title = ?, destination = ?, date = ?, end_date = ?, city_pin = ?, story = ?, photos = ?, blocks = ?, document = ?, tags = ?, revision = ? WHERE owner = ? AND id = ? AND revision IS ? AND deleted_at IS NULL")
        .bind(...values, revision, owner, id, expectedRevision).run();
      if (!update.meta.changes) {
        conflict = true;
        throw new Error("The trip revision changed.");
      }
    } else {
      await db.prepare("INSERT INTO trips (id, owner, title, destination, date, end_date, city_pin, story, photos, blocks, document, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, owner, ...values).run();
    }
  } catch {
    const saved = writeAttempted ? await lookup().catch(() => undefined) : undefined;
    const savedTrip = saved ? trip(saved) : null;
    if (!writeAttempted || saved !== undefined || conflict) await deletePhotos(bucket, uploaded, savedTrip?.photos ?? []);
    if (savedTrip?.deleted_at) return editConflict();
    if (savedTrip && (!tripId || savedTrip.revision === revision)) {
      if (tripId) await deletePhotos(bucket, existingPhotos, savedTrip.photos);
      return json(savedTrip);
    }
    if (conflict) return editConflict();
    return error("The trip could not be saved. Try again.", 503);
  }

  if (tripId) await deletePhotos(bucket, existingPhotos, photos);
  return json({ id, title, destination, date, end_date: endDate, city_pin: pin, story, photos, blocks, document, revision, tags }, tripId ? 200 : 201);
}

async function getPhoto(bucket, key, owner) {
  if (!uuid.test(key)) return error("Photo not found.", 404);
  const photo = await bucket?.get(key);
  if (!photo || photo.customMetadata?.owner !== owner) return error("Photo not found.", 404);
  const responseHeaders = new Headers(headers);
  photo.writeHttpMetadata(responseHeaders);
  return new Response(photo.body, { headers: responseHeaders });
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && Object.hasOwn(assets, path)) {
      const { body, type } = assets[path];
      return new Response(body, { headers: { ...headers, "Content-Type": type } });
    }

    const owner = request.headers.get("oai-authenticated-user-id");
    if (!owner) return error("Sign in to open your journal.", 401);
    const origin = request.headers.get("origin");
    if (request.method !== "GET" && origin && origin !== new URL(request.url).origin) return error("Invalid request origin.", 403);
    try {
      if (path === "/api/places/search" && request.method === "POST") {
        const result = await searchPlaces(request, env.GEOAPIFY_API_KEY, owner);
        return result.message ? error(result.message, result.status) : json(result.places);
      }
      const action = path.match(/^\/api\/trips\/([^/]+)\/(trash|restore)$/);
      if (action && request.method === "POST") {
        if (!uuid.test(action[1])) return error("Trip not found.", 404);
        if (!env.DB) return error("Journal storage is temporarily unavailable.", 503);
        return await changeTrash(request, env.DB, owner, action[1], action[2] === "restore");
      }
      if (path === "/api/trips") {
        if (!env.DB) return error("Journal storage is temporarily unavailable.", 503);
        if (request.method === "GET") return await listTrips(env.DB, owner, new URL(request.url).searchParams.get("include") === "trash");
        if (request.method === "POST") return await saveTrip(request, env, owner);
        return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, POST" } });
      }
      if (request.method === "PATCH" && path.startsWith("/api/trips/")) {
        const id = path.slice("/api/trips/".length);
        if (!uuid.test(id)) return error("Trip not found.", 404);
        if (!env.DB) return error("Journal storage is temporarily unavailable.", 503);
        return await saveTrip(request, env, owner, id);
      }
      if (request.method === "GET" && path.startsWith("/api/photos/")) {
        return await getPhoto(env.BUCKET, path.slice("/api/photos/".length), owner);
      }
      return error("Page not found.", 404);
    } catch {
      return error("Journal storage is temporarily unavailable.", 503);
    }
  },
};
