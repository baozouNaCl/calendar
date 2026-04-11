# Karin

`Karin` is the shell application for `Kaede Notebook`.

It is not the data itself.  
It is the desktop software that creates, opens, edits, saves, and manages a `Kaede` package through both AI and UI.

## Core Terms

### Karin

The shell/editor application.

Responsibilities:

- create a new `Kaede Notebook`
- open an existing `Kaede Notebook`
- provide visual editing and browsing
- provide an LLM assistant for natural-language management
- save, export, back up, and migrate the notebook package

### Kaede Notebook

The autonomous notebook/package format managed by `Karin`.

`Kaede` is the core asset of the system.  
It should remain understandable and operable even without `Karin`.

A `Kaede` package is expected to include:

- structured data
- raw inputs
- retrieval/index layers
- trace/history layers
- schema and migrations
- operation rules
- tool/interface descriptions
- AI-readable documentation

## Product Definition

Chronicle is best understood as:

`Kaede Notebook` + `Karin`

Where:

- `Kaede` is the notebook/package format
- `Karin` is the shell that manages that package

This means `Karin` should be designed more like a dedicated editor/host than a traditional monolithic calendar app.

## Karin Internal Structure

`Karin` contains two primary user-facing subsystems:

### 1. Karin Assistant

The LLM assistant inside `Karin`.

Responsibilities:

- normal LLM conversation
- explanation, summarization, reasoning, and advice
- reading the currently opened `Kaede` documentation and interface contract
- deciding when notebook tools are needed
- querying or managing the opened `Kaede`
- replying in natural language

The assistant is not the data truth layer.  
It is an intelligent operator over `Kaede`.

### 2. Karin UI

The visual interface inside `Karin`.

Responsibilities:

- display notebook content primarily through calendar/time-based views
- support direct editing without requiring chat
- expose drafts, trace, tags, tasks, and record details visually
- provide a clear graphical workflow for managing the notebook

The UI is not the data truth layer either.  
It is the graphical operator over `Kaede`.

## Single Source of Truth

`Karin Assistant` and `Karin UI` are dual entry points.  
`Kaede` is the single source of truth.

So whether a user:

- edits an item in the UI
- asks the assistant to add or modify something

the final change should flow into the same `Kaede` and obey the same rules.

## Architectural Rule

For every feature, ask:

`Does this belong to Karin, or does this belong to Kaede?`

Use this rule:

- if it must remain valid even without `Karin`, it belongs to `Kaede`
- if it mainly helps users operate `Kaede`, it belongs to `Karin`

## Current Direction

This `v4/Karin` folder is the formal implementation target for the shell.

Recommended migration order:

1. establish `Kaede` package lifecycle inside `Karin`
2. implement the data/runtime bridge to an opened `Kaede`
3. migrate stable schema and storage rules
4. migrate import/export and retrieval support
5. migrate visual calendar/task editing
6. migrate the richer assistant workflow

## Further Reading

- [docs/CURRENT_UI_AND_INTERACTION_SUMMARY.md](/Users/nacl/Desktop/日程/v4/Karin/docs/CURRENT_UI_AND_INTERACTION_SUMMARY.md)
- [ARCHITECTURE.md](/Users/nacl/Desktop/日程/v4/Karin/ARCHITECTURE.md)
- [KARIN_KAEDE_VERSIONING_AND_MIGRATION.md](/Users/nacl/Desktop/日程/v4/Karin/KARIN_KAEDE_VERSIONING_AND_MIGRATION.md)
- [MIGRATION_DEVELOPMENT_TEMPLATE.md](/Users/nacl/Desktop/日程/v4/Karin/MIGRATION_DEVELOPMENT_TEMPLATE.md)
- [CONTEXT_ENGINE_ARCHITECTURE.md](/Users/nacl/Desktop/日程/v4/Karin/CONTEXT_ENGINE_ARCHITECTURE.md)
- [AI_ASSISTANT_STATUS.md](/Users/nacl/Desktop/日程/v4/Karin/AI_ASSISTANT_STATUS.md)
- [CURRENT_PRODUCT_STATE_SUMMARY.md](/Users/nacl/Desktop/日程/v4/Karin/CURRENT_PRODUCT_STATE_SUMMARY.md)
- [V6_PRODUCT_BASELINE.md](/Users/nacl/Desktop/日程/v4/Karin/V6_PRODUCT_BASELINE.md)
- [UI_REQUIREMENTS_TEMPLATE.md](/Users/nacl/Desktop/日程/v4/Karin/UI_REQUIREMENTS_TEMPLATE.md)
- [RELEASE_UI_REFACTOR_PLAN.md](/Users/nacl/Desktop/日程/v4/Karin/RELEASE_UI_REFACTOR_PLAN.md)
- [KAEDE_SCHEMA_AND_TAG_SYSTEM_PLAN.md](/Users/nacl/Desktop/日程/v4/Karin/KAEDE_SCHEMA_AND_TAG_SYSTEM_PLAN.md)
- [V3_TO_V4_MIGRATION_AUDIT.md](/Users/nacl/Desktop/日程/v4/Karin/V3_TO_V4_MIGRATION_AUDIT.md)
- [HANDOFF_TO_NEXT_AGENT.md](/Users/nacl/Desktop/日程/HANDOFF_TO_NEXT_AGENT.md)
- [v3 docs](/Users/nacl/Desktop/日程/v3/docs/README.md)
- [v3 database package](/Users/nacl/Desktop/日程/v3/database/README.md)
