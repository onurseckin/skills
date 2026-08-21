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
import { chmodSync, cpSync } from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "./scratch-root.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const FIXTURES_ROOT = join(REPO_ROOT, "tests", "fixtures", "capsules");

/** `manifest.run_id` for every fixture below — also the required basename of the resolved path. */
export const LEGACY_PRE_LEDGER_RUN_ID = "legacy-pre-ledger";

/**
 * Returns the absolute path to a fresh, correctly-permissioned copy of the `legacy-pre-ledger`
 * capsule fixture. Pass `import.meta.path` from the calling test file, exactly as `scratchRoot`
 * requires, so two test files (or two calls in one file) never collide.
 */
export function legacyPreLedgerCapsule(callerPath: string): string {
  const source = join(FIXTURES_ROOT, LEGACY_PRE_LEDGER_RUN_ID);
  const parent = scratchRoot(callerPath, "legacy-pre-ledger-capsule");
  const runRoot = join(parent, LEGACY_PRE_LEDGER_RUN_ID);
  cpSync(source, runRoot, { recursive: true });
  chmodSync(join(runRoot, "prompt.md"), 0o444);
  return runRoot;
}
