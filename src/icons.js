const SVG = "http://www.w3.org/2000/svg";

// Returns a decorative <svg> that references a symbol in /icons.svg.
export function icon(name, className = "icon") {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", "/icons.svg#" + name);
  svg.append(use);
  return svg;
}

// Replaces a control's contents with an icon followed by its text label.
export function setLabel(node, name, text) {
  node.replaceChildren(icon(name), text);
}
