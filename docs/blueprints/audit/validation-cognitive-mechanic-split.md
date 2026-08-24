# Validation: Cognitive vs. Mechanic Split

## Target File(s)
- `olt/scripts/src/capture/validator/mechanical/apca.ts`
- `olt/scripts/src/validation/validator-engine.ts`
- `olt/scripts/src/capture/ui-states-fsm.ts`

## Things to Look For Count
1. **Mechanical Validators:** 0 command privileges, strictly rely on `task:check` and AST linting/typechecks.
2. **Cognitive Validators:** Read-only access, completely barred from `run:exec`.
3. **Evidence Passing:** How screenshots or metrics are passed between tests and UI states.

## What's Happening Here
Validators are strictly decoupled into two streams. The "Mechanical" stream performs deterministic verification—such as APCA contrast checks (`apca.ts`), exact test passes (`task:check`), and DOM layout metrics. The "Cognitive" stream reads the diffs and provides Socratic feedback. The orchestration layer (`validator-engine.ts`) strictly guards tool access: Cognitive validators have `can_execute_shell: false`, forcing them to only rely on pre-gathered evidence. Mechanical validators run deterministic CLI tools without arbitrary shell access.

## LLM Friction Points & Implicit Assumptions
- **Context Detachment:** LLMs in the Cognitive role often attempt to guess what the code does if they cannot execute it. The zero-exploration rule requires exact prompt construction, but LLMs might hallucinate runtime behavior.
- **Evidence Formatting:** Outputting massive raw AST/DOM dumps can overwhelm the Cognitive validator's context window.

## Concrete Simplification & Improvement Blueprint
1. **Abstract Shell Interactions:** Replace mechanical verification scripts with native plugin hooks that directly query AST/Typescript Server, bypassing the need for string-matching CLI outputs.
2. **Narrow the Scope:** Ensure Cognitive Validators are only fed a highly-pruned "diff view" with inline diagnostic pointers instead of whole files.
3. **Hard-Lock Interlock Improvements:** Make the engine crash immediately at the AST level if a cognitive validator even attempts a hallucinated tool call.
