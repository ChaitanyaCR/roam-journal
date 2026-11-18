// Versioned storage format. Photo indices refer only to this trip's uploaded files.
export function normalizeDocument(value, photoCount) {
  if (!value || value.version !== 1 || value.type !== "doc" || !Array.isArray(value.content)) {
    throw new Error("The story document could not be read.");
  }
  let count = 0;
  const references = [];
  function node(value, parent, depth = 0) {
    if (++count > 2000 || depth > 12 || !value || typeof value !== "object") throw new Error("The story is too complex.");
    const allowed = {
      doc: ["paragraph", "heading", "bulletList", "image"],
      paragraph: ["text", "hardBreak"], heading: ["text", "hardBreak"],
      bulletList: ["listItem"], listItem: ["paragraph", "heading", "bulletList", "image"],
    };
    if (!allowed[parent]?.includes(value.type)) throw new Error("The story contains unsupported formatting.");
    if (value.type === "text") {
      if (typeof value.text !== "string" || !value.text.length || value.text.length > 20000) throw new Error("The story text is invalid.");
      const marks = value.marks ?? [];
      if (!Array.isArray(marks) || marks.length > 2 || marks.some(mark => !mark || !["bold", "italic"].includes(mark.type))) throw new Error("The story contains unsupported formatting.");
      return { type: "text", text: value.text, ...(marks.length ? { marks: [...new Set(marks.map(mark => mark.type))].map(type => ({ type })) } : {}) };
    }
    if (value.type === "hardBreak") return { type: "hardBreak" };
    if (value.type === "image") {
      const { index, caption = "" } = value.attrs ?? {};
      if (!Number.isInteger(index) || index < 0 || index >= photoCount || typeof caption !== "string" || caption.length > 160) throw new Error("The story contains an invalid photo.");
      references.push(index);
      return { type: "image", attrs: { index, caption } };
    }
    if (value.type === "heading" && value.attrs?.level !== 2) throw new Error("The heading is invalid.");
    const content = value.content ?? [];
    if (!Array.isArray(content) || (["bulletList", "listItem"].includes(value.type) && !content.length) ||
        (value.type === "listItem" && content[0]?.type !== "paragraph")) throw new Error("The story structure is invalid.");
    return { type: value.type, ...(value.type === "heading" ? { attrs: { level: 2 } } : {}),
      content: content.map(child => node(child, value.type, depth + 1)) };
  }
  const document = { version: 1, type: "doc", content: value.content.map(child => node(child, "doc")) };
  if (references.length !== photoCount || new Set(references).size !== references.length) throw new Error("Each photo must appear once in the story.");
  const text = documentText(document);
  if (!text.trim() || text.length > 20000) throw new Error("Write a story of up to 20,000 characters.");
  return document;
}

export function documentText(node) {
  if (node.type === "text") return node.text;
  if (node.type === "hardBreak") return "\n";
  if (node.type === "image") return "";
  return (node.content ?? []).map(documentText).join(["paragraph", "heading"].includes(node.type) ? "" : "\n\n");
}
