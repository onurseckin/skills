import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import type { RunState } from "../contracts/capsule.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { withRunLock } from "../platform/run-lock.ts";
import { validateEventChain } from "./event-stream.ts";
import { appendProjectionEvent } from "./event-append.ts";
import { quarantineAndTruncateTail } from "./forensic-tail.ts";
import { throwIntegrity } from "./issues.ts";
import { checkManifest } from "./manifest.ts";
import { runFilePath } from "./paths.ts";
import { cloneObject } from "./state.ts";
import { limits } from "./constants.ts";

/** A torn tail is unique evidence of a corruption, so it gets a home of its own rather than a
 * corner of the evidence view, which holds no facts. */
function quarantineDirectory(runRoot: string): string {
  const path = runFilePath(runRoot, "quarantine");
  mkdirSync(path, { recursive: true, mode: 0o755 });
  return path;
}

function assertRecoverableStatePath(runRoot: string): void {
  const path = runFilePath(runRoot, "state.json");
  try {
    if (!lstatSync(path).isFile())
      throw new HarnessError("INTEGRITY", "state.json is not a regular file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function recoverProjection(runRoot: string, actor: string): RunState {
  if (typeof actor !== "string" || !actor.trim())
    throw new HarnessError("INVALID_ARGUMENT", "actor must be a non-blank string");
  const metadata = lstatSync(runRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new HarnessError("INVALID_ARGUMENT", `run_root must be a real directory: ${runRoot}`);
  const root = realpathSync(runRoot);
  return withRunLock(root, () => {
    const immutable = checkManifest(root);
    if (immutable.issues.length > 0 || !immutable.manifest) throwIntegrity(immutable.issues);
    assertRecoverableStatePath(root);
    const eventsPath = runFilePath(root, "events.jsonl");
    const chain = validateEventChain(
      eventsPath,
      { runId: immutable.manifest.run_id, capsuleId: immutable.manifest.capsule_id },
      {},
      false,
      false,
    );
    if (chain.issues.length > 0) throwIntegrity(chain.issues);
    if (chain.eventCount === 0)
      throw new HarnessError("INTEGRITY", "cannot recover state because there is no valid event");
    const quarantined = chain.tornTail !== undefined;
    if (quarantined) {
      quarantineAndTruncateTail(eventsPath, chain.completeBytes, quarantineDirectory(root));
    }
    return appendProjectionEvent(
      root,
      immutable.manifest,
      chain.finalState,
      actor,
      "projection-recovered",
      { recovered_sequence: chain.eventCount, quarantined_torn_tail: quarantined },
      cloneObject(chain.finalState),
      limits(),
    );
  });
}
