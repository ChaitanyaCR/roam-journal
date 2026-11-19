# Phase 3 · Multi-day trips and World Map

**Status** Implemented. Multi-day writing and World Map are available.

## Multi-day writing

Keep the existing trip date as the start date and add an optional inclusive end date. Let the writer add dated sections to one trip and place text, formatting, photos and captions inside each section. A single-day trip still saves with its existing workflow. Preserve undated story content when the author adds a section.

Use calendar dates consistently across the editor, Timeline and reader. Reject an end before the start and flag sections outside the trip range before saving. Show the range in trip detail and Timeline. A trip crossing New Year appears once under its start date’s Timeline milestone. Trips with the same start date share that milestone, even when their end dates differ.

Migration 0006 adds a nullable end date. The editor appends a dated section after the existing story and lets the writer edit the section date. Stories with dated sections use document version 2. Plain-text, block-based and version 1 entries remain readable and editable. The editor and Worker validate section dates against the inclusive trip range on submission. Drafts retain unfinished sections and pending photos.

## World Map

Add **World Map** beside Timeline in the journal navigation. The author can associate a trip with a city pin while keeping their written destination. Selecting a pin shows the matching trips at that location and opens the existing trip detail. Apply the same search, year and tag selections as Timeline. Exclude trashed trips. Unpinned trips remain accessible in Stories and Timeline and their photos in Gallery.

The build creates an equirectangular map from world-atlas and a searchable catalog from city-timezones, supplemented with Indian GeoNames places, alternate names and Palolem Beach from Wikidata. Both assets are served by the journal. The Worker resolves the chosen catalog label to validated coordinates and stores the label and coordinates together in nullable D1 column `city_pin` (migration 0007). The full city, region and country label identifies a location across trips. Clearing the map city removes the pin. Older clients that omit the field on edit retain the existing pin.

The map uses the active, filtered trip list. The location selector provides keyboard access to the same city groups as the pins, including cities that overlap on small screens. Selecting a location lists its matching stories in date order.

An explicit **Search more places** action sends the typed place name through the authenticated Worker to Geoapify. Selecting a result retains its coordinates, provider ID and data-source attribution in the draft and saved trip. World Map groups these trips by provider ID and displays attribution.

## Acceptance checks

- Open and edit an older single-day trip. Adding dates and a second day preserves its original content. Resume a draft with dated sections and photos, save, then reopen it.
- A trip spanning December and January shows the full range and appears once in Timeline. Its photos navigate in story order across sections.
- Pin two trips to the same city. The pin lists both. Filter by a tag unique to one and verify only that trip appears. Remove a pin and verify the story remains accessible.
- Test invalid dates and coordinates, a journal with no pins, and a phone-sized viewport. Another owner’s locations and trashed trips must never appear in the map data.
