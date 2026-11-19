# Roam Journal

A private travel journal with trip stories and photo galleries. The Cloudflare Worker uses the authenticated visitor ID supplied by Sites. D1 stores trip entries and R2 stores photos. Each visitor can access only their own entries and photos.

New trip opens a full-screen Tiptap editor with continuous writing, bold/italic/headings/lists, photos at the cursor, paste/drop, captions, undo/redo, and a reading preview. Save trip uploads the current photos to R2 and stores a versioned document in D1, preserving formatting and photo order. Existing plain-text and block-based entries remain readable. Stories allow up to 20,000 characters and 12 photos (8 MB each, 28 MB combined).

Run `npm run build` to produce the Worker at `dist/server/index.js`. Schema migrations are in `drizzle/`. The deployment requires the DB and BUCKET bindings declared in `.openai/hosting.json`.

For a multi-day trip, enter a start and end date. Choose **＋ Dated section** to append a day, set its date, and write or add photos inside it. Existing text can stay above the dated sections. The trip appears once on Timeline under its start date.

## Browsing your journal

Stories, Gallery, Timeline and World Map share the same search, year and tag filters. Search matches titles, destinations, story text and photo captions. Add comma-separated tags in the trip editor. Timeline shows trips newest first, with stories from the same date stacked under one milestone.

Choose a suggestion in **Map place (optional)** when writing or editing a trip. In **World Map**, select a pin or choose a location from the list to open its stories. Clear the map city field to remove the pin. Typing searches the local catalog. Choose **Search more places** to search Geoapify for the map place (or the written destination if the map field is empty), then select a result to save its coordinates and attribution with the trip. Saved online pins can be reopened without another lookup. Indian place search includes GeoNames towns, alternate spellings, and Palolem Beach. [Catalog sources and attribution](scripts/data/README.md)

Choose **Export all active trips (.zip)** to download your saved stories, original photos and a versioned JSON manifest. The export includes trips hidden by the current filters and excludes Trash and browser drafts. Extract the ZIP and open its top-level `index.html` to read offline.

Open a saved trip and choose **Move to Trash** to hide it from Stories, Gallery, Timeline, World Map and search. To recover it with its photos, open the trip in **Trash** and choose **Restore trip**.

See the [phase specifications](specification/README.md) for the roadmap, implementation status, and acceptance checks for each phase.

## Local development

Use Node.js 22 or later. Install dependencies and initialize the local database:

```sh
npm install
npm run db:local
npm run dev
```

To enable **Search more places**, put `GEOAPIFY_API_KEY=your-key` in the project-root `.dev.vars` file and restart Wrangler. For hosted use, configure the same name as a Worker secret. The local picker works without a key.

Open http://127.0.0.1:8787. The local entry point uses the test identity `local-user` instead of Sites sign-in. The server binds to loopback, and local D1/R2 data is stored in the ignored `.wrangler/` directory, separately from hosted data.

After editing `src/` or `worker/`, run `npm run build` in a second terminal, then refresh the browser. Wrangler reloads the rebuilt Worker. Run `npm run db:local` after adding SQL migrations.

`wrangler.local.jsonc` and `scripts/local-worker.mjs` are for local development only. Publish through Sites using the normal build output; do not deploy the local entry point.

Run `npm test` to build and check rich documents, editor interactions, draft recovery, photo navigation, save retries, older entries, input validation, user isolation, failed-upload cleanup, shared filters, Timeline grouping, and Trash and restore. The app autosaves new trips and unfinished edits, including pending photos, in the current browser. Open **New trip** or **Edit trip** again to resume. Saving the trip clears the draft. Open a photo in a story or the gallery to browse that trip’s photos by swipe, keyboard, or the on-screen arrows.

## Writing editor prototype

The original standalone playground remains at http://127.0.0.1:8787/editor-prototype. Use **New trip** on the main page for the integrated editor that saves trips.

Standalone playground drafts are not saved or uploaded. The build bundles editor dependencies locally using esbuild; no editor CDN or cloud service is used. Editor interaction tests run against a simulated DOM; browser and mobile usability still need hands-on review.
