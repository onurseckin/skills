import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename } from "node:path";
import type { HarnessEvent, IntegrityIssue, RunState } from "../../contracts/capsule.ts";
import type { JsonObject } from "../../contracts/json.ts";
import { readCanonicalObject } from "../../core/json.ts";
import { validateEventChain } from "./event-stream.ts";
import { issue } from "./issues.ts";
import { verifyCapsuleLayout } from "./layout-integrity.ts";
import { checkManifest } from "./manifest.ts";
import { runFilePath } from "./paths.ts";
import { applyProjectionPatch } from "./projection-patch.ts";
import { businessFields, initialState, sameJson } from "./state.ts";
import { type StoreLimits, limits } from "./constants.ts";

function isHistoricalProjection(events: readonly HarnessEvent[], target: RunState): boolean {
  let business: JsonObject = {};
  let current: RunState = initialState();
  if (sameJson(current, target)) {
    return true;
  }
  for (const event of events) {
    business =
      event.projection !== null && event.projection !== undefined
        ? businessFields(event.projection)
        : applyProjectionPatch(business, event.projection_patch ?? []);
    current = {
      ...initialState(),
      ...business,
      revision: event.revision,
      event_sequence: event.sequence,
      event_head: event.hash,
    };
    if (sameJson(current, target)) {
      return true;
    }
  }
  return false;
}

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
  const found = [...manifestCheck.issues, ...verifyCapsuleLayout(root)];
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
      true,
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
      const isRace = chain.issues.length === 0 && isHistoricalProjection(chain.events, state);
      found.push(
        issue(
          "STATE_PROJECTION",
          "state.json does not equal the final event projection and head",
          undefined,
          isRace ? "READ_RACE" : undefined,
        ),
      );
    }
  } catch (error) {
    found.push(issue("STATE_JSON", `state.json is not readable canonical JSON: ${String(error)}`));
  }
  return found;
}
