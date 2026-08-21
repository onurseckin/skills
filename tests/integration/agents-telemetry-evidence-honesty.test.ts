import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  cleanupRoots,
  compiledCapsule,
  ledgerOf,
  registerCoordinator,
} from "../unit/agents/fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

/**
 * B39 finding 1's structural guard, kept close to the source rather than only in prose: a value
 * typed onto `agent:register`/`agent:report` is unverified CLI input from whichever process called
 * the harness, and must never be recorded as though the host itself attested to it. Only
 * `probeAgentTelemetry`'s two real sources — the host's own config file, the host's own transcript
 * (B34) — ever earn `derived` or `harness_observed`; nothing here overrides that even when the typed
 * value happens to be pure fiction, which is the point: an honest label cannot depend on the value
 * being plausible.
 */
describe("B39 finding 1: a typed CLI value never earns a host-verified evidence class", () => {
  test("agent:register's telemetry flags all land as agent_reported, however implausible", async () => {
    const run = await compiledCapsule(roots, "honesty-register");
    await registerCoordinator(run);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "fake-telemetry-1",
      "--role",
      "implementer",
      "--host",
      "totally-fake-host",
      "--parent-agent",
      "coordinator-1",
      "--parent-task",
      "task-1",
      "--provider",
      "totally-fake-provider",
      "--model",
      "this-model-does-not-exist-v99",
      "--model-tier",
      "l",
      "--thinking-level",
      "high",
      "--context-window",
      "999999",
    ]);

    const grant = ledgerOf(run).find((entry) => entry.id === "fake-telemetry-1")!;
    const forbidden = new Set(["host_reported", "harness_observed"]);
    const fields: Record<string, { evidence_class: string } | undefined> = {
      provider: grant.provider,
      model: grant.model,
      model_tier: grant.model_tier,
      thinking_level: grant.thinking_level,
      context_window: grant.context_window,
    };
    for (const [field, value] of Object.entries(fields)) {
      expect(value, `${field} was never recorded`).toBeDefined();
      expect(
        forbidden.has(value!.evidence_class),
        `${field} carries ${value!.evidence_class}`,
      ).toBe(false);
      expect(value!.evidence_class).toBe("agent_reported");
    }
  });

  test("an explicit 'unknown' still carries the unknown class, not agent_reported", async () => {
    const run = await compiledCapsule(roots, "honesty-unknown");
    await registerCoordinator(run);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "fake-telemetry-2",
      "--role",
      "implementer",
      "--host",
      "totally-fake-host",
      "--parent-agent",
      "coordinator-1",
      "--parent-task",
      "task-1",
      "--model-tier",
      "unknown",
      "--thinking-level",
      "unknown",
    ]);

    const grant = ledgerOf(run).find((entry) => entry.id === "fake-telemetry-2")!;
    expect(grant.model_tier).toEqual({ value: "unknown", evidence_class: "unknown" });
    expect(grant.thinking_level).toEqual({ value: "unknown", evidence_class: "unknown" });
  });

  test("agent:report's token counts land as agent_reported, never host_reported or harness_observed", async () => {
    const run = await compiledCapsule(roots, "honesty-report");
    await registerCoordinator(run);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "fake-telemetry-3",
      "--role",
      "implementer",
      "--host",
      "totally-fake-host",
      "--parent-agent",
      "coordinator-1",
      "--parent-task",
      "task-1",
    ]);
    await execute([
      "agent:report",
      "--run",
      run,
      "--agent",
      "fake-telemetry-3",
      "--tokens-in",
      "999999999",
      "--tokens-out",
      "999999999",
      "--token-extra",
      "made_up_counter=42",
    ]);

    const grant = ledgerOf(run).find((entry) => entry.id === "fake-telemetry-3")!;
    expect(grant.tokens_in?.evidence_class).toBe("agent_reported");
    expect(grant.tokens_out?.evidence_class).toBe("agent_reported");
    expect(grant.token_extras?.made_up_counter?.evidence_class).toBe("agent_reported");
  });
});
