import { existsSync } from "node:fs";
import { join } from "node:path";
import { readBoundedBytes } from "../../core/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { loadRun } from "../../store/index.ts";
import { formatOrchestrateBrief } from "../formatters/index.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";
import { firstAvailableRunId, deriveRunId } from "./orchestrate-slug.ts";
import { planInitCommand } from "./plan.ts";

function promptText(prompt: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(prompt);
}

/**
 * B16's single free-text entry point. It captures the user's whole message byte for byte and opens
 * the capsule — the only two steps that need no repository judgment — then hands back the fixed
 * checklist for everything after. It cannot run `plan:enhance` itself: reading the repository and
 * deciding what the run is actually about is the calling agent's job, not something the harness may
 * fabricate on its behalf (the harness never calls a model — see SKILL.md's hard rules).
 */
export async function orchestrateCommand(
  flags: Flags,
  context: CommandContext = {},
): Promise<Record<string, unknown>> {
  const fromFile = textFlag(flags, "prompt-file", false);
  const prompt =
    fromFile === undefined ? context.stdin : readBoundedBytes(fromFile, 64 * 1024 * 1024);
  if (prompt === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "the prompt is unavailable: pipe the user's entire message to stdin, or pass --prompt-file",
    );
  }

  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const explicitRunId = textFlag(flags, "run", false) ?? textFlag(flags, "run-id", false);
  const runIdWasDerived = explicitRunId === undefined;
  const runId = runIdWasDerived
    ? firstAvailableRunId(deriveRunId(promptText(prompt)), (candidate) =>
        existsSync(join(repo, ".capsules", candidate)),
      )
    : explicitRunId;

  // plan:init owns capture; forwarding its own prompt-file/run flags back through it would either
  // re-read the file a second time or fight the run id just resolved above, so those four are
  // dropped and the already-resolved bytes travel through context.stdin instead.
  const {
    "prompt-file": _promptFile,
    "prompt-stdin": _promptStdin,
    run: _run,
    "run-id": _runId,
    ...passthrough
  } = flags;
  const initResult = await planInitCommand(
    { ...passthrough, run: runId },
    { ...context, stdin: prompt },
  );
  const runRoot = String(initResult.run_root);
  const manifest = loadRun(runRoot).manifest;

  const markdown = formatOrchestrateBrief({
    runId,
    runRoot,
    promptSha256: manifest.prompt_sha256,
    promptBytes: manifest.prompt_bytes,
    runIdWasDerived,
  });

  return {
    markdown,
    run_root: runRoot,
    run_id: runId,
    run_id_derived: runIdWasDerived,
    manifest,
  };
}
