import { parseTimestamp } from "../../../authority/watchdog/index.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { dispatchSupervisoryHealthProbe } from "../../../engine/scheduler/index.ts";
import { loadRun } from "../../../engine/store/index.ts";
import { runDoctor } from "../../../reporting/doctor/index.ts";
import { enforceLineLimit } from "../../formatters/index.ts";
import { assertFlags, boolFlag, textFlag, type CommandContext, type Flags } from "../../index.ts";

export function boundedEvidenceCause(error: unknown): string {
  if (typeof error === "string") return error.slice(0, 240);
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint" ||
    typeof error === "symbol" ||
    error === null ||
    error === undefined
  ) {
    return String(error).slice(0, 240);
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    if (descriptor && "value" in descriptor && typeof descriptor.value === "string") {
      return descriptor.value.slice(0, 240);
    }
  } catch {}
  return "unknown error";
}

export async function watchdogProbeCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const allowedFlags = ["run", "capsules-dir", "generation", "pulse-id", "now", "all", "json"];
  assertFlags(flags, allowedFlags);

  const run = textFlag(flags, "run", false);
  const capsulesDir = textFlag(flags, "capsules-dir", false);
  const isAll = boolFlag(flags, "all");
  const nowRaw = textFlag(flags, "now", false);

  const nowMs = parseTimestamp(nowRaw);

  let state: Record<string, unknown> = {};
  let doctorResult: Record<string, unknown> | undefined = undefined;

  if (run !== undefined) {
    try {
      const loaded = loadRun(run);
      state = loaded.state as Record<string, unknown>;
      doctorResult = await runDoctor(run);
    } catch (error) {
      throw new HarnessError(
        "INTEGRITY",
        `watchdog probe cannot load supervisory evidence for ${run}: ${boundedEvidenceCause(error)}`,
      );
    }
  }

  const dispatchResult = dispatchSupervisoryHealthProbe(state, {
    runRoot: run,
    now: nowMs,
    doctorResult,
  });

  const maxLines = isAll ? 500 : 40;
  const markdown = enforceLineLimit(dispatchResult.markdown, maxLines);

  return {
    markdown,
    dispatched: dispatchResult.dispatched,
    target_agent_id: dispatchResult.targetAgentId,
    target_role: dispatchResult.targetRole,
    report: dispatchResult.report,
    prompt_for_leader: dispatchResult.promptForLeader,
    doctor: doctorResult ?? null,
    run_root: run ?? null,
    capsules_dir: capsulesDir ?? null,
  };
}
