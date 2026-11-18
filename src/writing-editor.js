import { Editor, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import FileHandler from "@tiptap/extension-file-handler";
import Placeholder from "@tiptap/extension-placeholder";
import { closeHistory } from "@tiptap/pm/history";
import { normalizeDocument } from "../shared/story-document.mjs";

// Dated sections belong at the document root and contain ordinary story blocks.
const StoryDoc = Node.create({ name: "doc", topNode: true, content: "(block | daySection)+" });
const DaySection = Node.create({
  name: "daySection",
  content: "block+",
  defining: true,
  addAttributes() { return { date: { default: "" } }; },
  renderHTML({ node }) {
    return ["section", { class: "story-day" }, ["h3", {}, node.attrs.date], ["div", {}, 0]];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("section");
      dom.className = "story-day";
      const label = document.createElement("label");
      label.contentEditable = "false";
      label.textContent = "Section date";
      const input = document.createElement("input");
      input.type = "date";
      input.value = node.attrs.date;
      label.append(input);
      const contentDOM = document.createElement("div");
      dom.append(label, contentDOM);
      input.addEventListener("input", () => {
        const pos = getPos();
        if (editor.isEditable && typeof pos === "number") {
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { date: input.value }));
        }
      });
      return {
        dom, contentDOM,
        stopEvent: event => label.contains(event.target),
        ignoreMutation: mutation => label.contains(mutation.target),
        update(next) {
          if (next.type !== node.type) return false;
          if (input.value !== next.attrs.date) input.value = next.attrs.date;
          return true;
        },
      };
    };
  },
});

const Photo = Image.extend({
  addAttributes() {
    return { ...this.parent?.(), photoId: { default: null }, caption: { default: "" } };
  },
  // Photos come from the trip or local files, never pasted HTML URLs.
  parseHTML() { return []; },
  renderHTML({ node }) {
    const attrs = node.attrs;
    return ["figure", { "data-journal-photo": "" },
      ["img", { src: attrs.src, alt: attrs.caption || attrs.alt || "Trip photo" }],
      ...(attrs.caption ? [["figcaption", {}, attrs.caption]] : []),
    ];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const figure = document.createElement("figure");
      figure.dataset.journalPhoto = "";
      const image = document.createElement("img");
      image.draggable = false;
      const caption = document.createElement("input");
      caption.className = "photo-caption";
      caption.placeholder = "Add a caption…";
      caption.maxLength = 160;
      caption.setAttribute("aria-label", "Photo caption");
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "photo-remove";
      remove.textContent = "Remove photo";
      remove.addEventListener("click", () => {
        const pos = getPos();
        if (editor.isEditable && typeof pos === "number") {
          editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
        }
      });
      caption.addEventListener("input", () => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        const current = editor.state.doc.nodeAt(pos);
        if (current?.type.name !== "image") return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, caption: caption.value }));
      });
      const update = next => {
        if (next.type !== node.type) return false;
        node = next;
        image.src = next.attrs.src;
        image.alt = next.attrs.caption || next.attrs.alt || "Trip photo";
        if (caption.value !== next.attrs.caption) caption.value = next.attrs.caption;
        return true;
      };
      update(node);
      const controls = document.createElement("div");
      controls.className = "photo-controls";
      controls.append(caption, remove);
      figure.append(image, controls);
      return {
        dom: figure,
        update,
        stopEvent: event => controls.contains(event.target),
        ignoreMutation: () => true,
        selectNode: () => figure.classList.add("ProseMirror-selectednode"),
        deselectNode: () => figure.classList.remove("ProseMirror-selectednode"),
      };
    };
  },
});

function hydrateStory(node, photo) {
  if (node.type === "image") return photo(node.attrs.index, node.attrs.caption);
  return { ...node, ...(node.content ? { content: node.content.map(child => hydrateStory(child, photo)) } : {}) };
}

function savedContent(trip) {
  function photo(index, caption) {
    const { key, alt } = trip.photos[index];
    return { type: "image", attrs: { src: "/api/photos/" + encodeURIComponent(key), photoId: key, caption: caption ?? alt ?? "" } };
  }
  if (trip.document) return hydrateStory(trip.document, photo);

  const blocks = trip.blocks ?? [
    { type: "text", text: trip.story },
    ...trip.photos.map((_, index) => ({ type: "photo", index })),
  ];
  const content = blocks.filter(block => block.type === "photo" || block.text).map(block =>
    block.type === "photo" ? photo(block.index) : { type: "paragraph", content: [{ type: "text", text: block.text }] });
  return { type: "doc", content };
}

export function createWritingEditor({ element, trip, draft, onChange = () => {}, onError = () => {} }) {
  const savedKeys = new Set(draft ? draft.photoKeys.filter(Boolean) : trip?.photos.map(photo => photo.key));
  const files = new Map();
  function registerPhoto(file, caption = "") {
    const photoId = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    files.set(photoId, { file, url });
    return { type: "image", attrs: { src: url, alt: file.name, photoId, caption } };
  }
  let uploadIndex = 0;
  const restorePhoto = (index, caption) => {
    const key = draft.photoKeys[index];
    if (key) return { type: "image", attrs: { src: "/api/photos/" + encodeURIComponent(key), photoId: key, caption } };
    const { blob, name } = draft.uploads[uploadIndex++];
    return registerPhoto(new File([blob], name, { type: blob.type }), caption);
  };
  let disposed = false;
  const activePhotos = () => {
    const photos = [];
    editor.state.doc.descendants(node => { if (node.type.name === "image") photos.push(node); });
    return photos;
  };
  function insertPhotos(selected, position = editor.state.selection.from) {
    const incoming = Array.from(selected);
    if (!incoming.length || disposed || !editor.isEditable) return false;
    const photos = activePhotos();
    const bytes = photos.reduce((sum, node) => sum + (files.get(node.attrs.photoId)?.file.size || 0), 0);
    const MB = 1024 * 1024;
    if (photos.length + incoming.length > 12 || incoming.some(file =>
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) || !file.size || file.size > 8 * MB) ||
      bytes + incoming.reduce((sum, file) => sum + file.size, 0) > 28 * MB) {
      onError("Choose up to 12 JPG, PNG, or WebP photos, up to 8 MB each and 28 MB total.");
      return false;
    }
    const content = incoming.map(file => registerPhoto(file));
    content.push({ type: "paragraph" });
    editor.view.dispatch(closeHistory(editor.state.tr));
    const inserted = editor.chain().focus().insertContentAt(position, content).run();
    editor.view.dispatch(closeHistory(editor.state.tr));
    onError("");
    return inserted;
  }
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({
        document: false, heading: { levels: [2] }, link: false, code: false, codeBlock: false,
        blockquote: false, horizontalRule: false, orderedList: false, strike: false, underline: false,
      }),
      StoryDoc, DaySection, Photo,
      Placeholder.configure({ placeholder: "Start your story… Add a photo whenever words aren’t enough." }),
      FileHandler.configure({
        consumePasteEvent: true,
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
        onDrop: (_editor, selected, position) => insertPhotos(selected, position),
        onPaste: (_editor, selected) => insertPhotos(selected),
      }),
    ],
    editorProps: {
      attributes: { class: "writing-editor", role: "textbox", "aria-label": "Your trip story", "aria-multiline": "true", spellcheck: "true" },
    },
    content: draft ? hydrateStory(draft.document, restorePhoto) : trip ? savedContent(trip) : "<p></p>",
    onTransaction: ({ editor }) => onChange(editor),
    onDestroy: () => {
      disposed = true;
      // Keep URLs through deletion and undo; release them only when the session ends.
      for (const { url } of files.values()) URL.revokeObjectURL(url);
      files.clear();
    },
  });
  function snapshot() {
    const uploads = [];
    const photoKeys = [];
    function serialize(node) {
      if (node.type === "image") {
        const { photoId, caption } = node.attrs;
        const index = photoKeys.length;
        if (savedKeys.has(photoId)) photoKeys.push(photoId);
        else {
          const upload = files.get(photoId);
          if (!upload) throw new Error("A photo is missing. Remove it and add it again.");
          photoKeys.push(null);
          uploads.push(upload.file);
        }
        return { type: "image", attrs: { index, caption } };
      }
      return { ...node, ...(node.content ? { content: node.content.map(serialize) } : {}) };
    }
    const document = serialize(editor.getJSON());
    document.version = document.content.some(node => node.type === "daySection") ? 2 : 1;
    return { document, uploads, photoKeys };
  }
  function submission(range) {
    const draft = snapshot();
    return { ...draft, document: normalizeDocument(draft.document, draft.photoKeys.length, range) };
  }
  return { editor, insertPhotos, snapshot, submission, photoCount: () => activePhotos().length };
}
