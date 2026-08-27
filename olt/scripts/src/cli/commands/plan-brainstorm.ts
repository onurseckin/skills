import { lstatSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { canonicalJsonBytes, sha256Bytes } from "../../core/json.ts";
import { isJsonObject, type JsonObject } from "../../core/contracts/json.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { isInsideCapsule, resolveCapsulesDir } from "../../core/shared/paths.ts";
import { BrainstormEngine, type BrainstormResult } from "../../graph/brainstorm-engine.ts";
import { BRAINSTORMING_SCHEMA, BRAINSTORMING_VERSION, loadRun } from "../../engine/store/index.ts";
import { transactIdempotent } from "../../engine/store/transaction.ts";
import { integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import { parseArguments } from "../arguments.ts";

/**
 * A bare capsule NAME (no path separator) must resolve under the canonical
 * `.olt/capsules/` root, never against CWD. Resolution alone has no side
 * effects; execution verifies the resolved root as an existing capsule before
 * it can read a prompt, write an artifact, or append an event.
 */
export function resolveBrainstormRunRoot(runRoot: string, repoRoot?: string): string {
  if (
    !runRoot.trim() ||
    runRoot === "." ||
    runRoot === ".." ||
    runRoot.split(/[\\/]/).includes("..")
  ) {
    throw new HarnessError("PATH_SAFETY", `run '${runRoot}' is not a canonical capsule identity`);
  }
  if (isAbsolute(runRoot)) {
    return resolve(runRoot);
  }
  if (runRoot.includes(sep) || runRoot.includes("\\")) {
    throw new HarnessError(
      "PATH_SAFETY",
      `run '${runRoot}' must be a bare capsule ID or an absolute capsule path`,
    );
  }
  const resolved = resolve(resolveCapsulesDir(repoRoot), runRoot);
  if (!isInsideCapsule(resolved)) {
    throw new HarnessError(
      "PATH_SAFETY",
      `run '${runRoot}' does not resolve inside a capsule root`,
    );
  }
  return resolved;
}

export interface PlanBrainstormOptions {
  readonly run?: string | undefined;
  readonly runRoot?: string | undefined;
  readonly prompt?: string | undefined;
  readonly rounds?: number | undefined;
  readonly save?: boolean | undefined;
  readonly actor?: string | undefined;
}

export interface PlanBrainstormOutput {
  readonly success: true;
  readonly roundsExecuted: number;
  readonly totalExpandedItems: number;
  readonly result: BrainstormResult;
  readonly markdown: string;
  readonly run_root?: string | undefined;
  readonly brainstorming_path?: string | undefined;
}

function assertSafeCapsuleEntry(runRoot: string, name: string): void {
  const path = join(runRoot, name);
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
    throw new HarnessError("PATH_SAFETY", `capsule ${name} must be a single-link regular file`);
  }
}

function assertSafeCapsuleFiles(runRoot: string): void {
  const root = lstatSync(runRoot);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new HarnessError("PATH_SAFETY", `capsule root must be a real directory`);
  }
  for (const name of ["manifest.json", "state.json", "prompt.md", "events.jsonl"]) {
    assertSafeCapsuleEntry(runRoot, name);
  }
}

function promptFromBytes(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function loadVerifiedBrainstormRun(runRoot: string): ReturnType<typeof loadRun> {
  try {
    assertSafeCapsuleFiles(runRoot);
    const loaded = loadRun(runRoot);
    assertSafeCapsuleFiles(runRoot);
    return loaded;
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    throw new HarnessError(
      "INTEGRITY",
      `plan:brainstorm requires an existing verified capsule at ${runRoot}: ${String(error)}`,
    );
  }
}

function parseInputOptions(input: readonly string[] | Flags | PlanBrainstormOptions): {
  runRoot: string | undefined;
  prompt: string | undefined;
  rounds: number;
  save: boolean;
  actor: string;
} {
  if (Array.isArray(input)) {
    const tokens =
      input.length > 0 && !input[0]?.startsWith("-") ? input : ["plan:brainstorm", ...input];
    const parsed = parseArguments(tokens);
    const flags = parsed.flags;
    const run = textFlag(flags, "run", false) ?? textFlag(flags, "run-id", false);
    const prompt = textFlag(flags, "prompt", false);
    const rounds = integerFlag(flags, "rounds") ?? 3;
    const save = Object.hasOwn(flags, "save") ? flags["save"] !== "false" : true;
    const actor = textFlag(flags, "actor", false) ?? "planner";
    return { runRoot: run, prompt, rounds: Math.max(1, rounds), save, actor };
  }

  const raw = input as Record<string, unknown>;

  // Check if it's Flags object from execute CLI parser where string values are used
  const isFlagsObject =
    (Object.hasOwn(raw, "run") &&
      typeof raw["run"] === "string" &&
      !Object.hasOwn(raw, "runRoot")) ||
    (Object.hasOwn(raw, "run-id") && typeof raw["run-id"] === "string") ||
    (Object.hasOwn(raw, "rounds") && typeof raw["rounds"] === "string");

  if (isFlagsObject) {
    const flags = input as Flags;
    const runRoot =
      (Object.hasOwn(flags, "run") && typeof flags["run"] === "string"
        ? textFlag(flags, "run", false)
        : undefined) ??
      (Object.hasOwn(flags, "run-id") && typeof flags["run-id"] === "string"
        ? textFlag(flags, "run-id", false)
        : undefined);

    const prompt =
      Object.hasOwn(flags, "prompt") && typeof flags["prompt"] === "string"
        ? textFlag(flags, "prompt", false)
        : undefined;

    const roundsRaw =
      Object.hasOwn(flags, "rounds") && typeof flags["rounds"] === "string"
        ? integerFlag(flags, "rounds")
        : undefined;
    const rounds = roundsRaw ?? 3;

    const save = Object.hasOwn(flags, "save") ? flags["save"] !== "false" : true;
    const actor =
      Object.hasOwn(flags, "actor") && typeof flags["actor"] === "string"
        ? (textFlag(flags, "actor", false) ?? "planner")
        : "planner";

    return { runRoot, prompt, rounds: Math.max(1, rounds), save, actor };
  }

  // Treat as PlanBrainstormOptions (or generic options object)
  const options = input as PlanBrainstormOptions;
  const runRoot = options.runRoot ?? options.run;
  const prompt = options.prompt;
  const rounds = typeof options.rounds === "number" ? Math.max(1, options.rounds) : 3;
  const save = options.save ?? true;
  const actor = options.actor ?? "planner";
  return { runRoot, prompt, rounds, save, actor };
}

export function executePlanBrainstorm(
  input: readonly string[] | Flags | PlanBrainstormOptions,
  _context: CommandContext = {},
): PlanBrainstormOutput {
  const {
    runRoot: rawRunRoot,
    prompt: explicitPrompt,
    rounds,
    save,
    actor,
  } = parseInputOptions(input);
  const runRoot = rawRunRoot !== undefined ? resolveBrainstormRunRoot(rawRunRoot) : undefined;
  const loadedRun = runRoot === undefined ? undefined : loadVerifiedBrainstormRun(runRoot);

  let resolvedPrompt = explicitPrompt?.trim() ?? "";

  if (!resolvedPrompt && loadedRun) {
    resolvedPrompt = promptFromBytes(loadedRun.prompt).trim();
  }

  if (!resolvedPrompt && !runRoot) {
    throw new HarnessError("INVALID_ARGUMENT", "must provide --run or --prompt");
  }

  const result = BrainstormEngine.expandPromptToVectors(resolvedPrompt, rounds);
  const markdown = BrainstormEngine.formatBrainstormTable(result);

  let savedPath: string | undefined;
  if (save && runRoot) {
    savedPath = join(runRoot, "brainstorming.json");
    const requestBody: JsonObject = {
      schema: BRAINSTORMING_SCHEMA,
      version: BRAINSTORMING_VERSION,
      prompt: result.prompt,
      rounds: result.roundsExecuted,
      vectors: result.vectors.map((vector) => ({ ...vector })),
      total_expanded_items: result.totalExpandedItems,
    };
    const requestKey = sha256Bytes(canonicalJsonBytes(requestBody));
    const documentBody: JsonObject = {
      ...requestBody,
      request_key: requestKey,
      content_digest: requestKey,
      authority_actor: actor,
      projection_destinations: ["brainstorming.json"],
      created_at: result.createdAt,
    };
    const artifactSha256 = sha256Bytes(canonicalJsonBytes(documentBody));
    const document: JsonObject = { ...documentBody, artifact_sha256: artifactSha256 };
    transactIdempotent(
      runRoot,
      actor,
      "plan-brainstormed",
      {
        requestKey,
        contentDigest: requestKey,
        semanticVersion: BRAINSTORMING_VERSION,
        authorityActor: actor,
        destinations: ["brainstorming.json"],
      },
      {
        prompt_length: resolvedPrompt.length,
        rounds: result.roundsExecuted,
        total_expanded_items: result.totalExpandedItems,
        brainstorming_file: "brainstorming.json",
        request_key: requestKey,
        content_digest: requestKey,
        semantic_version: BRAINSTORMING_VERSION,
        authority_actor: actor,
        projection_destinations: ["brainstorming.json"],
        artifact_sha256: artifactSha256,
      },
      (state) => {
        const planning = isJsonObject(state.planning) ? state.planning : {};
        state.planning = {
          ...planning,
          brainstorming: document,
        };
      },
    );
  }

  return {
    success: true,
    roundsExecuted: result.roundsExecuted,
    totalExpandedItems: result.totalExpandedItems,
    result,
    markdown,
    ...(runRoot ? { run_root: runRoot } : {}),
    ...(savedPath ? { brainstorming_path: savedPath } : {}),
  };
}

export function planBrainstormCommand(
  flags: Flags,
  context: CommandContext = {},
): Record<string, unknown> {
  const output = executePlanBrainstorm(flags, context);
  return output as unknown as Record<string, unknown>;
}
