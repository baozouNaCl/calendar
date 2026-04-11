# Karin / Kaede V6 Product Baseline

## Purpose

This document defines the current `v6` baseline of the `Karin / Kaede` system inside `v4/Karin`.

It is not only a schema note.

It is the current version-level summary of:

- product structure
- Karin / Kaede boundary
- major completed work from `v4` to `v6`
- next major implementation targets

## Version Meaning

Current confirmed data/schema baseline:

- `Kaede schemaVersion = 6`
- `Kaede packageVersion = 0.1.0`

In code:

- [src-tauri/src/lib.rs](/Users/nacl/Desktop/日程/v4/Karin/src-tauri/src/lib.rs)
- [src-tauri/src/migration.rs](/Users/nacl/Desktop/日程/v4/Karin/src-tauri/src/migration.rs)
- [src-tauri/src/migration_steps.rs](/Users/nacl/Desktop/日程/v4/Karin/src-tauri/src/migration_steps.rs)
- [src/legacy/database/store.js](/Users/nacl/Desktop/日程/v4/Karin/src/legacy/database/store.js)

This `v6` document should be understood as:

`the current stable architecture and product baseline that v4 implementation has now reached`

## Core Position

`v6` still keeps the earliest core principle:

`Karin` and `Kaede` must remain separated.

### Kaede remains relatively independent

`Kaede` is still the notebook/package truth layer.

It must remain usable and understandable even without `Karin`.

That means `Kaede` continues to own:

- durable notebook data
- schema and migration state
- AI-readable notebook docs
- record structure
- tags, raw inputs, search docs, trace logs, attachments, chat history
- notebook-facing operation contract

### Karin remains the shell

`Karin` is still the shell/editor/agent host around an opened `Kaede`.

Its job is to operate `Kaede`, not replace it.

`Karin` currently has two primary product parts:

### 1. UI

The visual calendar/task workspace.

Current role:

- open and inspect notebook content
- create, edit, navigate, and manage records visually
- present calendar information through day/week/month/task views
- provide direct interaction surfaces for notebook editing

### 2. AI Assistant

The language-based operator inside `Karin`.

Current role:

- support normal LLM conversation
- read Kaede-facing docs
- operate Kaede mainly through explicit interfaces
- query, summarize, create, and modify notebook content
- work together with UI rather than replacing UI

## V4 To V6: Two Major Completed Workstreams

From `v4` to the current `v6` baseline, the project mainly completed two large directions.

## Workstream 1: AI assistant upgrade

This was not only a prompt adjustment.

It was a structural upgrade of the assistant path.

### 1. Query logic was reorganized

The assistant is now closer to:

- understanding intent
- planning tool/interface usage
- calling Kaede-related operations through clearer interfaces
- organizing a final answer

Instead of treating every message as raw free chat over a large notebook dump.

### 2. Context engineering was upgraded

The assistant path now explicitly manages context instead of scattering prompt strings everywhere.

Main direction:

- Kaede owns durable AI-facing docs
- Karin owns request assembly strategy
- stable request ordering is used to improve prefix-cache performance
- context blocks are made more compact and more interpretable

This improved:

- cache hit quality
- token efficiency
- debugging clarity
- future prompt iteration space

### 3. Assistant UI was improved

The assistant is no longer only a plain text output surface.

Current improvements include:

- more natural-language output style
- referenced schedule cards in replies
- record-card click-through into the workspace
- clearer runtime/token observation path for testing

### 4. Detail-level AI assistant was added

Besides the outer Karin assistant, `v6` now also has a smaller event-detail AI assistant.

Its job is:

- patch the current record only
- reduce token cost for tiny field edits
- avoid polluting the outer assistant request family

This is now part of the formal architecture.

## Workstream 2: UI and interaction upgrade

The second major direction was broad UI repair and interaction refinement.

This was not only visual polish.

It also fixed many broken or unstable interaction paths.

### 1. Many UI bugs were repaired

Main repaired areas include:

- mounted Kaede opening flow stability
- popover positioning stability
- week/month/day cross-view detail behavior
- tag display and filtering interaction
- layout density and readability
- calendar event rendering consistency

### 2. Many interaction methods were added

Current interaction model is much richer than the early `v4` state.

Examples:

- chat-card-driven workspace navigation
- detail popover editing
- auto-save on close
- quick-entry behavior in time/calendar surfaces
- richer tag operations
- tighter AI and UI coordination

### 3. Overall interaction logic was cleaned up

The system now has clearer rules such as:

- single source of truth remains Kaede
- UI and AI both converge into the same data pipeline
- detail editing goes through a draft boundary first
- navigation and detail opening share one unified path
- source-anchored popover behavior is treated as a real interaction rule, not a temporary effect

## Current V6 Data / Schema Meaning

The current `v6` schema baseline mainly means:

### 1. Migration chain is formalized up to v6

Current migration ladder:

- `v4`: add `importance`
- `v5`: scoped tags
- `v6`: unify calendar datetime range model

### 2. Calendar records now use a fuller time-range model

`v6` is not only “add endDate”.

Its real meaning is:

- `startAt / endAt` are the formal datetime truth layer
- `date / endDate / startTime / endTime` are retained as compatibility and UI projection fields
- all-day and timed records stay in one calendar record system

This provides a better base for:

- cross-day events
- future drag interactions
- unified search/reference behavior

## Current Architectural Rule In One Sentence

At `v6`, the system should be understood as:

`Karin is a shell with UI + AI assistant, and Kaede is the independent notebook package that both of them operate through explicit contracts.`

## Next Major Work

The next stage should continue from this `v6` baseline instead of reopening the earlier architecture debate.

Current main targets are:

## 1. Continue interaction upgrades

Priority interaction work:

- add drag-to-move schedule cards
- add month-view drag creation for cross-day records
- add week-view drag creation for cross-day records
- continue polishing day/week/month detail interactions

## 2. Reorganize the whole schedule-card system

This should become a more unified subsystem.

Target direction:

- unify card structure
- unify card color/tag logic
- unify card interaction states
- unify navigation anchor behavior
- unify detail entry behavior

The ideal result is:

`calendar cards become one coherent product system, not a set of per-view special cases`

## 3. Prepare behavior-trace style record capabilities

This is the next important foundation work for the AI assistant.

The system should start preparing richer trace/input record types for:

- behavioral traces
- richer source traces
- multimodal input lineage

This is especially important for the next step:

- image input
- video input
- audio input

The goal is not only “upload more file types”.

The goal is:

`prepare Kaede and Karin for richer AI-understandable input history`

So that future assistant workflows can safely understand:

- where an input came from
- how it was parsed
- which record it affected
- how that result should be traced and revised later

## Recommended Reading Order

For the current baseline, the most useful reading order is:

1. [README.md](/Users/nacl/Desktop/日程/v4/Karin/README.md)
2. [ARCHITECTURE.md](/Users/nacl/Desktop/日程/v4/Karin/ARCHITECTURE.md)
3. [CURRENT_PRODUCT_STATE_SUMMARY.md](/Users/nacl/Desktop/日程/v4/Karin/CURRENT_PRODUCT_STATE_SUMMARY.md)
4. [KARIN_KAEDE_VERSIONING_AND_MIGRATION.md](/Users/nacl/Desktop/日程/v4/Karin/KARIN_KAEDE_VERSIONING_AND_MIGRATION.md)
5. [AI_ASSISTANT_STATUS.md](/Users/nacl/Desktop/日程/v4/Karin/AI_ASSISTANT_STATUS.md)
6. [EVENT_DETAIL_AI_ASSISTANT_SPEC.md](/Users/nacl/Desktop/日程/v4/Karin/EVENT_DETAIL_AI_ASSISTANT_SPEC.md)
7. [SCHEDULE_CREATION_SPEC.md](/Users/nacl/Desktop/日程/v4/Karin/SCHEDULE_CREATION_SPEC.md)

