# Current UI And Interaction Summary

## Purpose

This document records the **already-confirmed** UI behaviors, interaction rules, and implementation principles currently landed in `v4/Karin`.

It is intended as a practical handoff note for the next teammate.

Priority order when reading:

1. this file
2. [README.md](/Users/nacl/Desktop/日程/v4/Karin/README.md)
3. [CALENDAR_CARD_DRAG_ARCHITECTURE_PLAN.md](/Users/nacl/Desktop/日程/v4/Karin/docs/CALENDAR_CARD_DRAG_ARCHITECTURE_PLAN.md)
4. [UI_INTERACTION_ARCHITECTURE_REFACTOR_PLAN.md](/Users/nacl/Desktop/日程/v4/Karin/docs/UI_INTERACTION_ARCHITECTURE_REFACTOR_PLAN.md)
5. migration files in `src-tauri/src/`
6. current implementation in [src/legacy/app.js](/Users/nacl/Desktop/日程/v4/Karin/src/legacy/app.js) and [src/styles.css](/Users/nacl/Desktop/日程/v4/Karin/src/styles.css)

---

## Product-Level Principles

### 1. Karin and Kaede are separate roles

- `Karin` is the shell/editor.
- `Kaede Notebook` is the data/package truth.
- UI and AI are both operators over Kaede, not the truth layer.

### 2. All real writes should converge to shared write APIs

For `calendar` records, do not invent ad hoc write paths.

Current stable write entry points:

- `createEventFromForm(...)`
- `updateExistingEvent(...)`
- `deleteEventRecordById(...)`

Reason:

- migration compatibility
- trace/snapshot consistency
- searchDoc consistency
- tag/color consistency
- future refactor safety

### 3. Migration-sensitive changes must follow formal migration rules

Anything that changes record structure must not be done only in UI logic.

Current schema status:

- current schema target: `v6`
- migration is confirmation-gated before open
- upgrade is not silent anymore

Relevant files:

- [src-tauri/src/migration.rs](/Users/nacl/Desktop/日程/v4/Karin/src-tauri/src/migration.rs)
- [src-tauri/src/migration_steps.rs](/Users/nacl/Desktop/日程/v4/Karin/src-tauri/src/migration_steps.rs)

### 4. Time structure has already been unified

Calendar records now conceptually use:

- `startAt`
- `endAt`

Legacy-compatible projections are still kept:

- `date`
- `endDate`
- `startTime`
- `endTime`

UI should keep using compatible fields where convenient, but must not assume old single-date-only logic anymore.

### 5. Tag color is a real business color, not decorative theme color

Any event/todo chip that represents a record should prefer record accent/tag color logic.

Theme styling must not overwrite record accent color unless intentionally doing so.

---

## Implemented UI Milestones In This Iteration

This section is the short backup summary of the current UI branch before the next interaction refactor.

### 1. Shared selection/highlight baseline exists

Current direction already landed:

- one shared selected calendar item state
- detail popover opening synchronizes highlight
- closing detail clears highlight immediately
- clicking blank area can clear highlight

Important implementation principle:

- selection is no longer supposed to be owned separately by day/week/month

### 2. Day / week / month now share much more of the card interaction model

Already landed:

- shared card metadata via `buildCalendarCardViewModel(...)`
- stable drag metadata on cards
- shared accent/tag color projection
- unified selected state styling for all major calendar card types

### 3. Day all-day quick entry was unified with week/month semantics

Confirmed behavior:

- day all-day strip supports double-click create
- single-day all-day cards support inline quick edit
- `Enter` continues next item
- `ArrowUp` / `ArrowDown` moves quick-entry focus
- empty `Backspace/Delete` removes blank quick-entry item

### 4. Month view got major stability work

Already landed:

- month delete/save flows preserve scroller position
- month quick-entry no longer uses navigation logic
- month first-column all-day lane bug was fixed
- month all-day lane sorting is now compact-height oriented
- month single-click card open is local popover open, not navigation
- month all-day drag creation and drag move foundations exist

### 5. Week view got shared timed drag foundations

Already landed:

- week timed drag and blank-area timed creation share the same timeline drag engine
- week scroll restoration distinguishes normal sync from preview lock
- week left-edge snapping is day-based rather than half-column pixel state

### 6. Drag preview direction is now established

Current confirmed direction:

- drag should use lightweight preview layers
- original card becomes dimmed source
- drag move should not persist data during mousemove
- final write only happens on pointerup

This is already true for day/week timed drag and partially true for month/week all-day drag.

### 7. Today markers and card color rules were unified

Already landed:

- day/week/month today labels now share the same filled red badge direction
- business tag/accent colors are preserved on event cards instead of being flattened by theme styling

---

## Current Refactor Boundary

The next stage should **not** continue patching interaction per view.

The current agreed direction is:

- organize by operated object
- keep view-specific layout shells
- unify interaction semantics underneath

The formal plan for that next stage is documented in:

- [UI_INTERACTION_ARCHITECTURE_REFACTOR_PLAN.md](/Users/nacl/Desktop/日程/v4/Karin/docs/UI_INTERACTION_ARCHITECTURE_REFACTOR_PLAN.md)

---

## Confirmed UI Style Direction

### 1. Soft-sculpt / semi-neumorphic style is a real supported direction

Current UI work assumes:

- `soft-sculpt` is a valid theme
- it should preserve layered soft relief
- but business cards/events still need their own accent colors

### 2. Input surfaces in detail editing use inset treatment

The event detail card now uses inset/deep controls for:

- title field
- temporal inline inputs
- location
- notes
- AI input

### 3. Decorative/secondary text should be aggressively compressed

Confirmed direction:

- reduce redundant labels
- reduce line count
- put frequently used actions higher
- keep low-frequency information collapsed

---

## Event Detail Popover / Detail Panel

### Confirmed behavior

The event detail UI now follows progressive disclosure:

1. compact time summary
2. click to expand inline temporal editor
3. no third-level picker popover

### Compact time summary rules

- same day timed event:
  - `2026年4月8日07:00 - 07:00`
- cross-day timed event:
  - `2026年4月8日07:00 - 2026年4月9日07:00`
- all-day same day:
  - `2026年4月8日 全天`
- all-day cross-day:
  - `2026年4月8日 - 2026年4月9日 全天`

### Expand/collapse behavior

- time summary and expanded editor coexist in DOM
- expand/collapse uses class switching, not full structural replacement
- this is done to avoid losing focus and to keep animation light

### Auto-collapse rules

When temporal editor is expanded, focusing or working on non-time fields should collapse it:

- title
- location
- notes
- AI input
- tag trigger

### AI block rules

Confirmed compact version:

- no extra instructional subtitle
- no always-visible status helper line
- title and action button share one row

### Notes field rules

- default height is one row
- still resizable

---

## Month View

## Confirmed role

Month view should behave more like a lightweight list/calendar hybrid for all-day planning.

It now supports two operation modes:

### 1. Traditional mode

- click existing card/bar
- open detail popover
- edit/delete through detail UI

### 2. Quick-entry mode

This mode is only for **single-day all-day events**.

It is intentionally not used for:

- cross-day events
- timed events

### Quick-entry rules

- double-click day header:
  - navigate to day view
- double-click empty content area in a day cell:
  - create one lightweight single-day all-day event
  - immediately enter inline title editing
- double-click an existing single-day all-day event:
  - keep detail route available
  - also allow direct inline title editing
- typing while detail popover is open:
  - closes popover
  - keeps quick title editing
- `Enter` on a non-empty title:
  - save current item
  - create the next item immediately below
  - continue editing next title
- `Enter` on an empty title:
  - save current item as default title
  - exit quick-entry mode
- `Backspace/Delete` on an empty quick-entry input:
  - delete that blank event directly

### Scroll stability rules in month view

Month view uses virtualized continuous month scrolling.

Confirmed implementation principle:

- month-level anchor alone is not enough after all-day deletion
- deleting an all-day item can change week height
- therefore scroll restore now prefers **visible week anchor**
- month anchor is only fallback

Implementation idea already landed:

- `data-week-start` is intentionally added on `.month-week-row`
- `monthScroll.restoreWeekStart`
- `monthScroll.restoreWeekOffset`

Do not remove these without replacing the restore logic.

---

## Week View

## Confirmed structural rule

Week view scrolling architecture must remain:

### 1. Left time rail

- vertical only
- no horizontal participation

### 2. Top pane

- horizontal only
- contains:
  - date headers
  - all-day area

### 3. Main scroll body

- horizontal + vertical
- owns timed grid

This split is essential for:

- horizontal infinite-like window recentering
- vertical synchronization
- keeping time labels aligned with timed cards

### Current week virtual scroll behavior

Week view currently uses:

- 35-day horizontal window
- focus-date tracking
- recentering when active date drifts outside safe range
- synchronized `scrollLeft` between top pane and main pane
- synchronized `scrollTop` between left time rail and main pane

Do not collapse these containers into one scrolling layer.

### Week all-day area: confirmed new direction

The top all-day row now follows the same conceptual logic as month view:

- single-day all-day events can be quick-edited
- cross-day all-day events render as continuous cross-column bars
- empty space double-click enters quick entry
- existing single-day all-day event double-click enters quick title editing

### Important difference from month view

Month view uses month/week anchors for restore.

Week view quick entry must preserve:

- `focusDate`
- horizontal offset relative to the active header cell
- vertical scroll top

This is why week quick-entry state is separate from month quick-entry state.

### Week all-day coloring rule

Week all-day bars should use the same record accent/tag color logic as other event cards.

Theme panel colors must not flatten them into uniform gray.

---

## Global Delete Behavior

Confirmed rule:

- if a calendar card is currently selected, `Delete` / `Backspace` can delete it
- this applies across views where a selected calendar record exists
- month/ week quick-entry blank items also support direct delete from keyboard

Unified delete path:

- `deleteEventRecordById(...)`

This helper should remain the single delete truth for calendar UI actions.

Reason:

- snapshot consistency
- searchDoc cleanup
- popover cleanup
- quick-entry cleanup
- scroll preservation hooks

---

## Current Stable Technical Patterns

### 1. Keep quick-entry and detail editing as two layers, not one merged mode

Reason:

- detail editing handles complete data
- quick entry handles title-only speed path
- merging both makes focus, popover, and keyboard behavior much harder to keep stable

### 2. Preserve scroll position before re-render if structural height can change

Use preservation helpers before any render that can change:

- week all-day lane count
- month week row height
- virtual window position

### 3. Reuse existing business helpers when extending views

Prefer reusing:

- `isAllDayLikeRecord(...)`
- `getEventEndDateIso(...)`
- `buildRecordAccentStyle(...)`
- `persistMonthQuickEntryTitle(...)` for title-only writeback logic
- shared create/update/delete APIs

### 4. Cross-day all-day rendering should be bar-based, not per-cell duplicated chips

This is already the direction in:

- month view
- week top all-day row

Do not regress back to “duplicate the same event in every day cell” for cross-day display.

---

## What Is Already Determined And Should Not Be Re-litigated Lightly

- migration confirmation before notebook open
- schema `v6` time range unification
- scoped tag system stays intact
- event detail uses progressive disclosure, not full always-open editor
- all-day/timed explicit toggle is removed from detail temporal editor
- month quick entry is only for single-day all-day items
- week top all-day area should follow the same quick-entry concept
- record accent/tag color should remain visible in event cards and all-day bars
- delete behavior should be unified through one helper
- month and week scroll stability are first-class requirements, not polish

---

## Files Most Relevant For The Next Teammate

- [src/legacy/app.js](/Users/nacl/Desktop/日程/v4/Karin/src/legacy/app.js)
- [src/styles.css](/Users/nacl/Desktop/日程/v4/Karin/src/styles.css)
- [src-tauri/src/migration.rs](/Users/nacl/Desktop/日程/v4/Karin/src-tauri/src/migration.rs)
- [src-tauri/src/migration_steps.rs](/Users/nacl/Desktop/日程/v4/Karin/src-tauri/src/migration_steps.rs)
- [README.md](/Users/nacl/Desktop/日程/v4/Karin/README.md)

---

## Suggested Next Reading Order In Code

1. month view render + quick entry
2. week view render + pane sync
3. event detail popover
4. shared create/update/delete record APIs
5. migration planner and migration steps
