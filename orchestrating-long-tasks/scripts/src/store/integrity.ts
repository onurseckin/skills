import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename } from "node:path";
import type { IntegrityIssue, RunState } from "../contracts/capsule.ts";
import { readCanonicalObject } from "../core/json.ts";
import { validateEventChain } from "./event-stream.ts";
import { issue } from "./issues.ts";
import { checkManifest } from "./manifest.ts";
import { runFilePath } from "./paths.ts";
import { sameJson } from "./state.ts";
import { type StoreLimits, limits } from "./constants.ts";

export function verifyIntegrity(runRoot: string, options: StoreLimits = {}): IntegrityIssue[] {
  if (
    !existsSync(runRoot) ||
    !lstatSync(runRoot).isDirectory() ||
    lstatSync(runRoot).isSymbolicLink()
  ) {
    return [issue("RUN_ROOT", `run root is not a real directory: ${runRoot}`)];
  }
  const root = realpathSync(runRoot);
  const configured = limits(options);
  const manifestCheck = checkManifest(root, options);
  const found = [...manifestCheck.issues];
  let chain;
  try {
    chain = validateEventChain(
      runFilePath(root, "events.jsonl"),
      {
        runId: manifestCheck.manifest?.run_id ?? basename(root),
        capsuleId: manifestCheck.manifest?.capsule_id ?? "",
      },
      options,
      true,
      false,
    );
    found.push(...chain.issues);
  } catch (error) {
    found.push(issue("EVENT_PATH", `events.jsonl is unsafe: ${String(error)}`));
  }
  try {
    const state = readCanonicalObject(runFilePath(root, "state.json"), "state.json", {
      maxBytes: configured.maxJsonBytes,
      maxDepth: configured.maxDepth,
    }) as unknown as RunState;
    if (chain !== undefined && !sameJson(state, chain.finalState)) {
      found.push(
        issue("STATE_PROJECTION", "state.json does not equal the final event projection and head"),
      );
    }
  } catch (error) {
    found.push(issue("STATE_JSON", `state.json is not readable canonical JSON: ${String(error)}`));
  }
  return found;
}
