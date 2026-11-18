# Phase 1 · Draft recovery and full-screen photos

**Status** Implemented. Automated coverage exists. Hands-on desktop and mobile review remains open.

## Draft recovery

Opening **New trip** resumes the current user’s unfinished new trip on that browser. Opening **Edit trip** resumes the draft for that specific saved trip. A person can have one new-trip draft and independent edits for multiple saved trips.

- Autosave title, destination, trip date, rich story, captions, retained photo references and pending image files. Partially filled forms must survive even when they cannot yet be submitted.
- Save snapshots to account-scoped IndexedDB and show save status in the editor. Closing the editor keeps the draft. Saving successfully or explicitly choosing **Discard draft** clears the corresponding snapshot.
- Keep the base revision and request identity across recovery. A failed save leaves the draft available. An older tab cannot replace or clear a newer snapshot.
- Drafts stay on the device and browser where the user wrote them. R2 uploads occur when the trip is submitted.

## Full-screen photo viewer

A photo in a saved story or Gallery opens at the selected image. The viewer shows its caption and position within that trip. Previous and next controls, keyboard arrows and touch swipes follow story order. Closing returns the reader to the originating context. Gallery also offers **Read story**.

## Acceptance and remaining verification

- Start a trip, enter text, insert a photo with a caption, close and reload. Resume the draft and verify the image file and its position. Repeat from **Edit trip** with both a retained photo and a new one.
- Fail a save, reopen and retry. Verify a single saved trip. Discard a different draft and verify the saved trip is intact. Exercise two tabs and two accounts.
- Open a middle image from both entry points. Check caption, order, keyboard navigation, close and focus return. Check a one-photo trip and an older story.
- Run the [interaction tests](../tests/writing-editor.test.mjs). On a real phone, verify swipe, caption readability, portrait/landscape sizing and draft recovery after reload. On desktop verify keyboard focus through open and close.
