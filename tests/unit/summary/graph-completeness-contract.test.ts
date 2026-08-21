import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { generateSummarySuite } from "../../../orchestrating-long-tasks/scripts/src/summary/generate-summary.ts";
import type { RunFiles } from "../../../orchestrating-long-tasks/scripts/src/contracts/capsule.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import type { GraphDataset } from "../../../orchestrating-long-tasks/scripts/src/summary/types.ts";
import { buildCompletenessRun, PLANTED } from "./completeness-run-fixture.ts";
import {
  WITHHELD_KEYS,
  collectRecordedFacts,
  describeMissing,
  unexportedFacts,
} from "./completeness-sweep.ts";

let repo = "";
let run = "";
let branchId = "";
let issuedTokens: string[] = [];
let graph: GraphDataset;
let serialized = "";
// Loading verifies the whole capsule, so it happens once and every assertion reads the same copy.
let loaded: RunFiles;

/**
 * The fixture is a real multi-agent run driven through the CLI, so it costs what the harness costs:
 * a dozen supervised commands, a branch excursion and a critic pass. The hook gets its own budget so
 * a loaded machine cannot turn an inherently slow setup into a false failure of the contract.
 */
const BUILD_TIMEOUT_MS = 300_000;

beforeAll(async () => {
  const built = await buildCompletenessRun("graph-completeness");
  repo = built.repo;
  run = built.run;
  branchId = built.branchId;
  issuedTokens = built.tokens;
  graph = generateSummarySuite({ capsulePath: run, writeToDisk: false }).graph;
  serialized = JSON.stringify(graph);
  loaded = loadRun(run);
}, BUILD_TIMEOUT_MS);

afterAll(async () => {
  if (repo) await rm(repo, { recursive: true, force: true });
});

function node(id: string) {
  const found = graph.nodes.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`the export carries no node ${id}`);
  return found;
}

function allFindings() {
  return graph.nodes.flatMap((candidate) => candidate.metadata?.findings ?? []);
}

describe("graph.json completeness contract", () => {
  test("carries the prompt, the enhanced plan and the derived requirements", () => {
    const facts = graph.run;
    expect(facts?.prompt.text).toContain(PLANTED.promptAlpha);
    expect(facts?.prompt.text).toContain(PLANTED.promptBeta);
    expect(facts?.prompt.evidence_class).toBe("harness_observed");
    expect(facts?.prompt.bytes).toBeGreaterThan(0);

    // The enhancement is an agent's claim about the repository, never the requirement source.
    expect(facts?.enhancedPlan?.evidence_class).toBe("agent_reported");
    expect(facts?.enhancedPlan?.markdown).toContain(PLANTED.planSummary);
    expect(JSON.stringify(facts?.enhancedPlan?.document)).toContain(PLANTED.planTodo);
    expect(facts?.enhancedPlan?.markdownSha256).toMatch(/^[0-9a-f]{64}$/u);

    const requirements = facts?.requirements;
    expect(requirements?.evidence_class).toBe("derived");
    expect(requirements?.requirements.length).toBe(2);
    expect(JSON.stringify(requirements?.requirements)).toContain(PLANTED.promptAlpha);
    expect(requirements?.dispositions.length).toBeGreaterThan(0);
    expect(requirements?.promptSha256).toBe(facts?.prompt.sha256);
  });

  test("carries the recorded topology with a rationale for every task", () => {
    const topology = graph.run?.topology;
    expect(topology?.revision).toBeGreaterThan(0);
    expect(topology?.max_parallel).toBeGreaterThan(0);
    expect(topology?.waves.flatMap((wave) => wave.task_ids).sort()).toEqual([
      "task-alpha",
      "task-beta",
    ]);
    for (const taskId of ["task-alpha", "task-beta"]) {
      const decision = topology?.decisions.find((entry) => entry.task_id === taskId);
      expect(decision?.rationale.length).toBeGreaterThan(0);
      expect(decision?.reason).toBeDefined();
      expect(decision?.evidence_class).toBeDefined();
    }
    // Two tasks in one wave is the multi-agent case the contract asks the fixture to exercise.
    expect(topology?.waves[0]?.task_ids.length).toBe(2);
  });

  test("gives every node a role, a status, a step and the work it owns", () => {
    for (const id of ["node-task-task-alpha", "node-task-task-beta"]) {
      const owner = node(id);
      expect(owner.metadata?.role).toBe("implementer");
      expect(owner.status).toBeDefined();
      expect(owner.step).toBeGreaterThan(0);
      expect(owner.metadata?.writeScope?.length).toBeGreaterThan(0);
    }
    expect(node("node-validator-task-alpha").metadata?.role).toBe("validator");
    expect(node("node-critic-authority").metadata?.role).toBe("completeness-critic");

    const subTask = graph.nodes.find((candidate) => candidate.metadata?.subTaskId === "S-1");
    expect(subTask?.metadata?.branchId).toBe(branchId);
    expect(subTask?.metadata?.branchReason).toBe(PLANTED.branchReason);
    expect(subTask?.metadata?.summary).toBe(PLANTED.subTaskSummary);
  });

  test("carries every state transition, with the verdict and round that caused it", () => {
    const transitions = node("node-task-task-alpha").stateTransitions ?? [];
    const recorded = (
      loaded.state as unknown as { tasks: Record<string, { history: Array<{ to: string }> }> }
    ).tasks["task-alpha"]?.history;
    expect(transitions.length).toBeGreaterThanOrEqual(recorded?.length ?? 0);
    expect(transitions.map((entry) => entry.to)).toContain("changes_requested");
    expect(transitions.map((entry) => entry.to)).toContain("validated");

    const probe = transitions.find((entry) => entry.verdict === "probe");
    expect(probe?.round).toBe(1);
    expect(probe?.findingClass).toBe("probe_demand");
    // A pass after a probe is still a pass; the verdict says so rather than the round implying it.
    expect(transitions.some((entry) => entry.verdict === "pass")).toBe(true);
    for (const entry of transitions) expect(entry.evidence_class).toBe("harness_observed");

    // task-beta's pass closes a probe demand and nothing else. The class of what a verdict closed is
    // not the class that caused the move, so the passing transition states no finding class at all.
    const beta = node("node-task-task-beta").stateTransitions ?? [];
    const betaPass = beta.find((entry) => entry.verdict === "pass");
    expect(betaPass?.to).toBe("validated");
    expect(betaPass?.findingClass).toBeUndefined();
  });

  test("carries every script with argv, cwd, exit code, duration and its whole log output", () => {
    const scripts = graph.nodes.flatMap((candidate) => candidate.scripts ?? []);
    const recorded = Object.keys(
      (loaded.state as unknown as { commands: Record<string, unknown> }).commands,
    );
    expect(new Set(scripts.map((script) => script.commandId))).toEqual(new Set(recorded));

    const gate = scripts.find((script) => script.gateId === "gate-alpha");
    // A3-gate-discrimination (`graph/plan-audit.ts`) refuses two disjoint-scope tasks sharing one
    // gate command; the fixture's alpha and beta tasks each get their own `test -f <own-scope-file>`
    // instead of a shared `git diff --check`, so this is alpha's own argv, not a generic gate.
    expect(gate?.argv).toEqual(["test", "-f", "src/alpha/index.ts"]);
    expect(gate?.cwd?.length).toBeGreaterThan(0);
    expect(gate?.exitCode).toBe(0);
    expect(gate?.durationMs).toBeGreaterThanOrEqual(0);
    expect(gate?.evidence_class).toBe("harness_observed");
    // The whole log, not a tail of it: the visualizer has no second place to read the rest from.
    const echoed = scripts.find((script) => script.argv[1] === "alpha-implementation");
    expect(echoed?.stdoutTail).toBe("alpha-implementation");
    expect(echoed?.stdoutTruncated).toBeUndefined();
    expect(echoed?.stdoutBytes).toBe("alpha-implementation\n".length);
    expect(echoed?.stdoutSha256).toMatch(/^[0-9a-f]{64}$/u);
    // Everything else the record holds travels with it, so a new record field cannot go missing.
    expect(gate?.record).toBeDefined();
    expect((gate?.record as { fingerprint?: string }).fingerprint).toBe(gate?.fingerprint);
  });

  test("withholds every credential, which is the one thing a browser must not receive", () => {
    expect(serialized).not.toContain("HARNESS_INTERNAL_OWNERSHIP_TOKEN");
    // Completeness stops at secrets: a lease token in a file meant for a browser is a leaked lease.
    expect(issuedTokens.length).toBeGreaterThan(5);
    for (const issued of issuedTokens) expect(serialized).not.toContain(issued);
    const scripts = graph.nodes.flatMap((candidate) => candidate.scripts ?? []);
    for (const script of scripts) {
      expect(Object.hasOwn(script.record ?? {}, "environment")).toBe(false);
    }
  });

  test("carries the run-level command no node owns rather than dropping it", () => {
    const terminal = node("node-terminal-complete");
    const runGate = (terminal.scripts ?? []).find(
      (script) => script.gateId === "gate-run-completion",
    );
    expect(runGate?.exitCode).toBe(0);
    expect(terminal.metadata?.unattributedCommandCount).toBeGreaterThan(0);
  });

  test("carries every changed file with the evidence class of the claim", () => {
    const files = node("node-task-task-alpha").files ?? [];
    expect(files).toHaveLength(1);
    const alpha = files[0]!;
    expect(alpha.path).toBe("src/alpha/index.ts");
    expect(alpha.mode).toBe("write");
    expect(alpha.evidence_class).toBe("agent_reported");
    const region = graph.sections?.find((section) => section.id === `section-branch-${branchId}`);
    const observed = region?.files ?? [];
    expect(observed.length).toBeGreaterThan(0);
    for (const file of observed) {
      expect(file.evidence_class).toBe("harness_observed");
      expect(file.statusCode).toBeDefined();
    }
  });

  test("attributes the file to the report's own rationale, requirements and submission step (B15.2)", () => {
    const alpha = (node("node-task-task-alpha").files ?? [])[0]!;
    // The repair round's own words: the alpha task's report is overwritten on resubmission, so this
    // is the last thing the fixture told the harness about the file, not the first.
    expect(alpha.rationale).toBe(PLANTED.repairSummary);
    expect(alpha.requirementIds?.length).toBeGreaterThan(0);
    expect(alpha.step).toBeGreaterThan(0);
    // C4: task:submit refuses a byte-identical resubmission, so the fixture's repair round writes a
    // real second change to the file's content — a real diff against the run's baseline commit now
    // exists to measure, and `enrichFileRefsWithDiffs` (file-diff-reader.ts) reads it off disk rather
    // than reporting an empty change as real. Hunk/content lines are asserted rather than the whole
    // diff text so this does not pin down git's own hash-abbreviation formatting.
    expect(alpha.diff).toContain("--- a/src/alpha/index.ts");
    expect(alpha.diff).toContain("+++ b/src/alpha/index.ts");
    expect(alpha.diff).toContain("-export const alpha = 1;");
    expect(alpha.diff).toContain("+export const alpha = 2;");
    expect(alpha.diff).toContain("+export const alphaFixture = true;");
    expect(alpha.lines).toBe("1-2");
    expect(alpha.additions).toBe(2);
    expect(alpha.deletions).toBe(1);

    const step = graph.run?.steps?.find(
      (entry) => entry.step === alpha.step && entry.target.taskId === "task-alpha",
    );
    expect(step?.rawKind).toBe("task-submitted");
    expect(step?.evidence_class).toBe("harness_observed");
  });

  test("carries every recorded tool with its own evidence class", () => {
    const tools = node("node-task-task-alpha").tools ?? [];
    expect(tools.map((tool) => tool.name)).toContain("Edit");
    for (const tool of tools) expect(tool.evidence_class).toBeDefined();
  });

  test("carries probe demands and defects alike, with remediation and resolution proof", () => {
    const findings = allFindings();
    const defect = findings.find((finding) => finding.observation === PLANTED.rejectReason);
    expect(defect?.class).toBe("defect");
    expect(defect?.severity).toBe("important");
    expect(defect?.remediation).toBe(PLANTED.rejectRemediation);
    expect(defect?.round).toBeGreaterThanOrEqual(0);
    expect(defect?.status).toBe("resolved");
    expect(defect?.resolvedBy).toBe("val-alpha-2");
    expect(defect?.resolvedAt).toBeDefined();
    // The proof names the command that answered it; stringifying the record used to destroy this.
    expect(defect?.revalidationProof?.evidence?.[0]).toMatch(/^C-/u);

    const probe = findings.find((finding) => finding.observation === PLANTED.probeAlpha);
    expect(probe?.class).toBe("probe_demand");
    expect(probe?.status).toBe("resolved");
    expect(probe?.revalidationProof?.evidence?.[0]).toMatch(/^C-/u);
    expect(findings.some((finding) => finding.observation === PLANTED.probeBeta)).toBe(true);
  });

  test("carries per-agent telemetry and the whole grant ledger", () => {
    const coordinator = graph.run?.agents?.find((grant) => grant.id === "coordinator-1");
    expect(coordinator?.model?.value).toBe(PLANTED.model);
    // A `--model` typed on `agent:register` is the calling process's own claim, not something the
    // host attested to, so it carries `agent_reported` (B39 finding 1) — only a value
    // `probeAgentTelemetry` actually reads off the host's config or transcript earns `host_reported`.
    expect(coordinator?.model?.evidence_class).toBe("agent_reported");
    expect(coordinator?.status).toBe("released");
    expect(coordinator?.release_reason).toBe("run complete");

    const sub = graph.run?.agents?.find((grant) => grant.id === "sub-beta-1");
    expect(sub?.parent_agent_id).toBe("worker-beta");
    expect(sub?.parent_task_id).toBe("S-1");

    const telemetry = node("node-task-task-alpha").telemetry;
    expect(telemetry?.agentId).toBe("worker-alpha");
    expect(telemetry?.tokensIn?.value).toBe(18000);
    // Same rule as the coordinator's model above: a plain `--tokens-in` on `agent:report` is
    // unverified CLI input until a transcript probe corroborates it.
    expect(telemetry?.tokensIn?.evidence_class).toBe("agent_reported");
    // Nothing reported a tier for this agent, so the node has none rather than a guessed one.
    expect(telemetry?.modelTier).toBeUndefined();
  });

  test("carries the branch region with its reason and its collected outcome", () => {
    const region = graph.sections?.find((section) => section.id === `section-branch-${branchId}`);
    expect(region?.reason).toBe(PLANTED.branchReason);
    expect(region?.status).toBe("collected");
    expect(region?.outcomeSummary).toBe(PLANTED.collectSummary);
    expect(region?.depth).toBe(1);
    expect(region?.openedAt).toBeDefined();
    expect(region?.closedAt).toBeDefined();
    expect(region?.filesChanged?.evidence_class).toBe("harness_observed");

    const record = graph.run?.branches?.find((branch) => branch.id === branchId);
    expect(record?.sub_tasks[0]?.summary).toBe(PLANTED.subTaskSummary);
    expect(record?.collected_observation?.git_available).toBe(true);
  });

  test("carries the whole-run verdicts, the reports and the event chain", () => {
    expect(graph.run?.completion?.result).toBeDefined();
    expect(graph.run?.completion?.review).toBeDefined();
    // The critic's own words live only in reports/critic-review.json, so the export must read it.
    expect(JSON.stringify(graph.run?.reports)).toContain(PLANTED.criticSummary);
    expect(graph.run?.events?.length).toBeGreaterThan(0);
    expect(graph.run?.manifest).toBeDefined();
    expect(graph.run?.planGraph).toBeDefined();
    expect(graph.run?.integrity?.eventHead).toBeDefined();
    expect(graph.run?.repository?.baselineBinding).toBeDefined();
  });
});

describe("the completeness sweep itself", () => {
  test("every distinctive fact the capsule recorded reaches the graph", () => {
    const recorded = collectRecordedFacts(loaded.state, "state");
    for (const [value, paths] of collectRecordedFacts(loaded.events, "events")) {
      recorded.set(value, [...(recorded.get(value) ?? []), ...paths]);
    }
    for (const [value, paths] of collectRecordedFacts(loaded.manifest, "manifest")) {
      recorded.set(value, [...(recorded.get(value) ?? []), ...paths]);
    }
    // A sweep over a handful of values would pass by luck; this run records hundreds.
    expect(recorded.size).toBeGreaterThan(300);

    const missing = unexportedFacts(recorded, serialized);
    expect(describeMissing(missing)).toBe("");
    expect(missing).toEqual([]);
  });

  test("fails when an exported fact is dropped, which is what makes it an alarm", () => {
    const recorded = collectRecordedFacts(loaded.state, "state");
    const rationale = graph.run?.topology?.decisions[0]?.rationale ?? "";
    expect(rationale.length).toBeGreaterThan(0);
    // The rationale is recorded in exactly one place, so dropping the topology really loses it.
    const stripped: GraphDataset = {
      ...graph,
      run: graph.run ? { ...graph.run, topology: undefined } : undefined,
    };
    const missing = unexportedFacts(recorded, JSON.stringify(stripped));
    expect(missing.map((fact) => fact.value)).toContain(rationale);
    expect(describeMissing(missing)).toContain("state.topology");
  });

  test("names a reason for each key it agrees not to look at", () => {
    expect([...WITHHELD_KEYS.keys()].sort()).toEqual(["environment", "projection"]);
    for (const reason of WITHHELD_KEYS.values()) expect(reason.length).toBeGreaterThan(40);
  });
});
