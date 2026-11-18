export function photosInStoryOrder(trip) {
  if (trip.document) {
    const photos = [];
    function visit(node) {
      if (node.type === "image") {
        const photo = trip.photos[node.attrs.index];
        if (photo) photos.push({ ...photo, alt: node.attrs.caption ?? photo.alt });
      }
      node.content?.forEach(visit);
    }
    visit(trip.document);
    return photos;
  }
  return trip.blocks
    ? trip.blocks.filter(block => block.type === "photo").map(block => trip.photos[block.index]).filter(Boolean)
    : trip.photos;
}

export function createPhotoViewer(dialog, showStory) {
  const title = dialog.querySelector("h2");
  const image = dialog.querySelector("img");
  const caption = dialog.querySelector("figcaption");
  const position = dialog.querySelector("#photo-position");
  const close = dialog.querySelector("[data-photo-close]");
  const previous = dialog.querySelector('[data-photo-step="-1"]');
  const next = dialog.querySelector('[data-photo-step="1"]');
  const read = dialog.querySelector("[data-photo-story]");
  let trip;
  let photos;
  let index;
  let touch;
  let opener;

  function render() {
    const photo = photos[index];
    title.textContent = trip.title;
    image.src = "/api/photos/" + encodeURIComponent(photo.key);
    image.alt = photo.alt || "Photo from " + trip.title;
    caption.hidden = !photo.alt;
    caption.textContent = photo.alt || "";
    position.textContent = `${index + 1} of ${photos.length}`;
    previous.disabled = index === 0;
    next.disabled = index === photos.length - 1;
  }

  function step(offset) {
    const target = index + offset;
    if (target < 0 || target >= photos.length) return;
    index = target;
    render();
    // A navigation button can become disabled while it holds focus.
    if (document.activeElement === previous && previous.disabled) next.focus();
    if (document.activeElement === next && next.disabled) previous.focus();
  }

  close.addEventListener("click", () => dialog.close());
  previous.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));
  read.addEventListener("click", () => {
    dialog.close();
    showStory(trip);
  });
  dialog.addEventListener("close", () => {
    image.removeAttribute("src");
    touch = undefined;
    if (!document.querySelector("#detail")?.open || document.querySelector("#detail").contains(opener)) opener?.focus();
  });
  dialog.addEventListener("keydown", event => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    step(event.key === "ArrowLeft" ? -1 : 1);
  });
  const stage = dialog.querySelector(".photo-stage");
  stage.addEventListener("touchstart", event => {
    touch = event.touches.length === 1 ? event.touches[0] : undefined;
  }, { passive: true });
  stage.addEventListener("touchcancel", () => { touch = undefined; });
  stage.addEventListener("touchend", event => {
    if (!touch || !event.changedTouches.length) return;
    const end = event.changedTouches[0];
    const dx = end.clientX - touch.clientX;
    const dy = end.clientY - touch.clientY;
    touch = undefined;
    if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.4) step(dx < 0 ? 1 : -1);
  }, { passive: true });

  return (selectedTrip, key, trigger = document.activeElement) => {
    trip = selectedTrip;
    photos = photosInStoryOrder(trip);
    index = photos.findIndex(photo => photo.key === key);
    if (index < 0) {
      photos = trip.photos;
      index = photos.findIndex(photo => photo.key === key);
    }
    if (index < 0) return;
    opener = trigger;
    read.hidden = Boolean(opener?.closest("#detail"));
    render();
    dialog.showModal();
    close.focus();
  };
}
