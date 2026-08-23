import { existsSync, lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { Manifest, RunFiles, RunState } from "../contracts/capsule.ts";
import { readCanonicalObject } from "../core/json.ts";
import { readRegularFileNoFollow } from "../core/no-follow.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { type StoreLimits, limits } from "./constants.ts";
import { validateEventChain } from "./event-stream.ts";
import { throwIntegrity } from "./issues.ts";
import { runFilePath } from "./paths.ts";
import { verifyIntegrity } from "./integrity.ts";
import { resolveCapsulesDir } from "../shared/paths.ts";

function loadRunFiles(
  runRoot: string,
  verify: boolean,
  options: StoreLimits,
  collectEvents: boolean,
): RunFiles {
  let targetPath = runRoot;
  if (!existsSync(targetPath)) {
    const candidate = join(resolveCapsulesDir(), runRoot);
    if (existsSync(candidate)) {
      targetPath = candidate;
    }
  }
  const rootStat = lstatSync(targetPath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new HarnessError("INVALID_ARGUMENT", `run_root must be a real directory: ${runRoot}`);
  const root = realpathSync(targetPath);
  if (verify) {
    const found = verifyIntegrity(root, options);
    if (found.length > 0) throwIntegrity(found);
  }
  const configured = limits(options);
  const manifestPath = runFilePath(root, "manifest.json");
  const promptPath = runFilePath(root, "prompt.md");
  const statePath = runFilePath(root, "state.json");
  const eventsPath = runFilePath(root, "events.jsonl");
  const manifest = readCanonicalObject(manifestPath, "manifest.json", {
    maxBytes: configured.maxJsonBytes,
    maxDepth: configured.maxDepth,
  }) as unknown as Manifest;
  const state = readCanonicalObject(statePath, "state.json", {
    maxBytes: configured.maxJsonBytes,
    maxDepth: configured.maxDepth,
  }) as unknown as RunState;
  const promptStat = lstatSync(promptPath);
  if (!promptStat.isFile() || promptStat.isSymbolicLink())
    throw new HarnessError("INTEGRITY", "prompt.md is not a regular file");
  const prompt = readRegularFileNoFollow(promptPath);
  let events = [] as RunFiles["events"];
  if (collectEvents) {
    const chain = validateEventChain(
      eventsPath,
      { runId: manifest.run_id, capsuleId: manifest.capsule_id },
      options,
      verify,
    );
    if (verify && chain.issues.length > 0) throwIntegrity(chain.issues);
    events = chain.events;
  }
  return { runRoot: root, manifest, prompt, state, events };
}

export function loadRun(runRoot: string, verify = true, options: StoreLimits = {}): RunFiles {
  return loadRunFiles(runRoot, verify, options, true);
}

export function loadRunProjection(runRoot: string, options: StoreLimits = {}): RunFiles {
  return loadRunFiles(runRoot, true, options, false);
}
