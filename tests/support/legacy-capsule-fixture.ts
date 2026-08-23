/**
 * Resolves a checked-in, pre-ledger capsule fixture for tests that need to load a real capsule
 * predating the agent ledger, the branch ledger, recorded topology, and the planning directory —
 * without hardcoding a path into the repo's own `.capsules/` (gitignored, and empty on a fresh
 * clone; see tests/support/README.md's rationale for why fixtures can never point there).
 *
 * `tests/fixtures/capsules/legacy-pre-ledger/` holds the four files `loadRun` actually requires
 * (`manifest.json`, `prompt.md`, `events.jsonl`, `state.json` — the rest of the capsule layout,
 * e.g. `commands/`, `blobs/`, is optional and was left out to keep the fixture minimal). Its shape
 * was produced once by the real `initRun` + `transact`, then frozen byte for byte: one
 * `plan-applied` event compiles a three-task graph (`t-alpha`, `t-beta`, `t-gamma`) and nothing
 * else, so `state.agents`, `state.branches`, `state.topology`, and `state.planning` are all
 * genuinely absent — not stubbed — while `state.tasks` is genuinely populated. The manifest omits
 * `bun_compatibility` (the real reference capsule's own manifest predates that field too), so the
 * fixture never expires when CI's bun major version moves on.
 *
 * Git does not preserve `prompt.md`'s read-only mode (it only tracks the executable bit), so a
 * fresh checkout hands back a writable file — which fails `loadRun`'s default integrity
 * verification (`PROMPT_MODE`). Rather than chmod the tracked file in place (a mutation every test
 * file sharing the fixture would observe), this copies the fixture into its own `scratchRoot()`
 * directory per call and fixes the mode there, leaving the checked-in bytes untouched.
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "./scratch-root.ts";

/** `manifest.run_id` for every fixture below — also the required basename of the resolved path. */
export const LEGACY_PRE_LEDGER_RUN_ID = "legacy-pre-ledger";

const LEGACY_MANIFEST = JSON.stringify({
  assurance: "source-verified",
  bun_version: "1.3.14",
  capsule_id: "d89c7cf091e9427eb13727dc77761f12",
  capture_mode: "file",
  created_at: "2026-08-21T09:41:09.989Z",
  prompt_bytes: 71,
  prompt_sha256: "260818da2f428aee3a658f7ed4e30c01b2ceb79a657be28de474914674a9af58",
  run_id: "legacy-pre-ledger",
  runtime_version: "0.2.0",
  schema: "harness.manifest",
  source_verified: true,
  version: 1,
});

const LEGACY_PROMPT = "Add a slugify helper to the CLI so run ids collapse punctuation safely.";

const LEGACY_STATE = JSON.stringify({
  event_head: "1c98a776539a12c2e4f62493e2c64cb0ff1012a93ab0a3df0306e2dd23d0e8c0",
  event_sequence: 1,
  graph: {
    edges: [{ source: "t-gamma", target: "t-alpha", type: "depends_on" }],
    gates: [
      {
        command: ["bun", "test"],
        cwd: ".",
        id: "gate-one",
        mandatory: true,
        requirement_ids: ["R-001"],
        scope: "task",
      },
    ],
    nodes: [
      { id: "requirement-1", label: "R-001", requirement_id: "R-001", type: "requirement" },
      { id: "artifact-all", label: "All output", type: "artifact" },
      {
        artifact_ids: ["artifact-all"],
        created_order: 1,
        dependencies: [],
        effort: 1,
        id: "t-alpha",
        label: "Label t-alpha",
        priority: 1,
        requirement_ids: ["R-001"],
        resource_scope: [],
        status: "ready",
        type: "task",
        write_scope: ["src/alpha"],
      },
      {
        artifact_ids: ["artifact-all"],
        created_order: 2,
        dependencies: [],
        effort: 1,
        id: "t-beta",
        label: "Label t-beta",
        priority: 1,
        requirement_ids: ["R-001"],
        resource_scope: [],
        status: "ready",
        type: "task",
        write_scope: ["src/beta"],
      },
      {
        artifact_ids: ["artifact-all"],
        created_order: 3,
        dependencies: ["t-alpha"],
        effort: 1,
        id: "t-gamma",
        label: "Label t-gamma",
        priority: 1,
        requirement_ids: ["R-001"],
        resource_scope: [],
        status: "ready",
        type: "task",
        write_scope: ["src/gamma"],
      },
    ],
    revision: 1,
    schema: "harness.graph",
    version: 1,
  },
  requirements: {
    dispositions: [],
    prompt_sha256: "260818da2f428aee3a658f7ed4e30c01b2ceb79a657be28de474914674a9af58",
    requirements: [{ dependencies: [], disposition: "actionable", id: "R-001" }],
    schema: "harness.requirements",
    version: 1,
  },
  revision: 1,
  schema: "harness.state",
  tasks: {
    "t-alpha": {
      artifact_ids: ["artifact-all"],
      created_order: 1,
      dependencies: [],
      effort: 1,
      id: "t-alpha",
      label: "Label t-alpha",
      priority: 1,
      requirement_ids: ["R-001"],
      resource_scope: [],
      status: "ready",
      type: "task",
      write_scope: ["src/alpha"],
    },
    "t-beta": {
      artifact_ids: ["artifact-all"],
      created_order: 2,
      dependencies: [],
      effort: 1,
      id: "t-beta",
      label: "Label t-beta",
      priority: 1,
      requirement_ids: ["R-001"],
      resource_scope: [],
      status: "ready",
      type: "task",
      write_scope: ["src/beta"],
    },
    "t-gamma": {
      artifact_ids: ["artifact-all"],
      created_order: 3,
      dependencies: ["t-alpha"],
      effort: 1,
      id: "t-gamma",
      label: "Label t-gamma",
      priority: 1,
      requirement_ids: ["R-001"],
      resource_scope: [],
      status: "ready",
      type: "task",
      write_scope: ["src/gamma"],
    },
  },
  version: 1,
});

const LEGACY_EVENTS =
  JSON.stringify({
    actor: "planner",
    capsule_id: "d89c7cf091e9427eb13727dc77761f12",
    hash: "1c98a776539a12c2e4f62493e2c64cb0ff1012a93ab0a3df0306e2dd23d0e8c0",
    kind: "plan-applied",
    payload: {},
    previous_hash: null,
    projection: null,
    projection_patch: [
      { op: "set", path: ["graph"], value: JSON.parse(LEGACY_STATE).graph },
      { op: "set", path: ["requirements"], value: JSON.parse(LEGACY_STATE).requirements },
      { op: "set", path: ["tasks"], value: JSON.parse(LEGACY_STATE).tasks },
    ],
    revision: 1,
    run_id: "legacy-pre-ledger",
    schema: "harness.event",
    sequence: 1,
    timestamp: "2026-08-21T09:41:09.997Z",
    version: 1,
  }) + "\n";

/**
 * Returns the absolute path to a fresh, correctly-permissioned copy of the `legacy-pre-ledger`
 * capsule fixture. Pass `import.meta.path` from the calling test file, exactly as `scratchRoot`
 * requires, so two test files (or two calls in one file) never collide.
 */
export function legacyPreLedgerCapsule(callerPath: string): string {
  const parent = scratchRoot(callerPath, "legacy-pre-ledger-capsule");
  const runRoot = join(parent, LEGACY_PRE_LEDGER_RUN_ID);
  mkdirSync(runRoot, { recursive: true });
  writeFileSync(join(runRoot, "manifest.json"), LEGACY_MANIFEST);
  writeFileSync(join(runRoot, "prompt.md"), LEGACY_PROMPT);
  chmodSync(join(runRoot, "prompt.md"), 0o444);
  writeFileSync(join(runRoot, "state.json"), LEGACY_STATE);
  writeFileSync(join(runRoot, "events.jsonl"), LEGACY_EVENTS);
  return runRoot;
}
