# Phase 2 · Search, tags, Timeline and Trash

**Status** Implemented. Stories, Gallery and Timeline share search, year and tag filters. Trips can be moved to Trash and restored.

## Delivery order

1. **Tags and search.** Add editable tags to new and saved trips. Persist them in D1 and include them in browser drafts. Existing trips start with no tags. Search title, destination, story text and photo captions across all supported story formats.
2. **Shared filters.** Add year and tag controls alongside search. Reuse a single filtered trip collection for Stories, Gallery and Timeline, and later World Map. Keep the selection when switching views. Let the user clear filters from an empty result.
3. **Timeline.** Add Timeline as a peer to Stories and Gallery in the main navigation. Group trips by year and month, newest first, with a year picker. Each entry shows its date, title and destination and opens the existing trip detail. Use the current trip date as the start. When Phase 3 supplies an end date, display the range and anchor the trip once under its start month and year.
4. **Trash and restore.** Add a move-to-Trash action and a Trash view with restore. Hide trashed trips from ordinary browsing and search. Retain their stories and R2 photos so restoration returns the complete trip. Permanent deletion and retention periods require a separate product decision.

## Implemented behavior

The editor accepts comma-separated tags and keeps the unfinished field in the local draft. Saving trims whitespace and keeps the first spelling of each case-insensitive tag. Migration 0004 gives older entries an empty tag list. Search is case-insensitive and matches the saved title, destination, story text and photo captions.

Search, year and tag selections apply together and persist when switching views. Year and tag choices come from all active trips and refresh after saves. Clearing filters from an empty result restores all trips or photos in the current view.

Timeline groups trips under their start year and month, newest first. Trips with the same date are ordered by descending trip ID. Each entry opens the existing trip detail. Each date has one milestone. Stories from that date stack vertically as cards with a cover image on the left and title on the right. Date groups alternate along a dotted line on desktop and follow a single column on phones. Multi-day cards show the date range under the shared start-date milestone.

Open a trip and choose **Move to Trash** to remove it from all three browsing views and search. Open the trip in **Trash** and choose **Restore trip** to return it to the journal. Both actions check ownership and revision. Migration 0005 stores the deletion timestamp and keeps existing entries active.

### Storage and verification

`GET /api/trips` returns the owner’s active trips. The journal requests `GET /api/trips?include=trash` to populate the Trash view as well. Moving and restoring a trip use `POST /api/trips/{id}/trash` and `POST /api/trips/{id}/restore`. Each request carries the expected revision and a request ID so a retry after a lost response is safe.

The Worker tests cover stale edits, cross-account access, retries and original photo bytes after restoration. The journal interaction tests cover moving a trip, reopening the journal and restoring it through Trash. A local Wrangler check also exercised the round trip with D1 and R2.

## Acceptance checks

- A caption-only match finds a trip. Combined filters give the same eligible trips across views. Gallery displays photos only from matching trips. Older entries remain searchable.
- Add, rename or remove a tag on a trip and reopen it. The tag filter and a resumed draft reflect the intended values.
- Two trips in one month and one in another year appear in the correct groups. Switching from Timeline to Stories keeps the selected year. An empty selection offers a way back.
- Trash a trip with photos, reload and restore it. Its ID, story order, tags and photos survive. A stale edit cannot undo the deletion and another user cannot list or restore the trip.
