import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunState } from "../../../core/contracts/index.ts";
import type { JsonObject } from "../../../core/contracts/index.ts";
import { atomicWriteJson } from "../../../core/durable-write.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../../core/json.ts";
import { HarnessError } from "../../../core/errors/index.ts";

export const BRAINSTORMING_SCHEMA = "harness.brainstorming";
export const BRAINSTORMING_VERSION = 1;
export const BRAINSTORMING_PATH = "brainstorming.json";

export interface MaterializedProjection {
  readonly path: string;
  readonly sha256: string;
  readonly document: JsonObject;
}

function object(value: unknown, name: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HarnessError("INTEGRITY", `${name} must be an object`);
  }
  return value as JsonObject;
}

function safeTarget(path: string): void {
  if (!existsSync(path)) return;
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new HarnessError(
      "PATH_SAFETY",
      `${BRAINSTORMING_PATH} must be a single-link regular file`,
    );
  }
}

function safeRoot(runRoot: string): void {
  const metadata = lstatSync(runRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new HarnessError("PATH_SAFETY", "projection parent must be a real directory");
}

export function brainstormingProjection(state: RunState): MaterializedProjection | undefined {
  const planning = state.planning;
  if (typeof planning !== "object" || planning === null || Array.isArray(planning))
    return undefined;
  const value = (planning as JsonObject)["brainstorming"];
  if (value === undefined) return undefined;
  const document = object(value, "planning.brainstorming");
  if (
    document["schema"] !== BRAINSTORMING_SCHEMA ||
    document["version"] !== BRAINSTORMING_VERSION ||
    typeof document["artifact_sha256"] !== "string"
  ) {
    throw new HarnessError(
      "INTEGRITY",
      "planning.brainstorming is not a canonical brainstorming document",
    );
  }
  const { artifact_sha256: expected, ...body } = document;
  const actual = sha256Bytes(canonicalJsonBytes(body));
  if (expected !== actual) {
    throw new HarnessError(
      "INTEGRITY",
      "planning.brainstorming artifact_sha256 does not match content",
    );
  }
  return { path: BRAINSTORMING_PATH, sha256: actual, document };
}

export function materializedProjections(state: RunState): readonly MaterializedProjection[] {
  const brainstorming = brainstormingProjection(state);
  return brainstorming === undefined ? [] : [brainstorming];
}

export function materializeProjections(runRoot: string, state: RunState): void {
  // The event-chain state is the only source of truth.  Never inspect an existing
  // derived file to decide what to write; only use it as a link-safety guard.
  safeRoot(runRoot);
  for (const projection of materializedProjections(state)) {
    const path = join(runRoot, projection.path);
    safeTarget(path);
    atomicWriteJson(path, projection.document);
    safeRoot(runRoot);
    safeTarget(path);
    const written = readFileSync(path);
    if (sha256Bytes(written) !== sha256Bytes(canonicalJsonBytes(projection.document)))
      throw new HarnessError(
        "INTEGRITY",
        `${projection.path} did not durably match canonical state`,
      );
  }
}

export function materializedProjectionDigests(state: RunState): readonly JsonObject[] {
  return materializedProjections(state).map((projection) => ({
    path: projection.path,
    sha256: projection.sha256,
  }));
}
