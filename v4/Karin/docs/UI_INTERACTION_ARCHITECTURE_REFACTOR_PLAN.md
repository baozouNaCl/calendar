# UI Interaction Architecture Refactor Plan

## Purpose

This document defines the next formal refactor for `v4/Karin` calendar UI interaction logic.

It is based on:

- current Karin implementation reality
- confirmed product requirements from the current UI iteration
- common patterns used by mature calendar systems such as Apple Calendar, FullCalendar, and react-big-calendar

The core architectural decision is:

`organize interaction by operated object, not by current view`

That means we do **not** treat `day / week / month` as the primary logic boundary.

Instead, we split the system into:

1. card objects
2. viewport objects
3. interaction-state objects
4. drop-policy objects

---

## Executive Summary

The current UI should be refactored around four shared layers.

### 1. Card Layer

The operated business object is always a calendar card derived from one calendar record.

There are only two semantic card families:

- `AllDayCard`
- `TimedCard`

They share:

- selection
- blur / unfocus
- detail opening
- drag lifecycle
- tag/accent color logic

They differ only in:

- layout form
- hit-test interpretation
- drop behavior

### 2. Viewport Layer

The UI container is one of:

- `DayViewport`
- `WeekViewport`
- `MonthViewport`

Viewports should only own:

- layout shell
- scroll skeleton
- hit-test geometry adapters
- view-local rendering

Viewports should **not** own final business drag semantics.

### 3. Interaction State Layer

The project must keep one shared interaction state model across all views:

- `activeEventId`
- `detailPopoverState`
- `quickEntryState`
- `dragSession`
- suppression flags for click/detail conflicts

This layer is required to avoid:

- stale highlight after drag
- one view clearing selection while another keeps it
- detail popover and quick entry competing
- drag completion causing accidental click-open

### 4. Drop Policy Layer

Mouse position does not directly mean how data should be written.

Between hit-test and persistence, Karin needs one shared drop-policy layer that decides:

- whether a drop is allowed
- whether the destination is `all-day zone` or `timeline zone`
- whether the operation is `move`, `reorder`, `convert`, or later `resize`
- how to generate the final event payload
- whether the operation should revert on failure

---

## Architectural Goals

This refactor should achieve the following:

1. one interaction rule should exist in one place only
2. day/week/month should share the same all-day system where semantics match
3. day/week should share the same timeline system where semantics match
4. month should reuse the same card and selection lifecycle even when layout differs
5. drag preview must be lightweight and separated from real record writes
6. all record writes must still converge to shared write APIs
7. week view may keep unique infinite-scroll structure without becoming a separate interaction model

---

## Object Model

## 1. Record Object

All interaction ultimately mutates one `calendar` record structure.

Required stable fields:

- `id`
- `title`
- `date`
- `endDate`
- `allDay`
- `startTime`
- `endTime`
- `tags`
- `tagColor`
- `location`
- `notes`

Conceptual time truth should continue to align with:

- `startAt`
- `endAt`

Legacy-compatible fields remain valid projections.

## 2. Card Object

Suggested shared card view-model shape:

```ts
type CalendarCardViewModel = {
  recordId: string;
  title: string;
  isAllDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  displayTimeText: string;
  accentColor: string;
  accentStyle: string;
  cardKind:
    | "day_all_day"
    | "day_timed"
    | "week_all_day"
    | "week_timed"
    | "month_span"
    | "month_inline";
  dragKind:
    | "move_all_day"
    | "move_timed";
};
```

Important:

- `cardKind` describes current rendering shell
- `dragKind` describes interaction family

We should not infer drag semantics from CSS class names.

## 3. Viewport Object

Each viewport is only a rendering and geometry adapter.

### `DayViewport`

Owns:

- single-day all-day lane
- single-day timeline
- vertical scroll shell

### `WeekViewport`

Owns:

- all-day lane with horizontal day columns
- timeline grid with horizontal and vertical scroll
- left fixed time rail
- horizontal virtual range / infinite day movement

### `MonthViewport`

Owns:

- month section virtualization
- day-cell grid
- all-day overlay bars
- lightweight timed summary chips

## 4. Interaction State Object

Suggested shape:

```ts
type CalendarInteractionState = {
  activeEventId: string | null;
  detailPopover: { recordId: string; anchor: unknown } | null;
  quickEntry:
    | { scope: "month" | "week" | "day"; recordId: string; draftTitle: string }
    | null;
  dragSession: DragSession | null;
  suppressDetailOpen: { recordId: string; until: number };
  suppressSurfaceClickUntil: number;
};
```

Rules:

- there is only one active selected event at a time
- clicking blank space must clear selection regardless of view
- detail close should clear highlight immediately
- quick entry and detail popover must not actively own the same card at the same time

---

## Shared Systems

## 1. All-Day System

Shared by:

- day view
- week view
- month view

Responsibilities:

- render all-day cards
- quick entry
- direct title editing
- drag to move across dates
- drag to reorder
- cross-day bar projection
- convert all-day card into timed card when dropped onto timeline

View-specific adapters only provide:

- lane geometry
- card anchor DOM
- local preview container

## 2. Timeline System

Shared by:

- day view
- week view

Responsibilities:

- map pointer to `{ dateIso, minutes }`
- blank-area drag create
- timed-card drag move
- snap rules
- preview overlay rendering
- later timed resize logic

View-specific adapters only provide:

- visible day range
- hour height
- geometry rect
- horizontal day-column calculation for week view

## 3. Detail / Edit System

Shared by all views.

Responsibilities:

- open detail popover
- close detail popover
- auto-save draft
- synchronize card highlight
- collapse temporal editor when appropriate
- coordinate with quick-entry state

---

## Shared Drag Model

Drag should be modeled by interaction semantics, not by current view.

## Supported semantic operations

### `create_timed`

Blank timeline drag creates a timed event.

Used by:

- day timeline
- week timeline

### `move_timed`

Dragging an existing timed card changes start/end time while preserving duration.

Used by:

- day timeline
- week timeline
- month timed summaries when moving between dates

### `move_all_day`

Dragging inside all-day lanes changes date span and/or ordering.

Used by:

- day all-day lane
- week all-day lane
- month all-day bar lane

### `convert_all_day_to_timed`

Dragging an all-day card onto a timeline converts it into a timed record.

Used by:

- day view
- week view

### `convert_timed_to_all_day`

This is not the current rollout target yet, but the architecture should keep room for it.

---

## Drag Session Lifecycle

All drag types should use one shared lifecycle:

1. `pointerdown`
2. `drag threshold check`
3. `session creation`
4. `preview updates only`
5. `pointerup`
6. `drop policy resolution`
7. `single final commit`

### Hard rule

During drag move:

- do not write the database
- do not run full business render loops if a preview layer can handle it
- do not let preview DOM become the truth state

---

## Drop Policy Layer

This layer is required and should be explicit.

Suggested responsibilities:

- `resolveDropZone(pointer, viewport)`
- `resolveDropOperation(session, zone)`
- `buildDropPayload(session, operation)`
- `isDropAllowed(session, operation)`
- `revertIfNeeded(session, failure)`

### Example policies

- all-day -> timeline:
  - convert to timed
  - default duration: `60` minutes
- timed -> all-day:
  - clear explicit time
  - preserve date span by day semantics
- timed -> month other day:
  - only date changes
  - time-of-day stays the same
- all-day -> all-day lane:
  - may update date
  - may update order

This layer should not live inside individual `renderDayView()` / `renderWeekView()` / `renderCalendar()` functions.

---

## Preview Layer Rules

Research-backed implementation principle:

- keep a light drag mirror / preview layer
- keep original card as source placeholder or dimmed source
- keep destination highlight separate

Therefore Karin should continue converging toward:

1. source card dim state
2. reusable preview DOM node
3. destination lane/date highlight

Do not make full record persistence depend on preview DOM location.

---

## Selection and Blur Rules

These are shared rules and must not differ by view.

### Selection

- clicking a card selects it
- opening detail popover selects it
- selecting another card replaces current selection

### Blur

- clicking blank area always clears selected highlight
- closing detail popover clears highlight immediately
- quick-entry blur should not depend on detail popover lifecycle

### Drag

- drag start should not auto-open detail
- drag end should suppress the next accidental click-open briefly

---

## What Must Be Shared

The following should be unified, not duplicated:

- calendar record temporal schema
- card view-model builder
- selection and blur logic
- detail popover state handling
- quick-entry lifecycle
- drag-session creation / teardown
- timeline hit-test model
- all-day hit-test model
- preview-layer update model
- temporal mutation helpers
- conversion rules between all-day and timed
- final write path through shared record APIs

---

## What May Stay View-Specific

These are allowed to remain per-view:

- day layout shell
- week infinite scroll structure
- month continuous month scroller structure
- concrete DOM structure of cards
- view-specific styling and animation tuning
- week-view fixed rail / top-pane / scroll-body sync logic

Shared interaction semantics do not require identical markup.

---

## Recommended Code Structure

Suggested long-term split:

```text
src/
  calendar/
    core/
      card-model.ts
      selection.ts
      detail-state.ts
      quick-entry.ts
      temporal-mutation.ts
      drag-session.ts
      drop-policy.ts
      preview-layer.ts
      hit-test/
        timeline-hit.ts
        all-day-hit.ts
    views/
      day/
        day-viewport.ts
      week/
        week-viewport.ts
      month/
        month-viewport.ts
```

`src/legacy/app.js` may still assemble these for now, but new logic should be extracted in this direction.

---

## Execution Plan

## Phase 1. Freeze shared state contracts

Tasks:

- define stable shared interaction state
- ensure one `activeEventId`
- ensure one detail popover state
- ensure one quick-entry state model per scope

Done criteria:

- blank-space blur is consistent in all views
- detail close always clears highlight immediately

## Phase 2. Freeze shared card model

Tasks:

- keep shared `buildCalendarCardViewModel(...)`
- ensure all rendered calendar cards expose stable drag metadata

Done criteria:

- day/week/month cards all carry stable semantic metadata

## Phase 3. Extract all-day system

Tasks:

- formalize all-day lane hit-test
- unify all-day drag session semantics
- unify reorder / date-move / all-day-to-timed conversion

Done criteria:

- all-day drag rules are identical in day/week/month where semantics match

## Phase 4. Extract timeline system

Tasks:

- unify day/week timeline create
- unify day/week timed-card move
- later add resize support on the same base

Done criteria:

- timed drag no longer requires separate day/week business rules

## Phase 5. Move view-specific code into adapters

Tasks:

- keep only geometry and layout specifics in day/week/month controllers
- move generic interaction code out of view render functions

Done criteria:

- render functions become mostly “markup + bind local adapters”

---

## Current Known Risks

These are the main areas to watch during the refactor:

1. week view scroll synchronization and preview layers interfering
2. month view scroller restoration fighting drag previews
3. quick-entry blur timing racing with click and drag
4. drag preview DOM replacement causing hard-cut motion
5. record write helpers drifting away from migration-safe payload rules

---

## Final Rule

The most important architectural rule is:

`calendar interaction semantics are shared capabilities; day/week/month are only different viewport shells`

If future code reintroduces full per-view copies of:

- selection logic
- drag interpretation
- quick-entry lifecycle
- temporal mutation rules

then the project will quickly regress into the same inconsistency problems this refactor is meant to solve.
