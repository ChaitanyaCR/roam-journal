import { indexPlaces, findPlaces } from "./place-search.js";
import { createWritingEditor } from "./writing-editor.js";
import { layoutStoryPhotos, renderStory } from "./story-renderer.js";
import { clearDraft, readDraft, saveDraft } from "./trip-drafts.js";
import { createPhotoViewer } from "./photo-viewer.js";

const $ = selector => document.querySelector(selector);
const composer = $("#composer");
const detail = $("#detail");
const form = $("#trip-form");
const save = $("#save");
const addButtons = document.querySelectorAll("[data-add]");
const openPhotos = createPhotoViewer($("#photo-viewer"), trip => showDetail(trip));
const draftStatus = $("#draft-status");
const discard = $("#discard-draft");
let trips = [];
let view = "stories";
let state = "loading";
let writing = null;
let dirty = false;
let preview = false;
let insertPosition;
let requestId;
let editingTrip = null;
let baseRevision;
let busy = false;
let openingComposer = false;
let draftScope;
let draftKey;
let draftStamp;
let persistedStamp;
let draftTimer;
let draftWrites = Promise.resolve();
const search = $("#trip-search");
const yearFilter = $("#trip-year");
const tagFilter = $("#trip-tag");
const draftFields = ["title", "destination", "map_city", "date", "end_date", "tags"];
const dateLabel = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" });

const monthLabel = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" });

function element(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, className, click) {
  const node = element("button", text, className);
  node.type = "button";
  node.addEventListener("click", click);
  return node;
}

function tripDate({ date: start, end_date: end }) {
  if (end && end !== start) {
    return element("span", dateLabel.formatRange(new Date(start), new Date(end)), "trip-range");
  }
  const date = element("time", dateLabel.format(new Date(start)));
  date.dateTime = start;
  return date;
}

function image(photo, trip) {
  const node = element("img");
  node.src = "/api/photos/" + encodeURIComponent(photo.key);
  node.alt = photo.alt || "Photo from " + trip.title;
  node.loading = "lazy";
  return node;
}

function trashButton(trip) {
  const restore = Boolean(trip.deleted_at);
  const requestId = crypto.randomUUID();
  const control = button(restore ? "Restore trip" : "Move to Trash", "secondary", async () => {
    if (busy) return;
    busy = true;
    control.disabled = true;
    try {
      const action = restore ? "restore" : "trash";
      const response = await fetch(`/api/trips/${encodeURIComponent(trip.id)}/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, revision: trip.revision ?? null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "The trip could not be updated.");
      setTrips(trips.map(item => item.id === result.id ? result : item));
      if (control.isConnected && detail.open) detail.close();
      render();
      $("#notice").textContent = restore ? "Trip restored." : "Trip moved to Trash.";
      $("#notice").hidden = false;
    } catch (failure) {
      if (control.isConnected && detail.open) showDetailError(control, failure.message || "Try again.");
    } finally {
      busy = false;
      control.disabled = false;
    }
  });
  return control;
}

function showDetailError(control, message) {
  let alert = $("#detail-content [role=alert]");
  if (!alert) {
    alert = element("p", "", "error");
    alert.setAttribute("role", "alert");
    control.parentElement.after(alert);
  }
  alert.textContent = message;
}

function showDetail(trip, notice) {
  const content = $("#detail-content");
  content.replaceChildren();
  content.append(element("p", trip.destination, "location"));
  content.append(element("h2", trip.title));
  const date = tripDate(trip);
  const story = element("div", "", "story-content");
  const sections = trip.blocks || [
    { type: "text", text: trip.story },
    ...trip.photos.map((_, index) => ({ type: "photo", index })),
  ];
  if (trip.document) {
    story.append(renderStory(trip.document, trip.photos));
  } else {
    for (const section of sections) {
      if (section.type === "text") {
        if (section.text) story.append(element("p", section.text, "story-text"));
      } else {
        const item = trip.photos[section.index];
        if (!item) continue;
        const figure = element("figure");
        figure.dataset.photoKey = item.key;
        figure.append(image(item, trip));
        if (item.alt) figure.append(element("figcaption", item.alt));
        story.append(figure);
      }
    }
    layoutStoryPhotos(story);
  }
  for (const figure of story.querySelectorAll("figure[data-photo-key]")) {
    const photoButton = button("", "story-photo-open", event => openPhotos(trip, figure.dataset.photoKey, event.currentTarget));
    const photoImage = figure.querySelector("img");
    photoButton.setAttribute("aria-label", photoImage.alt + " — open photo");
    photoImage.before(photoButton);
    photoButton.append(photoImage);
  }
  const meta = element("div", "", "detail-meta");
  meta.append(date);
  if (!trip.deleted_at) meta.append(button("Edit trip", "secondary", () => openComposer(trip)));
  meta.append(trashButton(trip));
  content.append(meta);
  if (trip.tags?.length) content.append(element("p", trip.tags.join(" · "), "trip-tags"));
  if (notice) {
    const status = element("p", notice, "notice");
    status.setAttribute("role", "status");
    content.append(status);
  }
  content.append(story);
  detail.setAttribute("aria-label", trip.title);
  if (!detail.open) detail.showModal();
  detail.scrollTop = 0;
}

function tripCard(trip) {
  const card = button("", "card", () => showDetail(trip));
  card.append(trip.photos[0] ? image(trip.photos[0], trip) : element("div", "✧", "no-cover"));
  const copy = element("div", "", "card-copy");
  const date = tripDate(trip);
  copy.append(element("span", trip.destination, "location"), element("h3", trip.title), date,
    element("p", trip.story), element("span", "Read story →", "read"));
  card.append(copy);
  return card;
}

function updateOptions(select, choices) {
  const previous = select.value;
  select.replaceChildren(select.options[0], ...choices.map(([value, label]) => {
    const option = element("option", label);
    option.value = value;
    return option;
  }));
  select.value = choices.some(([value]) => value === previous) ? previous : "";
}

function setTrips(next) {
  trips = next.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const years = new Set();
  const tags = new Map();
  for (const trip of trips) {
    if (trip.deleted_at) continue;
    years.add(trip.date.slice(0, 4));
    for (const tag of trip.tags ?? []) {
      const key = tag.toLowerCase();
      if (!tags.has(key)) tags.set(key, tag);
    }
  }
  updateOptions(yearFilter, [...years].sort().reverse().map(year => [year, year]));
  updateOptions(tagFilter, [...tags].sort(([a], [b]) => a.localeCompare(b)));
}

function filteredTrips(query, year, tag) {
  return trips.filter(trip => {
    if (trip.deleted_at) return false;
    if (year && trip.date.slice(0, 4) !== year) return false;
    if (tag && !trip.tags?.some(value => value.toLowerCase() === tag)) return false;
    return !query || [trip.title, trip.destination, trip.story, ...trip.photos.map(photo => photo.alt)]
      .some(value => value?.toLowerCase().includes(query));
  });
}

function timeline(matching) {
  const root = element("div", "", "timeline");
  let previousMonth = "";
  let yearSection;
  let list;
  let day;
  let previousDate;
  let dayIndex = 0;
  for (const trip of matching) {
    const year = trip.date.slice(0, 4);
    const month = trip.date.slice(0, 7);
    if (year !== previousMonth.slice(0, 4)) {
      yearSection = element("section");
      yearSection.append(element("h3", year));
      root.append(yearSection);
    }
    if (month !== previousMonth) {
      list = element("ul");
      yearSection.append(element("h4", monthLabel.format(new Date(trip.date))), list);
      previousMonth = month;
    }
    if (trip.date !== previousDate) {
      const item = element("li", "", dayIndex % 2 === 0 ? "timeline-left" : "timeline-right");
      item.dataset.color = String(dayIndex % 6);
      day = element("div", "", "timeline-day");
      day.append(tripDate({ date: trip.date }));
      item.append(day);
      list.append(item);
      previousDate = trip.date;
      dayIndex++;
    }
    const card = button("", "timeline-trip", () => showDetail(trip));
    const cover = trip.photos[0] ? image(trip.photos[0], trip) : element("span", "✧", "timeline-placeholder");
    cover.setAttribute("aria-hidden", "true");
    const copy = element("span", "", "timeline-copy");
    copy.append(element("strong", trip.title), element("span", trip.destination, "location"));
    if (trip.end_date && trip.end_date !== trip.date) copy.append(tripDate(trip));
    if (trip.story) copy.append(element("span", trip.story, "timeline-excerpt"));
    card.append(cover, copy);
    day.append(card);
  }
  return root;
}

let selectedCity = "";
function worldMap(pinned) {
  const groups = new Map();
  for (const trip of pinned) {
    const label = trip.city_pin.label;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(trip);
  }
  const root = element("div", "", "world-map");
  const chart = element("div", "", "map-chart");
  chart.setAttribute("role", "group");
  chart.setAttribute("aria-label", "World map of your trips");
  root.append(chart);
  if (!pinned.length) {
    selectedCity = "";
    return root;
  }
  const panel = element("div", "", "map-panel");
  const label = element("label", "Location");
  const picker = element("select");
  const stories = element("ul", "", "map-stories");
  label.append(picker);
  panel.append(label, stories);
  root.append(panel);
  const markers = new Map();
  function selectCity(city) {
    selectedCity = picker.value = city;
    for (const [key, marker] of markers) marker.setAttribute("aria-pressed", String(key === city));
    stories.replaceChildren(...groups.get(city).map(trip => {
      const item = element("li");
      const read = button("", "map-story", () => showDetail(trip));
      read.append(element("strong", trip.title), tripDate(trip));
      item.append(read);
      return item;
    }));
  }
  for (const city of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
    const trips = groups.get(city);
    const { lat, lng } = trips[0].city_pin;
    const caption = city + " · " + trips.length + (trips.length === 1 ? " trip" : " trips");
    const option = element("option", caption);
    option.value = city;
    picker.append(option);
    const marker = button("", "map-pin", () => selectCity(city));
    marker.title = caption;
    marker.setAttribute("aria-label", caption);
    marker.style.left = ((lng + 180) / 360 * 100) + "%";
    marker.style.top = ((90 - lat) / 180 * 100) + "%";
    chart.append(marker);
    markers.set(city, marker);
  }
  picker.addEventListener("change", () => selectCity(picker.value));
  selectCity(groups.has(selectedCity) ? selectedCity : picker.options[0].value);
  return root;
}

function clearFilters() {
  search.value = "";
  yearFilter.value = "";
  tagFilter.value = "";
  render();
  search.focus();
}

function render() {
  const entries = $("#entries");
  const count = $("#count");
  const gallery = view === "gallery";
  const trash = view === "trash";
  $("#trip-filters").hidden = state !== "ready" || trash;
  const query = search.value.trim().toLowerCase();
  const matching = trash ? trips.filter(trip => trip.deleted_at) : filteredTrips(query, yearFilter.value, tagFilter.value);
  const photos = gallery ? matching.flatMap(trip => trip.photos.map(photo => ({ trip, photo }))) : [];
  entries.replaceChildren();
  $("#journal-title").textContent = { stories: "Trip stories", gallery: "Photo gallery", timeline: "Timeline", map: "World Map", trash: "Trash" }[view];
  count.textContent = "";
  for (const control of document.querySelectorAll("[data-view]")) {
    const active = control.dataset.view === view;
    control.classList.toggle("active", active);
    control.setAttribute("aria-pressed", String(active));
  }
  for (const control of addButtons) {
    control.hidden = state === "signed-out";
    control.disabled = state === "loading";
  }
  $("#signin").hidden = state !== "signed-out";

  const empty = element("div", "", "empty");
  if (state === "loading") {
    empty.setAttribute("role", "status");
    empty.textContent = "Opening your journal…";
  } else if (state === "error") {
    empty.append(element("h3", "Your journal couldn’t load"), button("Try again", "secondary", load));
  } else if (state === "signed-out") {
    empty.append(element("h3", "Sign in to view your journal"));
  } else {
    if (view === "map") {
      const pinned = matching.filter(trip => trip.city_pin);
      entries.append(worldMap(pinned));
      count.textContent = pinned.length + (pinned.length === 1 ? " pinned trip" : " pinned trips");
      if (!pinned.length) {
        const filtered = query || yearFilter.value || tagFilter.value;
        empty.append(element("h3", filtered ? "No matching pinned trips" : "Your map is empty"),
          element("p", "Choose a map city in a trip’s editor to add a pin."));
        if (filtered) empty.append(button("Clear filters", "secondary", clearFilters));
        entries.append(empty);
      }
      return;
    }
    const length = gallery ? photos.length : matching.length;
    count.textContent = length + (gallery ? " photo" : " trip") + (length === 1 ? "" : "s");
    if (length && view === "timeline") {
      entries.append(timeline(matching));
      return;
    }
    if (length) {
      const grid = element("div", "", gallery ? "gallery" : "cards");
      if (!gallery) grid.append(...matching.map(tripCard));
      else grid.append(...photos.map(({ trip, photo }) => {
        const tile = button("", "gallery-tile", event => openPhotos(trip, photo.key, event.currentTarget));
        tile.append(image(photo, trip), element("span", trip.destination));
        return tile;
      }));
      entries.append(grid);
      return;
    }
    if (trash) {
      empty.append(element("h3", "Trash is empty"));
      entries.append(empty);
      return;
    }
    if (query || yearFilter.value || tagFilter.value) {
      empty.append(element("h3", matching.length ? "Matching trips have no photos" : "No matching trips"),
        button("Clear filters", "secondary", clearFilters));
      entries.append(empty);
      return;
    }
    const icon = element("span", gallery ? "▧" : "✎", "empty-icon");
    icon.setAttribute("aria-hidden", "true");
    empty.append(icon, element("h3", gallery ? "Your gallery is empty" : "Your story starts here"),
      element("p", gallery ? "Photos you add to a trip will appear here." : "Pick a trip you’d like to remember and give it a page."),
      button(gallery ? "Add a trip" : "Add your first trip", "secondary", () => openComposer()));
  }
  entries.append(empty);
}

search.addEventListener("input", render);
yearFilter.addEventListener("change", render);
tagFilter.addEventListener("change", render);

async function load() {
  state = "loading";
  render();
  try {
    const response = await fetch("/api/trips?include=trash", { cache: "no-store" });
    if (response.status === 401) {
      draftScope = undefined;
      state = "signed-out";
    }
    else {
      if (!response.ok) throw new Error();
      setTrips(await response.json());
      draftScope = response.headers.get("X-Roam-Draft-Scope");
      state = "ready";
    }
  } catch {
    state = "error";
  }
  render();
}

function changeView(next) {
  view = next;
  render();
  $("#journal").scrollIntoView({ block: "start" });
}

function formError(message = "") {
  const node = $("#form-error");
  node.textContent = message;
  node.hidden = !message;
}

function clearFiles() {
  clearTimeout(draftTimer);
  writing?.editor.destroy();
  writing = null;
  $("#writing-editor").replaceChildren();
  dirty = false;
  preview = false;
  form.querySelector("fieldset").hidden = false;
  $("#composer-preview").hidden = true;
  $("#preview-toggle").textContent = "Preview story";
  $("#preview-toggle").setAttribute("aria-pressed", "false");
}

function updateToolbar(editor) {
  let photos = 0;
  editor.state.doc.descendants(node => { if (node.type.name === "image") photos++; });
  $("#draft-count").textContent = `${editor.getText().length.toLocaleString()} / 20,000 characters · ${photos} / 12 photos`;
  for (const control of document.querySelectorAll("[data-command]")) {
    const command = control.dataset.command;
    if (command === "undo" || command === "redo") control.disabled = !editor.can()[command]();
    else control.setAttribute("aria-pressed", String(command === "heading"
      ? editor.isActive("heading", { level: 2 }) : editor.isActive(command)));
  }
}

async function openComposer(trip = null) {
  if (busy || openingComposer || composer.open || state === "loading") return;
  const key = draftScope && typeof indexedDB !== "undefined" ? `${draftScope}:${trip?.id ?? "new"}` : undefined;
  let draft;
  let storageError = false;
  if (key) {
    openingComposer = true;
    try { draft = await readDraft(key); }
    catch { storageError = true; }
    finally { openingComposer = false; }
  }
  form.reset();
  clearFiles();
  draftKey = key;
  draftStamp = persistedStamp = draft?.stamp;
  editingTrip = trip;
  baseRevision = draft ? draft.baseRevision : trip?.revision;
  requestId = draft?.requestId ?? crypto.randomUUID();
  formError();
  $("#notice").hidden = true;
  $("#form-title").textContent = trip ? "Edit trip" : draft ? "Resume draft" : "New trip";
  save.textContent = trip ? "Save changes" : "Save trip";
  const today = new Date();
  form.elements.title.value = trip?.title ?? "";
  form.elements.tags.value = trip?.tags?.join(",") ?? "";
  form.elements.destination.value = trip?.destination ?? "";
  form.elements.map_city.value = trip?.city_pin?.label ?? "";
  $("#city-hint").hidden = true;
  form.elements.date.value = trip?.date ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  form.elements.end_date.value = trip?.end_date ?? "";
  if (draft) {
    for (const name of draftFields) {
      if (draft.fields[name] !== undefined) form.elements[name].value = draft.fields[name];
    }
  }
  form.elements.end_date.min = form.elements.date.value;
  discard.hidden = !draft;
  const storedTime = draft && new Date(draft.savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  draftStatus.textContent = draft ? `Draft restored · Saved at ${storedTime}`
    : storageError || !key ? "Draft autosave is unavailable." : "";
  if (draft && trip && (baseRevision ?? null) !== (trip.revision ?? null) && requestId !== trip.revision) {
    formError("This trip has changed since this draft was saved. You can review or copy your draft here. Discard the draft to edit the latest version.");
  }
  composer.showModal();
  writing = createWritingEditor({ element: $("#writing-editor"), trip, draft, onChange: updateToolbar, onError: formError });
  writing.editor.on("update", markDirty);
  updateToolbar(writing.editor);
  form.elements.title.focus();
}

async function persistDraft() {
  if (!draftKey || !writing || !dirty) return !dirty;
  clearTimeout(draftTimer);
  const stamp = draftStamp;
  const key = draftKey;
  const savedAt = Date.now();
  try {
    requestId ??= crypto.randomUUID();
    const fields = Object.fromEntries(draftFields.map(name => [name, form.elements[name].value]));
    const snapshot = writing.snapshot();
    const uploads = snapshot.uploads.map(file => ({ blob: file, name: file.name }));
    const entry = { ...snapshot, uploads, fields, stamp, savedAt, requestId, baseRevision };
    const queued = draftWrites.then(async () => {
      if (!writing || draftKey !== key) return false;
      if (persistedStamp === stamp) return true;
      const saved = await saveDraft(key, entry, persistedStamp);
      if (saved) persistedStamp = stamp;
      return saved;
    });
    draftWrites = queued.catch(() => {});
    if (!await queued) {
      draftStatus.textContent = "The draft changed in another tab. The latest changes in this tab are unsaved.";
      return false;
    }
    if (draftStamp !== stamp) return false;
    dirty = false;
    draftStatus.textContent = "Draft saved at " + new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return true;
  } catch {
    draftStatus.textContent = "Draft autosave failed. Keep this tab open or save the trip.";
    return false;
  }
}

async function closeComposer() {
  if (busy) return;
  const stamp = draftStamp;
  if (dirty && !await persistDraft()) {
    if (busy || stamp !== draftStamp || !composer.open) return;
    if (!window.confirm("Close without saving your latest changes?")) return;
  }
  if (busy || stamp !== draftStamp || !composer.open) return;
  composer.close();
  clearFiles();
  editingTrip = null;
}

function markDirty() {
  if (!writing || busy) return;
  dirty = true;
  draftStamp = crypto.randomUUID();
  if (editingTrip) requestId = null;
  discard.hidden = !draftKey;
  if (!draftKey) return;
  draftStatus.textContent = "Saving draft…";
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => void persistDraft(), 250);
}

discard.addEventListener("click", async () => {
  if (busy || !window.confirm("Discard this draft?")) return;
  const stamp = draftStamp;
  const trip = editingTrip;
  await persistDraft();
  if (stamp !== draftStamp || busy || !composer.open) return;
  try {
    if (persistedStamp) await clearDraft(draftKey, persistedStamp);
    if (stamp !== draftStamp || busy || !composer.open) return;
    composer.close();
    clearFiles();
    editingTrip = null;
    if (trip) showDetail(trip);
  } catch {
    formError("The draft could not be discarded. Try again.");
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) void persistDraft();
});

const cityInput = form.elements.map_city;
let catalogRequest;
async function suggestCities() {
  const options = $("#map-cities");
  const hint = $("#city-hint");
  hint.hidden = true;
  const query = cityInput.value.trim().toLowerCase();
  options.replaceChildren();
  if (!query) return;
  try {
    catalogRequest ??= fetch("/map-cities.json").then(response => {
      if (!response.ok) throw new Error();
      return response.json();
    }).then(indexPlaces).catch(error => { catalogRequest = undefined; throw error; });
    const cities = await catalogRequest;
    if (cityInput.value.trim().toLowerCase() !== query) return;
    const matches = findPlaces(cities, query);
    options.replaceChildren(...matches.map(({ label, alias }) => {
      const option = element("option");
      option.value = label;
      if (alias) option.label = alias + " — " + label;
      return option;
    }));
    if (!matches.length) {
      const maps = element("a", "Search Google Maps ↗");
      maps.href = "https://www.google.com/maps/search/?" + new URLSearchParams({ api: "1", query: cityInput.value.trim() });
      maps.target = "_blank";
      maps.rel = "noopener noreferrer";
      hint.replaceChildren("No matching place. Try another spelling or clear the field to save without a pin. ", maps);
      hint.hidden = false;
    }
  } catch {
    hint.textContent = "City suggestions could not load. Type again to retry.";
    hint.hidden = false;
  }
}
cityInput.addEventListener("input", suggestCities);
cityInput.addEventListener("focus", suggestCities);
form.elements.date.addEventListener("input", () => { form.elements.end_date.min = form.elements.date.value; });
form.addEventListener("input", markDirty);
form.addEventListener("invalid", () => {
  // Reveal required metadata before the browser tries to focus an invalid field.
  if (!preview) return;
  preview = false;
  form.querySelector("fieldset").hidden = false;
  $("#composer-preview").hidden = true;
  $("#preview-toggle").textContent = "Preview story";
  $("#preview-toggle").setAttribute("aria-pressed", "false");
}, true);
$("#editor-toolbar").addEventListener("mousedown", event => {
  if (event.target.closest("button")) event.preventDefault();
});
for (const control of document.querySelectorAll("[data-command]")) {
  control.addEventListener("click", () => {
    if (!writing || busy) return;
    const chain = writing.editor.chain().focus();
    const command = control.dataset.command;
    if (command === "heading") chain.toggleHeading({ level: 2 }).run();
    else if (command === "bulletList") chain.toggleBulletList().run();
    else if (command === "bold") chain.toggleBold().run();
    else if (command === "italic") chain.toggleItalic().run();
    else chain[command]().run();
  });
}
$("#add-day").addEventListener("click", () => {
  if (!writing || busy) return;
  const editor = writing.editor;
  const pos = editor.state.doc.content.size;
  editor.chain().focus().insertContentAt(pos, {
    type: "daySection", attrs: { date: form.elements.end_date.value || form.elements.date.value },
    content: [{ type: "paragraph" }],
  }).setTextSelection(pos + 2).run();
});
$("#insert-photo").addEventListener("click", () => {
  if (!writing || busy) return;
  insertPosition = writing.editor.state.selection.from;
  $("#files").click();
});
$("#files").addEventListener("change", event => {
  if (writing && !busy) writing.insertPhotos(event.target.files, insertPosition);
  event.target.value = "";
});
$("#preview-toggle").addEventListener("click", () => {
  if (!writing || busy) return;
  preview = !preview;
  const reading = $("#composer-preview");
  if (preview) {
    const title = element("h1", form.elements.title.value || "An untitled memory");
    const dates = [form.elements.date.value, form.elements.end_date.value].filter(Boolean).join(" – ");
    const meta = element("p", [form.elements.destination.value, dates].filter(Boolean).join(" · "), "preview-meta");
    const body = element("div");
    // Generated by the restricted editor schema; no stored or raw pasted HTML.
    body.innerHTML = writing.editor.getHTML();
    layoutStoryPhotos(body);
    reading.replaceChildren(title, meta, body);
  }
  form.querySelector("fieldset").hidden = preview;
  reading.hidden = !preview;
  $("#preview-toggle").textContent = preview ? "Continue writing" : "Preview story";
  $("#preview-toggle").setAttribute("aria-pressed", String(preview));
  if (!preview) writing.editor.commands.focus();
});
window.addEventListener("beforeunload", event => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

for (const control of addButtons) control.addEventListener("click", () => openComposer());
for (const control of document.querySelectorAll("[data-view]")) {
  control.addEventListener("click", () => changeView(control.dataset.view));
}
detail.addEventListener("click", event => { if (event.target === detail) detail.close(); });
for (const control of detail.querySelectorAll("[data-close]")) control.addEventListener("click", () => detail.close());
for (const control of composer.querySelectorAll("[data-close]")) control.addEventListener("click", closeComposer);
composer.addEventListener("cancel", event => { event.preventDefault(); closeComposer(); });

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !writing) return;
  const trip = editingTrip;
  const data = new FormData(form);
  requestId ??= crypto.randomUUID();
  data.set("id", requestId);
  try {
    const { document, uploads, photoKeys } = writing.submission({ start: form.elements.date.value, end: form.elements.end_date.value });
    data.set("document", JSON.stringify(document));
    uploads.forEach(file => data.append("photos", file));
    if (trip) {
      data.set("revision", baseRevision ?? "");
      data.set("photoKeys", JSON.stringify(photoKeys));
    }
  } catch (failure) {
    formError(failure.message || "The story could not be read.");
    return;
  }
  busy = true;
  writing.editor.setEditable(false, false);
  $("#preview-toggle").disabled = true;
  form.querySelector("fieldset").disabled = true;
  save.disabled = true;
  save.textContent = trip ? "Saving changes…" : "Saving trip…";
  formError();
  try {
    await persistDraft();
    const path = trip ? `/api/trips/${encodeURIComponent(trip.id)}` : "/api/trips";
    const response = await fetch(path, { method: trip ? "PATCH" : "POST", body: data });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.id) throw new Error(result?.message || "The trip could not be saved. Try again.");
    let draftCleanupFailed = false;
    if (draftKey && persistedStamp) {
      try { await clearDraft(draftKey, persistedStamp); }
      catch { draftCleanupFailed = true; }
    }
    dirty = false;
    composer.close();
    clearFiles();
    editingTrip = null;
    if (trip) {
      setTrips(trips.map(item => item.id === result.id ? result : item));
      render();
      showDetail(result, draftCleanupFailed ? "Trip updated. The browser could not clear its draft." : "Trip updated.");
      detail.querySelector("[data-close]").focus();
      return;
    }
    await load();
    if (state !== "ready") {
      setTrips([result, ...trips.filter(item => item.id !== result.id)]);
      state = "ready";
    }
    changeView("stories");
    $("#notice").textContent = draftCleanupFailed ? "Trip saved. The browser could not clear its draft." : "Trip saved.";
    $("#notice").hidden = false;
  } catch (failure) {
    formError(failure instanceof Error ? failure.message : "The trip could not be saved.");
  } finally {
    busy = false;
    writing?.editor.setEditable(true, false);
    $("#preview-toggle").disabled = false;
    form.querySelector("fieldset").disabled = false;
    save.disabled = false;
    save.textContent = editingTrip ? "Save changes" : "Save trip";
  }
});

void load();
