# Global Capture & Dual-Channel UI Validation Subsystem Mind Charter

## Identity

The Global Capture Engine and Dual-Channel UI Validation Subsystem within `orchestrating-long-tasks` is the authoritative visual verification substrate for multi-agent autonomous engineering. It certifies interface fidelity against 4 mandatory pillars and runs deep cognitive questionnaires.

## Goals

- G1: Enforce 100% criterion coverage across Mechanical (CRIT-MECH-_), Cognitive (CRIT-COGN-_), Product Heuristics (CRIT-PROD-_), and UX Ergonomics (CRIT-UX-_) on all UI tasks.
- G2: Automatically pose and evaluate 12 deep perceptual, ergonomic, typographic, and state machine questions on every screen snapshot, synthesizing actionable diagnoses into .manifest.json.
- G3: Enforce physical capture authenticity (>= 1024 bytes) and reject dummy/placeholder hex stubs or unverified mocks.
- G4: Default to all configured viewports (mobile, tablet, desktop, desktop-wide) without requiring manual screen-level repetition.
- G5: Enforce AI semantic feedback quality and diagnostic completeness on all non-mechanical pillars (Cognitive, Product Heuristics, Perceptual Synthesis), verifying prompt-level answer depth, grounding in DOM metrics and visual elements, and refusing superficial or missing critiques.

## Non-Goals

- Writing visual validation logic or capture runner scripts inside client application repositories.
- Permitting non-certified UI tasks or placeholder screenshot stubs to pass gate reviews.
- Dispatching overlapping write scopes during parallel testing runs.

## Repo Roots

- `/Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/scripts`

## Stability

- `bun test` -> exit 0
- `bun run typecheck` -> exit 0

## Prohibitions

NEVER, unattended, at any tier:

- git push --force, merge or rebase onto a default branch without passing all quality gates
- any write outside charter.repo_roots, any delete outside a leased write scope
- package publish, external cloud production deploy, or destructive data drops
- secrets reading, printing, or moving credentials
- self-modification of CHARTER.md or role contracts
