import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isJsonObject } from "../../core/contracts/json.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { BrainstormEngine, type BrainstormResult } from "../../graph/brainstorm-engine.ts";
import { loadRun } from "../../engine/store/index.ts";
import { transact } from "../../engine/store/transaction.ts";
import { integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import { parseArguments } from "../arguments.ts";

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

function promptFromBytes(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
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
  const { runRoot, prompt: explicitPrompt, rounds, save, actor } = parseInputOptions(input);

  let resolvedPrompt = explicitPrompt?.trim() ?? "";

  if (!resolvedPrompt && runRoot) {
    const promptMdPath = join(runRoot, "prompt.md");
    const promptTxtPath = join(runRoot, "prompt.txt");

    if (existsSync(promptMdPath)) {
      try {
        resolvedPrompt = readFileSync(promptMdPath, "utf-8").trim();
      } catch {
        // Fall back to other prompt sources
      }
    }

    if (!resolvedPrompt && existsSync(promptTxtPath)) {
      try {
        resolvedPrompt = readFileSync(promptTxtPath, "utf-8").trim();
      } catch {
        // Fall back to store
      }
    }

    if (!resolvedPrompt) {
      try {
        const loaded = loadRun(runRoot, false);
        resolvedPrompt = promptFromBytes(loaded.prompt).trim();
      } catch {
        // Run may not be a full capsule
      }
    }
  }

  if (!resolvedPrompt && !runRoot) {
    throw new HarnessError("INVALID_ARGUMENT", "must provide --run or --prompt");
  }

  const result = BrainstormEngine.expandPromptToVectors(resolvedPrompt, rounds);
  const markdown = BrainstormEngine.formatBrainstormTable(result);

  let savedPath: string | undefined;
  if (save && runRoot) {
    try {
      mkdirSync(runRoot, { recursive: true });
      savedPath = join(runRoot, "brainstorming.json");
      writeFileSync(savedPath, JSON.stringify(result, null, 2), "utf-8");
    } catch (err: unknown) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Failed to write brainstorming.json to ${runRoot}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let eventTransacted = false;
    try {
      transact(
        runRoot,
        actor,
        "plan-brainstormed",
        {
          prompt_length: resolvedPrompt.length,
          rounds: result.roundsExecuted,
          total_expanded_items: result.totalExpandedItems,
          brainstorming_file: "brainstorming.json",
        },
        (state) => {
          const planning = isJsonObject(state.planning) ? state.planning : {};
          state.planning = {
            ...planning,
            brainstorming: {
              rounds: result.roundsExecuted,
              total_expanded_items: result.totalExpandedItems,
              created_at: result.createdAt,
            },
          };
        },
      );
      eventTransacted = true;
    } catch {
      // If transact fails (e.g. temp dir without manifest.json / state.json), fallback to direct events.jsonl append
    }

    if (!eventTransacted) {
      const eventsPath = join(runRoot, "events.jsonl");
      try {
        const eventRecord = {
          kind: "plan-brainstormed",
          actor,
          timestamp: new Date().toISOString(),
          payload: {
            prompt_length: resolvedPrompt.length,
            rounds: result.roundsExecuted,
            total_expanded_items: result.totalExpandedItems,
            brainstorming_file: "brainstorming.json",
          },
        };
        appendFileSync(eventsPath, JSON.stringify(eventRecord) + "\n", "utf-8");
      } catch {
        // Event append is best-effort for mock directories
      }
    }
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
