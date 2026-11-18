import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { readFile } from "node:fs/promises";

const window = new Window({ url: "http://localhost" });
for (const name of ["window", "document", "navigator", "Node", "HTMLElement", "Element", "MutationObserver", "DOMParser", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: name === "window" ? window : typeof window[name] === "function" && ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(name) ? window[name].bind(window) : window[name],
  });
}
const { createWritingEditor } = await import("../src/writing-editor.js");

function setup(t, trip) {
  const element = document.createElement("div");
  document.body.append(element);
  const errors = [];
  const session = createWritingEditor({ element, trip, onError: error => errors.push(error) });
  t.after(() => { session.editor.destroy(); element.remove(); });
  return { ...session, element, errors };
}
const photo = () => new File([new Uint8Array([137, 80, 78, 71])], "beach.png", { type: "image/png" });

test("a photo splits text at the cursor and leaves a paragraph to continue writing", t => {
  const { editor, insertPhotos } = setup(t);
  editor.commands.setContent("<p>BeforeAfter</p>");
  editor.commands.setTextSelection(7);
  assert.equal(insertPhotos([photo()]), true);
  const nodes = editor.getJSON().content;
  assert.equal(nodes[0].content[0].text, "Before");
  assert.equal(nodes[1].type, "image");
  assert.equal(nodes[2].type, "paragraph");
  editor.commands.insertContent("Continuing the story.");
  assert.match(editor.getText(), /Before/);
  assert.match(editor.getText(), /Continuing the story/);
  assert.match(editor.getText(), /After/);
});

test("photo deletion and undo restore the same usable preview URL", t => {
  const { editor, insertPhotos, photoCount } = setup(t);
  insertPhotos([photo()]);
  const image = editor.getJSON().content.find(node => node.type === "image");
  let position;
  editor.state.doc.descendants((node, pos) => { if (node.type.name === "image") position = pos; });
  editor.commands.setNodeSelection(position);
  editor.commands.deleteSelection();
  assert.equal(photoCount(), 0);
  assert.equal(editor.commands.undo(), true);
  assert.equal(photoCount(), 1);
  assert.equal(editor.getJSON().content.find(node => node.type === "image").attrs.src, image.attrs.src);
  assert.equal(editor.commands.redo(), true);
  assert.equal(photoCount(), 0);
});

test("captions appear in reading output and are escaped as text", t => {
  const { editor, insertPhotos, element } = setup(t);
  insertPhotos([photo()]);
  const caption = element.querySelector("input.photo-caption");
  assert.ok(caption);
  caption.value = "Sunset <script> on the beach";
  caption.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(editor.getJSON().content.find(node => node.type === "image").attrs.caption, caption.value);
  assert.match(editor.getHTML(), /<figcaption>Sunset &lt;script&gt; on the beach<\/figcaption>/);
  const preview = document.createElement("div");
  preview.innerHTML = editor.getHTML();
  assert.equal(preview.querySelector("script"), null);
});

test("formatting works and photos from pasted HTML are excluded", t => {
  const { editor, photoCount } = setup(t);
  editor.commands.setContent('<p>Hello <strong>world</strong><img src="https://example.com/photo.jpg"></p>');
  assert.equal(photoCount(), 0);
  assert.match(editor.getHTML(), /<strong>world<\/strong>/);
  editor.commands.selectAll();
  editor.commands.toggleHeading({ level: 2 });
  assert.match(editor.getHTML(), /<h2>/);
});

test("invalid files and excess photos are rejected without changing the document", t => {
  const { insertPhotos, photoCount, errors } = setup(t);
  assert.equal(insertPhotos([new File(["hello"], "text.txt", { type: "text/plain" })]), false);
  assert.equal(photoCount(), 0);
  assert.match(errors.at(-1), /JPG/);
  assert.equal(insertPhotos(Array.from({ length: 12 }, photo)), true);
  assert.equal(insertPhotos([photo()]), false);
  assert.equal(photoCount(), 12);
});

test("file paste inserts once and consumes accompanying HTML", t => {
  const { editor, photoCount } = setup(t);
  const event = {
    clipboardData: { files: [photo()], getData: () => '<img src="https://example.com/photo.jpg">' },
    preventDefault() {}, stopPropagation() {},
  };
  const handled = editor.view.someProp("handlePaste", handler => handler(editor.view, event));
  assert.equal(handled, true);
  assert.equal(photoCount(), 1);
});

test("submission includes only current photos and persists captions without temporary URLs", t => {
  const { editor, insertPhotos, submission } = setup(t);
  editor.commands.setContent("<p>A story</p>");
  editor.commands.setTextSelection("end");
  insertPhotos([photo(), photo()]);
  let first;
  editor.state.doc.descendants((node, pos) => { if (first === undefined && node.type.name === "image") first = pos; });
  editor.commands.setNodeSelection(first);
  editor.commands.deleteSelection();
  const saved = submission();
  assert.equal(saved.uploads.length, 1);
  const stored = saved.document.content.find(node => node.type === "image");
  assert.deepEqual(stored.attrs, { index: 0, caption: "" });
  assert.ok(!JSON.stringify(saved.document).includes("blob:"));
  assert.ok(!JSON.stringify(saved.document).includes("photoId"));
});

test("older stories load with their line breaks and saved photos, which can be removed and restored", t => {
  const key = crypto.randomUUID();
  const { element, editor, submission, insertPhotos } = setup(t, {
    story: "First line\nSecond line",
    photos: [{ key, alt: "Original caption" }],
  });
  assert.equal(element.querySelector("img").getAttribute("src"), `/api/photos/${key}`);
  assert.equal(element.querySelector(".photo-caption").value, "Original caption");
  assert.equal(submission().document.content[0].content[0].text, "First line\nSecond line");
  element.querySelector(".photo-remove").click();
  assert.deepEqual(submission().photoKeys, []);
  assert.equal(editor.commands.undo(), true);
  assert.deepEqual(submission().photoKeys, [key]);
  assert.equal(submission().uploads.length, 0);
  assert.equal(insertPhotos([photo()], editor.state.doc.content.size), true);
  assert.deepEqual(submission().photoKeys, [key, null]);
  assert.equal(submission().uploads.length, 1);
});

test("the prototype page initializes its toolbar and switches to reading preview", async () => {
  const html = await readFile(new URL("../src/editor-prototype.html", import.meta.url), "utf8");
  document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
  await import("../src/editor-prototype.js");
  assert.ok(document.querySelector('[role="textbox"][aria-label="Your trip story"]'));
  assert.equal(document.querySelector('[data-command="undo"]').disabled, true);
  document.querySelector("#draft-title").value = "A weekend by the sea";
  document.querySelector("#preview-toggle").click();
  assert.equal(document.querySelector("#reading-preview").hidden, false);
  assert.equal(document.querySelector("#reading-preview h1").textContent, "A weekend by the sea");
  assert.equal(document.querySelector("#editor-toolbar").hidden, true);
  document.querySelector("#preview-toggle").click();
  assert.equal(document.querySelector("#editor-toolbar").hidden, false);
  assert.equal(document.querySelector("#reading-preview").hidden, true);
  window.dispatchEvent(new window.Event("pagehide"));
});

test("the main trip form keeps failed drafts and can reopen and edit a saved trip", async t => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
  const originalFetch = globalThis.fetch;
  const originalFormData = globalThis.FormData;
  globalThis.FormData = window.FormData;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  let failed = false;
  let saved;
  const submittedIds = [];
  const editIds = [];
  globalThis.fetch = async (url, options) => {
    if (options?.method === "POST") {
      submittedIds.push(options.body.get("id"));
      if (!failed) { failed = true; return Response.json({ message: "Temporary save failure" }, { status: 503 }); }
      saved = {
        id: options.body.get("id"), title: options.body.get("title"), destination: options.body.get("destination"),
        date: options.body.get("date"), story: "A memory", photos: [], blocks: [], revision: null,
        document: JSON.parse(options.body.get("document")),
      };
      return Response.json(saved, { status: 201 });
    }
    if (options?.method === "PATCH") {
      editIds.push(options.body.get("id"));
      if (editIds.length === 1) return Response.json({ message: "Temporary update failure" }, { status: 503 });
      assert.equal(url, `/api/trips/${saved.id}`);
      assert.equal(options.body.get("revision"), "");
      assert.equal(options.body.get("photoKeys"), "[]");
      saved = {
        ...saved, title: options.body.get("title"), revision: options.body.get("id"),
        document: JSON.parse(options.body.get("document")),
      };
      return Response.json(saved);
    }
    return Response.json(saved ? [saved] : []);
  };
  t.after(() => { globalThis.fetch = originalFetch; globalThis.FormData = originalFormData; });
  await import("../src/journal.js");
  await new Promise(resolve => setTimeout(resolve, 0));
  document.querySelector("[data-add]").click();
  const form = document.querySelector("#trip-form");
  form.elements.namedItem("title").value = "My memory";
  form.elements.namedItem("destination").value = "Goa";
  const editor = document.querySelector("#writing-editor .tiptap").editor;
  editor.commands.setContent("<p>A <strong>memory</strong></p>");
  document.querySelector("#preview-toggle").click();
  assert.equal(document.querySelector("#composer-preview strong").textContent, "memory");
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(document.querySelector("#form-error").textContent, /Temporary save failure/);
  assert.equal(editor.isEditable, true);
  assert.equal(editor.getText(), "A memory");
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(submittedIds.length, 2);
  assert.equal(submittedIds[0], submittedIds[1]);
  assert.equal(document.querySelector("#composer").open, false);
  assert.equal(document.querySelector("#notice").textContent, "Trip saved.");
  document.querySelector(".cards .card").click();
  assert.equal(document.querySelector("#detail-content .rich-story strong").textContent, "memory");

  document.querySelector(".detail-meta button").click();
  assert.equal(document.querySelector("#form-title").textContent, "Edit trip");
  assert.equal(document.querySelector("#save").textContent, "Save changes");
  assert.equal(form.elements.namedItem("title").value, "My memory");
  assert.equal(form.elements.namedItem("destination").value, "Goa");
  assert.equal(form.elements.namedItem("date").value, saved.date);
  const reopened = document.querySelector("#writing-editor .tiptap").editor;
  assert.match(reopened.getHTML(), /<strong>memory<\/strong>/);
  form.elements.namedItem("title").value = "Updated memory";
  reopened.commands.setContent("<p>An <em>updated</em> memory</p>");
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(document.querySelector("#form-error").textContent, /Temporary update failure/);
  assert.equal(reopened.getText(), "An updated memory");
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(editIds.length, 2);
  assert.equal(editIds[0], editIds[1]);
  assert.equal(document.querySelector("#composer").open, false);
  assert.equal(document.querySelector("#detail-content h2").textContent, "Updated memory");
  assert.equal(document.querySelector("#detail-content .rich-story em").textContent, "updated");
  assert.equal(document.querySelectorAll(".cards .card").length, 1);
});
