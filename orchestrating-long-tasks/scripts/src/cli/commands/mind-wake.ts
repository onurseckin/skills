import { HarnessError } from "../../errors/harness-error.ts";
import { buildWakeBrief } from "../../mind/brief.ts";
import { reclaimDeadPulse } from "../../mind/pulse-reclaim.ts";
import { renderHandoff } from "../../reporting/handoff.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";

export async function mindWakeCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const actor = textFlag(flags, "actor", false);
  const depth = textFlag(flags, "depth", false) ?? "brief";
  const targetRun = textFlag(flags, "target-run", false);
  const host = textFlag(flags, "host", false);
  const driver = textFlag(flags, "driver", false);
  const now = textFlag(flags, "now", false);

  if (depth !== "brief" && depth !== "run") {
    throw new HarnessError("INVALID_ARGUMENT", `--depth must be brief or run; got ${depth}`);
  }

  if (depth === "run") {
    const target = targetRun ?? run;
    const markdown = renderHandoff(target);
    return {
      markdown,
      run_root: run,
      target_run: target,
      depth: "run",
    };
  }

  const nowMs = now ? Date.parse(now) : Date.now();
  if (now && !Number.isFinite(nowMs)) {
    throw new HarnessError("INVALID_ARGUMENT", `invalid --now timestamp: ${now}`);
  }

  const reclaimResult = reclaimDeadPulse(run, {
    now: nowMs,
    actor,
  });

  const briefResult = await buildWakeBrief(run, {
    now: nowMs,
    actor,
    host,
    driver,
    targetRun,
  });

  return {
    markdown: briefResult.markdown,
    run_root: run,
    mode: briefResult.mode,
    lane: briefResult.lane,
    charter_status: briefResult.charterStatus,
    runtime_status: briefResult.runtimeStatus,
    integrity_status: briefResult.integrityStatus,
    next: briefResult.next,
    then: briefResult.then,
    pulse: briefResult.pulseCounter,
    actor: briefResult.actor,
    depth: "brief",
    ...(reclaimResult.reclaimed
      ? { reclaimed: true, reclaimed_pulse_id: reclaimResult.pulseId }
      : {}),
  };
}
