# Phase 2 · Search, tags, Timeline and Trash

**Status** In progress. Tags, search and shared year and tag filters are implemented in Stories and Gallery. Timeline is next, followed by Trash.

## Delivery order

1. **Tags and search.** Add editable tags to new and saved trips. Persist them in D1 and include them in browser drafts. Existing trips start with no tags. Search title, destination, story text and photo captions across all supported story formats.
2. **Shared filters.** Add year and tag controls alongside search. Reuse a single filtered trip collection for Stories, Gallery and Timeline, and later World Map. Keep the selection when switching views. Let the user clear filters from an empty result.
3. **Timeline.** Add Timeline as a peer to Stories and Gallery in the main navigation. Group trips by year and month, newest first, with a year picker. Each entry shows its date, title and destination and opens the existing trip detail. Use the current trip date as the start. When Phase 3 supplies an end date, display the range and anchor the trip once under its start month and year.
4. **Trash and restore.** Add a move-to-Trash action and a Trash view with restore. Hide trashed trips from ordinary browsing and search. Retain their stories and R2 photos so restoration returns the complete trip. Permanent deletion and retention periods require a separate product decision.

## Proposed implementation

Use a migration for tags and a nullable deletion timestamp. Extend the existing trip serializer, form and revision checks. Make trash and restore owner-scoped, revision-checked operations. Prevent a stale editor or recovered draft from moving an entry out of Trash by saving. Start with filtering the authenticated trip list already loaded by the journal. Use stable trip ID ordering for equal dates. Treat search as case-insensitive and combine search, year and selected tag with AND.

## Implemented behavior

The editor accepts comma-separated tags and keeps the unfinished field in the local draft. Saving trims whitespace and keeps the first spelling of each case-insensitive tag. Migration 0004 gives older entries an empty tag list. Search keeps its query when switching between Stories and Gallery and matches the saved title, destination, story text and photo captions.

Search, year and tag selections apply together and persist when switching views. Year and tag choices come from the full trip list and refresh after saves. Clearing filters from an empty result restores all trips or photos in the current view.

## Acceptance checks

- A caption-only match finds a trip. Combined filters give the same eligible trips across views. Gallery displays photos only from matching trips. Older entries remain searchable.
- Add, rename or remove a tag on a trip and reopen it. The tag filter and a resumed draft reflect the intended values.
- Two trips in one month and one in another year appear in the correct groups. Switching from Timeline to Stories keeps the selected year. An empty selection offers a way back.
- Trash a trip with photos, reload and restore it. Its ID, story order, tags and photos survive. A stale edit cannot undo the deletion and another user cannot list or restore the trip.
