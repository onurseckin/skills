# CLI Execution Engine Audit Report

**Scope:** `olt/scripts/src/cli/execute.ts`, `olt/scripts/src/cli/arguments.ts`, `olt/scripts/src/cli/output-format.ts`, and `harness.ts` (entrypoint integration).

## 1. Call Graph & CLI Routing Mechanics

The CLI request lifecycle follows a strict sequence to parse inputs, enforce authorization, validate state invariants, and dispatch commands:

```mermaid
flowchart TD
    A[harness.ts main()] --> B[output-format.ts: stripOutputFormat]
    B --> C[help.ts: helpRequest]
    C --> D[prompt-input.ts: extractOrchestrateInlinePrompt]
    D --> E[execute.ts: execute()]
    
    subgraph execute.ts lifecycle
        E --> F[resolveCommandSpec]
        F --> G[arguments.ts: parseArguments]
        G --> H[autoDeriveCallerIdentity]
        H --> I[assertFlags]
        I --> J[assertGrantedCommand]
        J --> K[CumulativePhaseInvariantEngine.verify]
        K --> L[spec.handler]
    end
    
    L --> M((Command Result))
    M --> N{format.json?}
    N -- No --> O[Stdout: print result.markdown]
    N -- Yes --> P[Stdout: print JSON]
```

### Flag Routing Mechanics (`arguments.ts`)
1. **Positional Splitting**: The first positional argument is strictly interpreted as the command name. Further parsing splits bounded flags up to a bare `--`, storing anything afterward into the `remainder` array.
2. **Dynamic Flag Typing**: Using the `FlagShapes` map provided by the resolved command spec, `parseArguments` dynamically decides if a flag expects a subsequent value or if it is a boolean flag. Some flags like `--run`, `--repo`, `--task`, and `--actor` are statically known as `ALWAYS_VALUED`.
3. **Fuzzy Suggestions**: Unrecognized flags trigger `suggestFlag()`, computing Levenshtein distance `O(N*M)` to suggest near matches, guiding developers and agents with syntax corrections.

---

## 2. Zero-JSON CLI Surface Compliance Assessment

**Rule Definition:** *Agents interact with the harness exclusively through clean colon commands. Commands return concise, structured markdown briefs ($\le 30$ lines) designed for token efficiency and high signal.*

**Assessment:** **Highly Compliant, with one edge case violation.**

- **Execution Output Isolation:** `execute.ts` flawlessly intercepts internal command errors (both known `HarnessError` and fatal errors), catching and wrapping them into `markdown` string envelopes (e.g., `**Error (CODE)**: ...`).
- **Standard Routing:** The outer `harness.ts` actively checks if `--format=json` was stripped by `output-format.ts`. If not, it exclusively prints `result.markdown`, fulfilling the Zero-JSON interface contract for agents interacting via `harness.ts shell`.
- **Edge Case Breach (Pre-Execute Bubbling):** If an error occurs *before* `execute()` is called (e.g., inside `stdinBytes()` size limits or prompt extraction logic), the error bubbles to the `import.meta.main` catch block in `harness.ts`, which bypasses the markdown envelope and forcibly prints `{"ok": false, "error": { ... }}` as JSON.

---

## 3. Current Live Code Verification & Assessment

### Exact Unconstrained Finding Count: 4

#### Finding 1: Hardcoded Command Spec Decoupling (`execute.ts`)
- **Location:** `resolveCommandSpec`
- **Issue:** `plan:brainstorm` is hardcoded as `PLAN_BRAINSTORM_SPEC` directly in `execute.ts` rather than being loaded via the dynamic `registry/index.ts`. This breaks the centralized dynamic registry pattern utilized by all other commands, leaking command metadata into the orchestrator.
- **Severity:** Medium (Architectural Smell)

#### Finding 2: Pre-Execute JSON Error Bleed (`harness.ts` / `execute.ts` Interface)
- **Location:** `import.meta.main` catch block in `harness.ts`.
- **Issue:** Mentioned in the Zero-JSON compliance assessment, unexpected parse failures before `execute.ts` takes over will violate the Zero-JSON rule. 
- **Severity:** Low (Edge Case)
- **Fix:** Move the `HarnessError` to Markdown formatting logic up into the `harness.ts` catch block to act as an absolute shield against raw JSON printing.

#### Finding 3: Ambiguous `critic` State Machine Invariant (`execute.ts`)
- **Location:** `DeductiveStateMachine.isPhaseVerified("critic")`
- **Issue:** The state machine allows passage if `this.state.completion_critic.status === "reviewed"`. In `CumulativePhaseInvariantEngine`, `critic` is checked as a prerequisite for `run:complete`. If properties rename or if `completion_critic` structurally diverges, it could result in phantom blockages.
- **Severity:** Low (Brittleness)

#### Finding 4: Suboptimal Output Format Parsing (`output-format.ts`)
- **Location:** `stripOutputFormat()`
- **Issue:** The parsing loop does bounded peeks (`argv[index + 1] === "json"`) but does not aggressively consume the value when filtering out the original token in `filtered`. It uses fragile indexing arithmetic `argv[index - 1] !== "--format"` which is technically susceptible to edge cases if a user sends `--format --format json`. 
- **Severity:** Low (Logic Fragility)

---

## 4. Optimization & Health Overview

The engine is remarkably healthy and strictly adheres to the architecture specified by the repository rules. 
- The **Levenshtein fuzzy matching** algorithm in `arguments.ts` is resilient, protecting agents from failing over trivial typos (a crucial resilience mechanism for Agent-CLI interaction).
- **CumulativePhaseInvariantEngine** acts as a robust fail-safe preventing commands from executing out of sequence, perfectly tracking the canonical DAG phases (`plan` -> `queue` -> `task` -> `critic` -> `run`).
- Argument parsing properly enforces **Disjoint Validation Boundaries** (preventing arbitrary flags from bleeding into command handlers unchecked).
