import { createWritingEditor } from "./writing-editor.js";
import { layoutStoryPhotos } from "./story-renderer.js";
import { setLabel } from "./icons.js";

const $ = selector => document.querySelector(selector);
const picker = $("#draft-photos");
let preview = false;
let dirty = false;
let insertPosition;

function message(text) {
  $("#editor-message").textContent = text;
  $("#editor-message").hidden = !text;
}

function updateToolbar(editor) {
  let photoCount = 0;
  editor.state.doc.descendants(node => { if (node.type.name === "image") photoCount++; });
  $("#draft-count").textContent = `${editor.getText().length.toLocaleString()} characters · ${photoCount} photo${photoCount === 1 ? "" : "s"}`;
  for (const control of document.querySelectorAll("[data-command]")) {
    const command = control.dataset.command;
    if (command === "undo" || command === "redo") control.disabled = !editor.can()[command]();
    else control.setAttribute("aria-pressed", String(command === "heading"
      ? editor.isActive("heading", { level: 2 }) : editor.isActive(command)));
  }
}

const { editor, insertPhotos } = createWritingEditor({
  element: $("#writing-editor"), onChange: updateToolbar, onError: message,
});
editor.on("update", () => { dirty = true; });
updateToolbar(editor);

// Mouse/touch toolbar use preserves the editor selection; keyboard activation works too.
$("#editor-toolbar").addEventListener("mousedown", event => {
  if (event.target.closest("button")) event.preventDefault();
});
for (const control of document.querySelectorAll("[data-command]")) {
  control.addEventListener("click", () => {
    const command = control.dataset.command;
    const chain = editor.chain().focus();
    if (command === "heading") chain.toggleHeading({ level: 2 }).run();
    else if (command === "bulletList") chain.toggleBulletList().run();
    else if (command === "bold") chain.toggleBold().run();
    else if (command === "italic") chain.toggleItalic().run();
    else chain[command]().run();
  });
}
$("#insert-photo").addEventListener("click", () => {
  insertPosition = editor.state.selection.from;
  picker.click();
});
picker.addEventListener("change", () => {
  insertPhotos(picker.files, insertPosition);
  picker.value = "";
});
for (const input of document.querySelectorAll("#writing-fields input")) {
  input.addEventListener("input", () => { dirty = true; });
}
const date = new Date();
$("#draft-date").value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

$("#preview-toggle").addEventListener("click", () => {
  preview = !preview;
  const reading = $("#reading-preview");
  if (preview) {
    const title = document.createElement("h1");
    title.textContent = $("#draft-title").value || "An untitled memory";
    const meta = document.createElement("p");
    meta.className = "preview-meta";
    meta.textContent = [$("#draft-destination").value, $("#draft-date").value].filter(Boolean).join(" · ");
    const body = document.createElement("div");
    // This HTML is generated from the restricted editor schema, never raw pasted HTML.
    body.innerHTML = editor.getHTML();
    if (editor.isEmpty) body.textContent = "Your story will appear here.";
    else layoutStoryPhotos(body);
    reading.replaceChildren(title, meta, body);
  }
  for (const id of ["#writing-fields", "#editor-toolbar", "#writing-editor", "#writing-hint"]) $(id).hidden = preview;
  reading.hidden = !preview;
  setLabel($("#preview-toggle"), preview ? "pencil" : "eye", preview ? "Continue writing" : "Preview story");
  $("#preview-toggle").setAttribute("aria-pressed", String(preview));
  if (!preview) editor.commands.focus();
});

window.addEventListener("beforeunload", event => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});
window.addEventListener("pagehide", event => { if (!event.persisted) editor.destroy(); });
