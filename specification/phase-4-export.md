# Phase 4 · Portable journal export

**Status** Planned. Builds on the final trip, tag, date and location representations from Phases 2 and 3.

## User outcome

A signed-in person can download a ZIP and read their saved journal offline. The archive contains human-readable HTML stories, captions, original photo files and machine-readable JSON. Opening the extracted stories must work without a running Worker, an internet connection or a signed-in browser.

**Proposed scope** Export all active saved trips for the current account, independent of the current view or filters. Exclude Trash and browser-local drafts. Label the export action with that scope. This phase covers export only. Restoring an archive into the app would need its own specification.

## Archive and implementation

- Provide a top-level HTML index linking to the stories. Use stable trip IDs in file paths so trips with identical titles stay distinct.
- Render HTML from validated story content. Preserve formatting, dated sections, text/photo order and captions. Escape user text and use relative paths to packaged media.
- Fetch original images through owner-scoped storage access. Preserve their file types and avoid loading an entire photo library into memory at once.
- Include versioned JSON with trip IDs, titles, destinations, date ranges, tags, optional pin data, story structure and references to archived photos. Normalize older stories without losing their text or photos.
- Report progress or a busy state and make failures actionable. If an original cannot be read, identify the affected trip and allow a retry. Avoid reporting an incomplete archive as successful.

## Acceptance checks

- Export a journal containing legacy and rich entries, two trips with identical titles, a multi-day trip, captions with special characters and a trip without photos.
- Disconnect from the network, extract the ZIP and open the index. Follow every link and verify all photos, captions and day headings appear in story order. Compare an archived original with its stored bytes.
- Parse the JSON and resolve every referenced file inside the archive. Verify another user’s data, trashed trips and pending draft photos are absent under the proposed scope.
- Exercise an empty journal, a large photo collection and an interrupted download. Retrying should leave the saved journal untouched.
