export function layoutStoryPhotos(container) {
  for (const section of [container, ...container.querySelectorAll("li, .story-day > div")]) {
    let row;
    let blankLines = [];
    for (const block of [...section.children]) {
      const image = block.matches("figure") && block.querySelector("img");
      if (!image) {
        // The editor can leave an empty paragraph between photo insertions.
        if (row && block.matches("p") && !block.textContent.trim()) {
          blankLines.push(block);
        } else {
          row = undefined;
          blankLines = [];
        }
        continue;
      }

      if (!row) {
        row = container.ownerDocument.createElement("div");
        row.className = "photo-row";
        block.before(row);
      }
      for (const line of blankLines) line.remove();
      blankLines = [];

      block.classList.add("story-photo");
      row.append(block);
      const markPanorama = () => {
        block.toggleAttribute("data-panorama", image.naturalHeight > 0 && image.naturalWidth >= 2 * image.naturalHeight);
      };
      if (image.complete) markPanorama();
      else image.addEventListener("load", markPanorama, { once: true });
    }
  }
}

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
    if (node.type === "daySection") {
      const section = window.document.createElement("section");
      section.className = "story-day";
      const heading = window.document.createElement("h3");
      heading.textContent = node.attrs.date;
      const body = window.document.createElement("div");
      for (const child of node.content) body.append(render(child));
      section.append(heading, body);
      return section;
    }
    if (node.type === "image") {
      const figure = window.document.createElement("figure");
      const photo = photos[node.attrs.index];
      if (!photo) return figure;
      figure.dataset.photoKey = photo.key;
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
  layoutStoryPhotos(container);
  return container;
}
