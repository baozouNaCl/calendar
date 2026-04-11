# Current Product State Summary

## Purpose

This document is the current consolidation note for `v4/Karin`.

It answers one practical question:

`After the recent architecture, migration, AI, and interaction work, what is now actually true in the product?`

It exists because several earlier docs already define the major architecture correctly, but some later confirmed interaction rules and implementation boundaries were never written back into the docs.

This file is the current bridge between:

- architecture intent
- implemented behavior
- release-oriented cleanup

## What The Existing Docs Already Cover Well

The following points are already documented clearly and remain valid:

- `Karin` is the shell/editor, not the truth layer
- `Kaede` is the portable notebook/package and the single source of truth
- `Kaede` owns durable AI-facing docs and notebook rules
- `Karin` owns shell behavior, request assembly, and local convenience cache
- migration is a general compatibility system, not a feature-specific patch area
- the global assistant and the record-detail AI assistant are two different AI layers
- schedule creation should be lightweight and calendar-first

Primary reference docs:

- [README.md](/Users/nacl/Desktop/日程/v4/Karin/README.md)
- [ARCHITECTURE.md](/Users/nacl/Desktop/日程/v4/Karin/ARCHITECTURE.md)
- [CONTEXT_ENGINE_ARCHITECTURE.md](/Users/nacl/Desktop/日程/v4/Karin/CONTEXT_ENGINE_ARCHITECTURE.md)
- [KARIN_KAEDE_VERSIONING_AND_MIGRATION.md](/Users/nacl/Desktop/日程/v4/Karin/KARIN_KAEDE_VERSIONING_AND_MIGRATION.md)
- [SCHEDULE_CREATION_SPEC.md](/Users/nacl/Desktop/日程/v4/Karin/SCHEDULE_CREATION_SPEC.md)
- [EVENT_DETAIL_AI_ASSISTANT_SPEC.md](/Users/nacl/Desktop/日程/v4/Karin/EVENT_DETAIL_AI_ASSISTANT_SPEC.md)

## Confirmed Product Rules That Were Missing Or Under-Documented

These are now part of the real product behavior and should be treated as confirmed.

### 1. Event detail popover is now the main calendar edit surface

For calendar records, the primary editing surface is no longer the old detached editor flow.

Current rule:

- clicking a calendar record opens the event detail popover
- the popover is the main surface for inline editing
- title, date, time range, location, notes, tags, raw input expansion, and detail AI all converge there

Implementation references:

- [src/legacy/app.js](/Users/nacl/Desktop/日程/v4/Karin/src/legacy/app.js)
- `openEventDetailPopover(...)`
- `bindEventDetailActions(...)`
- `rerenderDetailSurface(...)`

### 2. Detail editing now has a strict draft boundary

The detail popover does not write directly into the persisted record while the user is typing.

Current rule:

- popover opens with a draft initialized from the current record
- all manual edits update the draft first
- tag changes update the draft first
- detail AI patch updates the draft first
- persistence happens only when the draft is committed

This is an important architectural boundary:

- UI editing state is temporary
- Kaede record state remains the durable truth

Implementation references:

- [src/legacy/app.js](/Users/nacl/Desktop/日程/v4/Karin/src/legacy/app.js)
- `state.eventDetailDraft`
- `buildEventDetailPayloadFromDraft(...)`
- `persistEventDetailDraft(...)`

### 3. Event detail popover now auto-saves on close

The current product no longer requires an explicit save-only workflow for normal detail editing.

Current rule:

- clicking outside the popover closes it
- pressing `Esc` closes it
- switching to another record closes or replaces it
- closing attempts an auto-save first
- if nothing changed, it simply closes

This means the editing model is now:

`edit in place -> leave the surface -> auto-save if changed`

Implementation references:

- [src/legacy/app.js](/Users/nacl/Desktop/日程/v4/Karin/src/legacy/app.js)
- `closeEventDetailPopover(...)`
- `persistEventDetailDraft(...)`

### 4. The popover must close when the source record leaves the viewport

The detail popover is now anchored to a visible source record, not treated as a floating global modal.

Current rule:

- while scrolling, Karin keeps syncing the popover to the source record
- if the source record is no longer visible in its own scroll viewport, the popover closes

This prevents the product from showing a detached detail card whose source item is no longer on screen.

Implementation references:

- [src/legacy/app.js](/Users/nacl/Desktop/日程/v4/Karin/src/legacy/app.js)
- `scheduleEventDetailViewportSync(...)`
- `getPopoverAnchorRect(...)`
- `positionEventDetailPopover(...)`

### 5. Chat record cards and workspace records now share one navigation system

Assistant replies can render clickable schedule cards.

Current rule:

- clicking a chat record card does not open a separate legacy popup
- it routes into the current workspace
- day view stays day view when possible
- week view stays week view when possible
- month view is allowed to downshift into week view for workable detail editing
- after navigation, the same detail popover opens for that record

Implementation references:

- [src/legacy/app.js](/Users/nacl/Desktop/日程/v4/Karin/src/legacy/app.js)
- `renderChatRecordCards(...)`
- `navigateToRecordDetail(...)`
- `navigateToRecordInWorkspace(...)`

### 6. Record navigation is now hard-cut, not animated

This is a deliberate product decision from the recent interaction cleanup.

Current rule:

- record jump/navigation itself is instant
- Karin does not animate the whole workspace scroll-to-target path anymore
- if the target record is already visible, Karin does not jump; it flashes the record instead

This keeps navigation stable and avoids fake or misleading transition motion.

Implementation references:

- [src/legacy/app.js](/Users/nacl/Desktop/日程/v4/Karin/src/legacy/app.js)
- `scrollAnchorIntoViewInstant(...)`
- `flashRecordAnchor(...)`

### 7. Popover motion is now the only local motion emphasis in this path

The active motion focus is the detail popover itself, not workspace camera movement.

Current rule:

- the popover opens from the source record direction
- the popover closes back toward the source record
- content appears after the shell starts forming
- content retreats before the shell fully closes

Implementation references:

- [src/styles.css](/Users/nacl/Desktop/日程/v4/Karin/src/styles.css)
- [src/legacy/app.js](/Users/nacl/Desktop/日程/v4/Karin/src/legacy/app.js)

### 8. All-day records and timed records already share one true calendar pipeline

The spec already described this direction, but implementation has now gone further and should be recorded explicitly.

Current rule:

- both all-day and timed records are stored as the same calendar record type
- whether a record is treated as all-day is derived from whether concrete times exist
- multi-day all-day records rely on `date` plus `endDate`
- timed and all-day records still converge into the same search, trace, tag, and assistant reference pipeline

This is one of the current schema-level assumptions the UI now depends on.

### 9. Karin shell cache and Kaede notebook state are now clearly split in runtime behavior

This boundary is especially important for future work.

Current rule:

- API base URL, API key, API model, UI theme, mount path, and auto-open preference belong to Karin shell cache
- notebook records, tags, drafts, raw inputs, search docs, attachments, trace logs, and chat history belong to Kaede state

This means:

- changing shell settings should not mutate Kaede schema
- opening the same Kaede in another shell should not require inheriting Karin-local API settings

Implementation references:

- [src/legacy/app.js](/Users/nacl/Desktop/日程/v4/Karin/src/legacy/app.js)
- [src/legacy/database/store.js](/Users/nacl/Desktop/日程/v4/Karin/src/legacy/database/store.js)

### 10. The detail AI assistant is now implemented as a separate request family

This was specified before, but the implementation fact should be made explicit in the current-state docs.

Current rule:

- detail AI only sees current local time, current record draft, and the latest instruction
- it does not load Kaede prompt-pack docs
- it does not load notebook search context
- it returns a field patch, not notebook-level reasoning
- it writes into the detail draft first, then waits for normal save/auto-save

Implementation references:

- [EVENT_DETAIL_AI_ASSISTANT_SPEC.md](/Users/nacl/Desktop/日程/v4/Karin/EVENT_DETAIL_AI_ASSISTANT_SPEC.md)
- [src/legacy/app.js](/Users/nacl/Desktop/日程/v4/Karin/src/legacy/app.js)
- `requestEventDetailAiPatch(...)`
- `applyEventDetailAiPatch(...)`

## Docs That Are Now Partly Outdated

These docs are still useful, but they no longer fully match the current implementation state.

### 1. `TESTING.md`

It still describes an earlier stage where:

- mount/open persistence was still only partially bound
- runtime database behavior was still provisional

That description is behind the current implementation.

### 2. `AI_ASSISTANT_STATUS.md`

The assistant architecture summary is still good, but it does not yet fully document:

- chat-card-to-workspace navigation
- detail popover as the main edit surface
- auto-save-on-close
- visibility-bound popover lifecycle

### 3. `SCHEDULE_CREATION_SPEC.md`

The creation spec is directionally correct, but it does not yet fully capture:

- month quick-entry behavior already present in the code
- week all-day quick-entry behavior already present in the code
- the fact that detail editing now flows through the shared event detail popover after creation

## Recommended Documentation Structure Going Forward

To keep docs maintainable, the cleanest split is:

- keep `README.md` and `ARCHITECTURE.md` at the system level
- keep migration/versioning docs focused only on compatibility and schema lifecycle
- keep assistant docs focused on context, prompt, and request families
- keep creation docs focused on gestures and creation semantics
- use this file as the current confirmed product-state snapshot

## Immediate Follow-Up Suggestions

If we continue documentation cleanup, the next three updates should be:

1. fold the event-detail popover rules into the assistant/UI docs
2. update `TESTING.md` to reflect the current real runtime and persistence model
3. add a dedicated interaction doc for:
   - record navigation
   - detail popover lifecycle
   - quick-entry behavior

