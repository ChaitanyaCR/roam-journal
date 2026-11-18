# Roam Journal specifications

Roam Journal is a private travel diary. A trip owns its story and photos. Stories, Gallery and Timeline browse those same trips. Phase 3 adds World Map. Changes made through the editor should appear in every applicable view.

| Phase | Deliverable | Status |
| --- | --- | --- |
| [1 · Draft recovery and photo viewing](phase-1-drafts-and-photos.md) | Resume unfinished writing and browse a trip’s photos full screen | Implemented. Hands-on browser and mobile review remains open. |
| [2 · Find and organize trips](phase-2-discovery-and-trash.md) | Search, tags, shared filters, Timeline and recoverable deletion | Implemented, including Trash and restore. |
| [3 · Multi-day trips and World Map](phase-3-multi-day-and-map.md) | Date ranges, dated story sections and city pins | In progress. Date ranges and dated story sections are implemented. World Map is next. |
| [4 · Portable export](phase-4-export.md) | A downloadable ZIP with offline stories, original photos and structured data | Planned. Includes the Phase 2 and 3 data. |

## Resume development

1. Start with [World Map in Phase 3](phase-3-multi-day-and-map.md#world-map) and read its acceptance checks. Each phase describes the intended behavior. Items marked **Proposed** are implementation choices that can be revised.
2. Follow the [project setup](../README.md#local-development) with Node.js 22 or later. Run the app locally with Wrangler and run `npm test` for the baseline.
3. Implement a complete slice through the existing editor, Worker and views. When changing storage, add a numbered SQL migration under `drizzle/`, update its migration journal, and run `npm run db:local`.
4. Exercise the phase’s acceptance checks with new trips and older entries. When a slice ships, update its status here and record any remaining checks or changes in the phase file.

## Where changes belong

| Concern | Current source |
| --- | --- |
| Journal navigation, trip list, detail and editor integration | [Page](../src/index.html), [controller](../src/journal.js), [styles](../src/journal.css) |
| Rich text and photo ordering | [Editor](../src/writing-editor.js), [shared document rules](../shared/story-document.mjs), [reader](../src/story-renderer.js) |
| Local drafts and photo viewer | [Draft store](../src/trip-drafts.js), [viewer](../src/photo-viewer.js) |
| Authenticated trip and photo access | [Worker](../worker/index.mjs), [D1 migrations](../drizzle/) |
| Regression coverage | [Worker and storage tests](../tests/story-blocks.test.mjs), [editor and browser interaction tests](../tests/writing-editor.test.mjs) |

## Rules shared by all phases

- The Worker derives the owner from the authenticated visitor. Scope queries, mutations, photo access and exports to that owner.
- D1 stores trip metadata and stories. R2 stores saved photos. IndexedDB holds unfinished browser-local drafts.
- Preserve plain-text, block-based and versioned rich stories. Preserve trip IDs, captions, photo order, and the position of photos relative to text.
- Carry revision checks through edits and new mutations so a stale tab cannot silently overwrite newer work. Keep retried saves safe.
- Preserve the responsive reading layout. Adjacent photos can share a row when space permits, panoramas can span a row, and intervening text stays in place.
