import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  agentRegisterCommand,
  agentReportCommand,
} from "../../../olt/scripts/src/cli/commands/agent-ops.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/index.ts";
import {
  buildNodeTelemetry,
  buildNodeTools,
  readAgentLedgerView,
} from "../../../olt/scripts/src/summary/metrics/index.ts";
import { cleanupVirtualAgentsFS, setupVirtualAgentsFS } from "../fixture.ts";
import {
  cleanupGrantRoots,
  ledgerOf,
  registerCoordinator,
  seededRun,
} from "../grants/agent-grant-fixtures.ts";

beforeEach(() => {
  setupVirtualAgentsFS();
});

afterEach(() => {
  cleanupVirtualAgentsFS();
});

afterAll(() => {
  cleanupGrantRoots();
});

/** A model string with a tier, a vendor and a date in it: none of which may be read out of it. */
const REPORTED_MODEL = "vendor-model-9-huge-20260101";

function capsuleWithWorker(
  name: string,
  extra: Record<string, string | readonly string[]> = {},
): string {
  const run = seededRun(import.meta.path, name);
  registerCoordinator(run);
  agentRegisterCommand(
    {
      run,
      agent: "worker-1",
      role: "implementer",
      host: "some-host",
      "parent-agent": "coordinator-1",
      "parent-task": "task-1",
      ...extra,
    },
    {
      authenticatedCaller: {
        actor: "coordinator-1",
        role: "coordinator",
        verified: true,
      },
    },
  );
  return run;
}

function worker(run: string) {
  return ledgerOf(run).find((grant) => grant.id === "worker-1")!;
}

function telemetryOf(run: string) {
  return buildNodeTelemetry("worker-1", readAgentLedgerView(loadRun(run).state));
}

describe("model telemetry keeps the generic layer, the instance and the extras apart", () => {
  test("records provider, model and context window as the caller relayed them", () => {
    const run = capsuleWithWorker("telemetry-generic", {
      provider: "some-provider",
      model: REPORTED_MODEL,
      "model-tier": "l",
      "context-window": "200000",
    });

    const grant = worker(run);
    // Typed on the CLI by whoever called it, not attested by the host itself, so these carry
    // agent_reported — the same class --tool already carried before B39 finding 1 was fixed.
    expect(grant.provider).toEqual({ value: "some-provider", evidence_class: "agent_reported" });
    expect(grant.context_window).toEqual({ value: 200000, evidence_class: "agent_reported" });
    // Recorded exactly as reported: not split, not shortened, not matched against anything.
    expect(grant.model?.value).toBe(REPORTED_MODEL);
  });

  test("a model reported without a provider or a tier leaves both absent", () => {
    const run = capsuleWithWorker("telemetry-model-only", { model: REPORTED_MODEL });
    const grant = worker(run);
    expect(grant.model?.value).toBe(REPORTED_MODEL);
    expect("provider" in grant).toBeFalse();
    expect("model_tier" in grant).toBeFalse();
    expect("context_window" in grant).toBeFalse();
  });

  test("provider-specific counters land in the open bag under their reported names", () => {
    const run = capsuleWithWorker("telemetry-counters");
    agentReportCommand({
      run,
      agent: "worker-1",
      "tokens-in": "18000",
      "token-extra": ["cache_read_input_tokens=91000", "reasoning_output_tokens=1200"],
    });

    expect(worker(run).token_extras).toEqual({
      cache_read_input_tokens: { value: 91000, evidence_class: "agent_reported" },
      reasoning_output_tokens: { value: 1200, evidence_class: "agent_reported" },
    });
  });

  test("a later report replaces the counter it names and leaves the others standing", () => {
    const run = capsuleWithWorker("telemetry-counter-merge");
    agentReportCommand({
      run,
      agent: "worker-1",
      "token-extra": ["cache_read=1000", "tool_tokens=50"],
    });
    agentReportCommand({
      run,
      agent: "worker-1",
      "token-extra": "cache_read=4000",
    });

    expect(worker(run).token_extras).toEqual({
      cache_read: { value: 4000, evidence_class: "agent_reported" },
      tool_tokens: { value: 50, evidence_class: "agent_reported" },
    });
  });

  test("estimated counters are derived estimates, counters and totals alike", () => {
    const run = capsuleWithWorker("telemetry-counter-estimate");
    agentReportCommand({
      run,
      agent: "worker-1",
      "token-extra": "cache_read=4000",
      "tokens-estimated": true,
    });

    expect(worker(run).token_extras?.cache_read).toEqual({
      value: 4000,
      evidence_class: "derived",
      is_estimated: true,
    });
  });

  test("a counter alone is a report; a call with nothing at all is refused", () => {
    const run = capsuleWithWorker("telemetry-counter-only");
    agentReportCommand({ run, agent: "worker-1", "token-extra": "cache_read=10" });
    expect(worker(run).report_count).toBe(1);

    expect(() => agentReportCommand({ run, agent: "worker-1" })).toThrow(
      "at least one of --tool, --tokens-in, --tokens-out or --token-extra",
    );
  });

  test("refuses a counter that is not <name>=<count>, or not a whole non-negative number", () => {
    const run = capsuleWithWorker("telemetry-counter-refusals");
    const report = (value: string) =>
      agentReportCommand({ run, agent: "worker-1", "token-extra": value });

    expect(() => report("cache_read")).toThrow("--token-extra expects <name>=<count>");
    expect(() => report("cache_read=-1")).toThrow("must be a non-negative integer");
    expect(() => report("cache_read=lots")).toThrow("must be a non-negative integer");
    expect(() => report("cache_read=1.5")).toThrow("must be a non-negative integer");
  });

  test("refuses the same counter named twice in one call", () => {
    const run = capsuleWithWorker("telemetry-counter-duplicate");
    expect(() =>
      agentReportCommand({
        run,
        agent: "worker-1",
        "token-extra": ["cache_read=1", "cache_read=2"],
      }),
    ).toThrow("names cache_read twice");
  });

  test("refuses a context window that is not a positive whole number", () => {
    const run = seededRun(import.meta.path, "telemetry-window-refusal");
    registerCoordinator(run);
    expect(() =>
      agentRegisterCommand({
        run,
        agent: "worker-1",
        role: "implementer",
        host: "some-host",
        "context-window": "0",
      }),
    ).toThrow("--context-window must be a bounded integer");
  });
});

describe("what the graph carries from the ledger", () => {
  test("the node's telemetry carries every layer the caller reported", () => {
    const run = capsuleWithWorker("telemetry-node", {
      provider: "some-provider",
      model: REPORTED_MODEL,
      "context-window": "200000",
    });
    agentReportCommand({ run, agent: "worker-1", "token-extra": "cache_read=91000" });

    const telemetry = telemetryOf(run)!;
    expect(telemetry.provider?.value).toBe("some-provider");
    expect(telemetry.model?.value).toBe(REPORTED_MODEL);
    expect(telemetry.contextWindow?.value).toBe(200000);
    expect(telemetry.tokenExtras).toEqual({
      cache_read: { value: 91000, evidence_class: "agent_reported" },
    });
  });

  test("a node nobody reported telemetry for carries none of it", () => {
    const run = capsuleWithWorker("telemetry-node-empty");
    const telemetry = telemetryOf(run)!;
    expect(telemetry.provider).toBeUndefined();
    expect(telemetry.contextWindow).toBeUndefined();
    expect(telemetry.tokenExtras).toBeUndefined();
  });

  test("the node's tools carry their category and extras, granted and used alike", () => {
    const run = capsuleWithWorker("telemetry-node-tools", {
      tool: "Read=file-edit",
      "tool-extra": "Read:mode=text",
    });
    agentReportCommand({ run, agent: "worker-1", tool: "Grep=search" });

    const tools = buildNodeTools("worker-1", readAgentLedgerView(loadRun(run).state));
    expect(tools).toEqual([
      {
        name: "Grep",
        category: "search",
        evidence_class: "agent_reported",
        firstReportedAt: tools[0]!.firstReportedAt!,
      },
      {
        name: "Read",
        category: "file-edit",
        extras: { mode: "text" },
        evidence_class: "agent_reported",
      },
    ]);
  });
});
