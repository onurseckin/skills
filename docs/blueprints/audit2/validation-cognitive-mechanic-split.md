# Validation Engine & Capture Dynamics

## 1. What Calls What? (Validation Engine Dispatch)
The `ValidatorEngine` acts as the primary dispatch layer for all validation checks within the `olt/scripts/src/validation/` and `olt/scripts/src/capture/` domains.
When executing a run, it partitions subagents into two distinct categories based on their behavioral roles: Cognitive Validators and Mechanic Validators.
The internal dispatcher evaluates rules from the configured validation domains (e.g. `apca.ts` for accessibility, `apple-optical-tracking.ts` for custom typography design systems, and `dom-physics-extractor.ts` for DOM extraction).

## 2. Cognitive vs Mechanic Validator Hard-Lock
The codebase enforces a **Hard-Lock Interlock** between cognitive and mechanic validators:
- In `validator-engine.ts`, the assignment of terminal capabilities is dynamically dictated by the boolean evaluation:
  ```typescript
  can_execute_shell: !isCognitive
  ```
- **Cognitive Validators:** Bound explicitly to `can_execute_shell: false`. This locks out their ability to run unit tests, raw terminal commands, or interact with build systems. They are forced to dedicate 100% of their bandwidth to Socratic design reviews, UI critique, and adversarial probe reading.
- **Mechanic Validators:** Retain test execution authority, fast incremental typechecks (`tsc --noEmit`), and CLI interaction capabilities.

## 3. Native Host Tool Interaction
- **DOM Physics Extraction:** The `dom-physics-extractor.ts` creates robust offline DOM snapshots natively inside a headless browser via `driver.evaluate`. It captures precise dimensions (`clientHeight`, `scrollHeight`) and CSS layout overlaps without raw manual interaction.
- **APCA Contrast (`apca.ts`):** Parses raw `rgba()` and hexadecimal string variants to deterministically compute visual lightness and calculate APCA compliance indices. No visual OCR is employed; it directly operates on the DOM style tree metric objects (`ElementPhysicsSnapshot`).
- **Optical Tracking (`apple-optical-tracking.ts`):** Statically checks the `fontSize` and `letterSpacing` styles dynamically generated during the DOM extract to verify strict adherence to the Apple HIG (Human Interface Guidelines).

## 4. Current Live Code Verification Assessment
- **Finding Count:** 4 unconstrained core findings.
- **Evidence Sealing Trace:** Strong integration between `ElementPhysicsSnapshot` (from `dom-physics-extractor`) directly mapping to output defect representations.
- **Cognitive/Mechanic Boundary Analysis:** Validated. The codebase accurately reflects the hard-lock interlock required by the system directives, denying terminal execution from semantic cognitive reviewers and cleanly isolating purely mathematical checks (like `apple-optical-tracking` and `apca`) into non-agentic structural processes.
