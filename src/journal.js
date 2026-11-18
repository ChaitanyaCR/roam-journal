import { createWritingEditor } from "./writing-editor.js";
import { layoutStoryPhotos, renderStory } from "./story-renderer.js";

const $ = selector => document.querySelector(selector);
const composer = $("#composer");
const detail = $("#detail");
const form = $("#trip-form");
const save = $("#save");
const addButtons = document.querySelectorAll("[data-add]");
let trips = [];
let view = "stories";
let state = "loading";
let writing = null;
let dirty = false;
let preview = false;
let insertPosition;
let requestId;
let editingTrip = null;
let busy = false;
const dateLabel = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" });

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

function image(photo, trip) {
  const node = element("img");
  node.src = "/api/photos/" + encodeURIComponent(photo.key);
  node.alt = photo.alt || "Photo from " + trip.title;
  node.loading = "lazy";
  return node;
}

function showDetail(trip, photo, notice) {
  const content = $("#detail-content");
  content.replaceChildren();
  if (!photo) content.append(element("p", trip.destination, "location"));
  content.append(element("h2", trip.title));
  if (photo) {
    const figure = element("figure", "", "story-photo");
    figure.append(image(photo, trip), element("figcaption", photo.alt || trip.destination));
    content.append(figure, button("Read story →", "secondary", () => showDetail(trip)));
  } else {
    const date = element("time", dateLabel.format(new Date(trip.date)));
    date.dateTime = trip.date;
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
          figure.append(image(item, trip));
          if (item.alt) figure.append(element("figcaption", item.alt));
          story.append(figure);
        }
      }
      layoutStoryPhotos(story);
    }
    const meta = element("div", "", "detail-meta");
    meta.append(date, button("Edit trip", "secondary", () => openComposer(trip)));
    content.append(meta);
    if (notice) {
      const status = element("p", notice, "notice");
      status.setAttribute("role", "status");
      content.append(status);
    }
    content.append(story);
  }
  detail.setAttribute("aria-label", trip.title);
  if (!detail.open) detail.showModal();
  detail.scrollTop = 0;
}

function tripCard(trip) {
  const card = button("", "card", () => showDetail(trip));
  card.append(trip.photos[0] ? image(trip.photos[0], trip) : element("div", "✧", "no-cover"));
  const copy = element("div", "", "card-copy");
  const date = element("time", dateLabel.format(new Date(trip.date)));
  date.dateTime = trip.date;
  copy.append(element("span", trip.destination, "location"), element("h3", trip.title), date,
    element("p", trip.story), element("span", "Read story →", "read"));
  card.append(copy);
  return card;
}

function render() {
  const entries = $("#entries");
  const count = $("#count");
  const stories = view === "stories";
  const photos = trips.flatMap(trip => trip.photos.map(photo => ({ trip, photo })));
  entries.replaceChildren();
  $("#journal-title").textContent = stories ? "Trip stories" : "Photo gallery";
  count.textContent = "";
  for (const control of document.querySelectorAll("[data-view]")) {
    const active = control.dataset.view === view;
    control.classList.toggle("active", active);
    control.setAttribute("aria-pressed", String(active));
  }
  for (const control of addButtons) control.hidden = state === "signed-out";
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
    const length = stories ? trips.length : photos.length;
    count.textContent = length + (stories ? " trip" : " photo") + (length === 1 ? "" : "s");
    if (length) {
      const grid = element("div", "", stories ? "cards" : "gallery");
      if (stories) grid.append(...trips.map(tripCard));
      else grid.append(...photos.map(({ trip, photo }) => {
        const tile = button("", "gallery-tile", () => showDetail(trip, photo));
        tile.append(image(photo, trip), element("span", trip.destination));
        return tile;
      }));
      entries.append(grid);
      return;
    }
    const icon = element("span", stories ? "✎" : "▧", "empty-icon");
    icon.setAttribute("aria-hidden", "true");
    empty.append(icon, element("h3", stories ? "Your story starts here" : "Your gallery is empty"),
      element("p", stories ? "Pick a trip you’d like to remember and give it a page." : "Photos you add to a trip will appear here."),
      button(stories ? "Add your first trip" : "Add a trip", "secondary", () => openComposer()));
  }
  entries.append(empty);
}

async function load() {
  state = "loading";
  render();
  try {
    const response = await fetch("/api/trips", { cache: "no-store" });
    if (response.status === 401) state = "signed-out";
    else {
      if (!response.ok) throw new Error();
      trips = await response.json();
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

function openComposer(trip = null) {
  if (busy) return;
  form.reset();
  clearFiles();
  editingTrip = trip;
  requestId = crypto.randomUUID();
  formError();
  $("#notice").hidden = true;
  $("#form-title").textContent = trip ? "Edit trip" : "New trip";
  save.textContent = trip ? "Save changes" : "Save trip";
  const today = new Date();
  form.elements.title.value = trip?.title ?? "";
  form.elements.destination.value = trip?.destination ?? "";
  form.elements.date.value = trip?.date ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  composer.showModal();
  writing = createWritingEditor({ element: $("#writing-editor"), trip, onChange: updateToolbar, onError: formError });
  writing.editor.on("update", markDirty);
  updateToolbar(writing.editor);
  form.elements.title.focus();
}

function closeComposer() {
  if (busy) return;
  const message = editingTrip ? "Discard your unsaved changes?" : "Discard this unsaved trip?";
  if (dirty && !window.confirm(message)) return;
  composer.close();
  clearFiles();
  editingTrip = null;
}

function markDirty() {
  dirty = true;
  if (editingTrip) requestId = null;
}

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
    const meta = element("p", [form.elements.destination.value, form.elements.date.value].filter(Boolean).join(" · "), "preview-meta");
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
    const { document, uploads, photoKeys } = writing.submission();
    data.set("document", JSON.stringify(document));
    uploads.forEach(file => data.append("photos", file));
    if (trip) {
      data.set("revision", trip.revision ?? "");
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
    const path = trip ? `/api/trips/${encodeURIComponent(trip.id)}` : "/api/trips";
    const response = await fetch(path, { method: trip ? "PATCH" : "POST", body: data });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.id) throw new Error(result?.message || "The trip could not be saved. Try again.");
    dirty = false;
    composer.close();
    clearFiles();
    editingTrip = null;
    if (trip) {
      trips = trips.map(item => item.id === result.id ? result : item)
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
      render();
      showDetail(result, null, "Trip updated.");
      detail.querySelector("[data-close]").focus();
      return;
    }
    await load();
    if (state !== "ready") {
      trips = [result, ...trips.filter(item => item.id !== result.id)].sort((a, b) => b.date.localeCompare(a.date));
      state = "ready";
    }
    changeView("stories");
    $("#notice").textContent = "Trip saved.";
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
