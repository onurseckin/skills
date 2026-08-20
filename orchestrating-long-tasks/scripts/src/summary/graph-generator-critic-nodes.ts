import type { Manifest } from "../contracts/capsule.ts";
import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord, WorkflowState } from "../workflow/types.ts";
import { buildNodeTelemetry, buildNodeTools, type AgentLedgerView } from "./agent-telemetry.ts";
import { mapFindingDetails, mapMediaAssets, mapRunScreenshotAssets } from "./asset-mapper.ts";
import { createEdge } from "./edge-builder.ts";
import { projectFindingsForNode, type AssetRegistry } from "./graph-asset-ownership.ts";
import { buildNodeBrowserTests } from "./browser-tests.ts";
import { isCriticCommand, buildNodeScripts } from "./node-evidence.ts";
import type { StepAssignments } from "./step-calculator.ts";
import type { GraphEdgeData, GraphNodeData, IoPort, NodeKind } from "./types.ts";

export interface CriticNodeInput {
  runId: string;
  state: Readonly<WorkflowState>;
  steps: StepAssignments;
  tasks: readonly TaskRecord[];
  commands: readonly CommandRecord[];
  ledger: AgentLedgerView;
  registry: AssetRegistry;
  manifest?: Manifest | undefined;
  runRoot?: string | undefined;
}

export interface CriticNodes {
  criticNode: GraphNodeData;
  terminalNode: GraphNodeData;
  edges: GraphEdgeData[];
}

/** Gates the critic's own findings point back at, resolved through the recorded requirement ids. */
function gatesForCriticFindings(
  review: WorkflowState["completion_review"],
  tasks: readonly TaskRecord[],
): Array<{ taskId: string; findingIds: string[] }> {
  if (!review) return [];
  const byTask = new Map<string, string[]>();
  for (const finding of review.findings ?? []) {
    for (const task of tasks) {
      if (!task.requirement_ids.includes(finding.requirement_id)) continue;
      const list = byTask.get(task.id) ?? [];
      list.push(finding.id);
      byTask.set(task.id, list);
    }
  }
  return [...byTask].map(([taskId, findingIds]) => ({ taskId, findingIds }));
}

/** Every agent the run authorised as a completeness critic, current and expired. */
function recordedCriticIds(state: Readonly<WorkflowState>): ReadonlySet<string> {
  const ids = new Set<string>();
  if (state.completion_critic) ids.add(state.completion_critic.critic_id);
  for (const authorization of state.completion_critic_history ?? [])
    ids.add(authorization.critic_id);
  if (state.completion_review) ids.add(state.completion_review.critic_id);
  return ids;
}

export function buildCriticAndTerminalNodes(input: CriticNodeInput): CriticNodes {
  const { runId, state, steps, tasks, registry, ledger } = input;
  const review = state.completion_review;
  const criticIds = recordedCriticIds(state);
  const criticCommands = input.commands.filter((command) => isCriticCommand(command, criticIds));
  // The run's review events belong to the validators that raised them, so they are deliberately not
  // passed here: reading them would let the critic republish another node's findings as its own.
  const options = {
    ...(review !== undefined ? { completionReview: review } : {}),
    ...(input.manifest !== undefined ? { manifest: input.manifest } : {}),
    ...(input.runRoot !== undefined ? { runRoot: input.runRoot } : {}),
  };

  // `task` stays undefined on purpose here, and the mapper no longer treats that as "every
  // screenshot in the run": the critic only owns evidence the critic itself recorded.
  const assets = registry.claim(
    mapMediaAssets(undefined, criticCommands, { ...options, scope: "critic" }),
  );
  const findings = projectFindingsForNode(mapFindingDetails(undefined, options), registry);
  const telemetry = buildNodeTelemetry(review?.critic_id, ledger);
  const tools = buildNodeTools(review?.critic_id, ledger);

  const criticInputs: IoPort[] = tasks.map((task) => ({
    node: `node-gate-${task.id}`,
    kind: "artifact" as const,
    label: `Gate Verification Report: ${task.id}`,
    preview: `Verification evidence recorded for task ${task.id}`,
  }));
  const criticOutputs: IoPort[] = [
    {
      kind: "decision",
      label: "Completeness Critic Certification",
      preview: review
        ? `Critic recorded ${review.status} with ${findings.length} findings`
        : "No whole-run certification recorded",
    },
  ];

  const criticBrowserTests = buildNodeBrowserTests(criticCommands, input.runRoot);

  const criticNode: GraphNodeData = {
    id: "node-critic-authority",
    name: "Completeness Critic Review",
    description: "Whole-run completeness inspection and sign-off.",
    kind: "critic" as NodeKind,
    status: review ? (review.status === "clean" ? "success" : "warning") : "pending",
    step: steps.criticStep,
    stepLabel: `Step ${steps.criticStep}: Completeness Critic`,
    badge: review
      ? review.status === "clean"
        ? { text: "Certified Clean", variant: "success", icon: "IconScale" }
        : { text: `${findings.length} Findings Recorded`, variant: "warning", icon: "IconScale" }
      : { text: "No Review Recorded", variant: "neutral", icon: "IconScale" },
    ...(telemetry ? { telemetry } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    scripts: buildNodeScripts(criticCommands, input.runRoot),
    ...(criticBrowserTests.length > 0 ? { browserTests: criticBrowserTests } : {}),
    ...(assets.length > 0 ? { assets } : {}),
    io: { inputs: criticInputs, outputs: criticOutputs },
    metadata: {
      role: "completeness-critic",
      findings,
      ...(review
        ? {
            criticId: review.critic_id,
            agentId: review.critic_id,
            status: review.status,
            unresolvedFindingIds: review.unresolved_finding_ids ?? [],
            residualRisks: review.residual_risks ?? [],
            requirementProofs: review.requirement_proofs ?? [],
            reviewedAt: review.reviewed_at,
          }
        : {}),
    },
  };

  const completion = state.completion_result;
  // Whatever no node claimed lands here, labelled for what it is rather than attributed to an agent.
  const unattributed = input.runRoot ? registry.claim(mapRunScreenshotAssets(input.runRoot)) : [];
  const terminalNode: GraphNodeData = {
    id: "node-terminal-complete",
    name: "Run Completion",
    description: "Sealed capsule run completion.",
    kind: "terminal" as NodeKind,
    status: completion?.status === "complete" ? "success" : "pending",
    step: steps.terminalStep,
    stepLabel: `Step ${steps.terminalStep}: Terminal Outcome`,
    badge: completion
      ? { text: "Sealed Run", variant: "success", icon: "IconFlagCheck" }
      : { text: "Not Sealed", variant: "neutral", icon: "IconFlagCheck" },
    io: {
      inputs: [
        {
          node: "node-critic-authority",
          kind: "decision",
          label: "Critic Authority Packet",
          preview: review ? "Whole-run certification recorded" : "No certification recorded",
        },
      ],
      outputs: [
        {
          kind: "summary",
          label: "Execution Trajectory Summary",
          preview: `Run ${runId} recorded ${tasks.length} tasks`,
        },
      ],
    },
    ...(unattributed.length > 0 ? { assets: unattributed } : {}),
    metadata: {
      // CompletionResult.status is the single-member literal type "complete" - its presence IS the
      // completion, so this mirrors the node's own status ternary three lines above: a run with no
      // completion_result has not reached that state yet, which "pending" names rather than guesses.
      status: completion?.status ?? "pending",
      ...(completion?.completed_at ? { completedAt: completion.completed_at } : {}),
      ...(unattributed.length > 0 ? { unattributedAssetCount: unattributed.length } : {}),
    },
  };

  const edges: GraphEdgeData[] = [
    createEdge({
      id: "edge-critic-complete",
      source: "node-critic-authority",
      target: "node-terminal-complete",
      kind: "signoff",
      stepNumber: steps.terminalStep,
      title: "Authority Sign-off",
      detail: completion ? "Sealed run" : "Awaiting seal",
      variant: completion ? "success" : "neutral",
      icon: "IconFlagCheck",
      exchanges: [
        {
          id: "exch-critic-complete",
          ...(review?.reviewed_at ? { timestamp: review.reviewed_at } : {}),
          direction: "forward",
          type: "signoff",
          kind: "decision",
          summary: review
            ? `Critic ${review.critic_id} recorded ${review.status}`
            : "No completion review recorded",
          ...(review ? { verdict: review.status === "clean" ? "PASS" : "FAIL" } : {}),
          evidence_class: review ? "harness_observed" : "derived",
        },
      ],
    }),
  ];

  // B25.4: an explicit, justified residual cycle, not the pushback loop B25.2 retired. The
  // completeness critic runs once, after every task's own validator has already passed it — there
  // is no `critic_round` counter and no second critic node to forward into, so unlike a repair
  // round this finding has nowhere later in the graph to point at. Modelling it as a fresh node
  // would mean inventing a round the run never recorded.
  for (const { taskId, findingIds } of gatesForCriticFindings(review, tasks)) {
    edges.push(
      createEdge({
        id: `edge-critic-${taskId}`,
        source: "node-critic-authority",
        target: `node-gate-${taskId}`,
        kind: "critic",
        stepNumber: steps.criticStep,
        title: `Critic Finding (${findingIds.length})`,
        detail: findingIds.join(", "),
        variant: "error",
        icon: "IconScale",
        isCycle: true,
        targetTab: "feedback",
      }),
    );
  }

  return { criticNode, terminalNode, edges };
}
