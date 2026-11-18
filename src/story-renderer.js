// Render structured content with DOM methods, without injecting stored HTML.
export function renderStory(document, photos) {
  const container = window.document.createElement("div");
  container.className = "rich-story";
  function render(node) {
    if (node.type === "text") {
      let text = window.document.createTextNode(node.text);
      for (const mark of node.marks ?? []) {
        const tag = mark.type === "bold" ? "strong" : mark.type === "italic" ? "em" : "span";
        const wrapper = window.document.createElement(tag);
        wrapper.append(text);
        text = wrapper;
      }
      return text;
    }
    if (node.type === "image") {
      const figure = window.document.createElement("figure");
      const photo = photos[node.attrs.index];
      if (!photo) return figure;
      const image = window.document.createElement("img");
      image.src = "/api/photos/" + encodeURIComponent(photo.key);
      image.alt = node.attrs.caption || photo.alt || "Trip photo";
      image.loading = "lazy";
      figure.append(image);
      if (node.attrs.caption) {
        const caption = window.document.createElement("figcaption");
        caption.textContent = node.attrs.caption;
        figure.append(caption);
      }
      return figure;
    }
    const tags = { paragraph: "p", heading: "h3", bulletList: "ul", listItem: "li", hardBreak: "br" };
    const element = window.document.createElement(tags[node.type] || "div");
    for (const child of node.content ?? []) element.append(render(child));
    return element;
  }
  for (const node of document.content) container.append(render(node));
  return container;
}
