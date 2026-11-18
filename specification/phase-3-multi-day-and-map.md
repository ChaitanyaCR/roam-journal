# Phase 3 · Multi-day trips and World Map

**Status** In progress. Multi-day writing is implemented. World Map is next.

## Multi-day writing

Keep the existing trip date as the start date and add an optional inclusive end date. Let the writer add dated sections to one trip and place text, formatting, photos and captions inside each section. A single-day trip still saves with its existing workflow. Preserve undated story content when the author adds a section.

Use calendar dates consistently across the editor, Timeline and reader. Reject an end before the start and flag sections outside the trip range before saving. Show the range in trip detail and Timeline. A trip crossing New Year appears once under its start date’s Timeline milestone. Trips with the same start date share that milestone, even when their end dates differ.

Migration 0006 adds a nullable end date. The editor appends a dated section after the existing story and lets the writer edit the section date. Stories with dated sections use document version 2. Plain-text, block-based and version 1 entries remain readable and editable. The editor and Worker validate section dates against the inclusive trip range on submission. Drafts retain unfinished sections and pending photos.

## World Map

Add **World Map** beside Timeline in the journal navigation. The author can associate a trip with a city pin while keeping their written destination. Selecting a pin shows the matching trips at that location and opens the existing trip detail. Apply the same search, year and tag selections as Timeline. Exclude trashed trips. Unpinned trips remain accessible in Stories and Timeline and their photos in Gallery.

**Proposed implementation** Store an optional city label and validated coordinates in D1. Use a stable location identifier for grouping trips at the same city. Choose the map renderer and city selection method before implementing the picker. Provide a keyboard-accessible list of the visible locations and trips.

## Acceptance checks

- Open and edit an older single-day trip. Adding dates and a second day preserves its original content. Resume a draft with dated sections and photos, save, then reopen it.
- A trip spanning December and January shows the full range and appears once in Timeline. Its photos navigate in story order across sections.
- Pin two trips to the same city. The pin lists both. Filter by a tag unique to one and verify only that trip appears. Remove a pin and verify the story remains accessible.
- Test invalid dates and coordinates, a journal with no pins, and a phone-sized viewport. Another owner’s locations and trashed trips must never appear in the map data.
