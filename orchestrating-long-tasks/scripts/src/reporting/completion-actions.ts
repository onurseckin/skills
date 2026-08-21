import type { JsonObject } from "../contracts/json.ts";
import {
  gateArgv,
  CRITIC_TOKEN,
  type CommandView,
  type GateView,
  type NextActions,
} from "./action-types.ts";
import { placeholder, pushArgv, registryArgv } from "./registry-argv.ts";

const COORDINATOR = "coordinator";

function criticStart(entrypoint: string, runRoot: string): string[] | undefined {
  return registryArgv(entrypoint, "critic:start", [
    ["run", runRoot],
    ["critic", placeholder("fresh-critic-id")],
  ]);
}

function criticChecks(
  entrypoint: string,
  runRoot: string,
  criticId: string,
  gates: GateView[],
  records: CommandView[],
): string[][] {
  if (records.some((record) => record.actor === criticId && record.status === "succeeded")) {
    return [];
  }
  const argv: string[][] = [];
  for (const gate of gates) {
    if (gate.scope !== "run") continue;
    pushArgv(argv, gateArgv(entrypoint, runRoot, gate, criticId));
  }
  return argv;
}

function criticReview(entrypoint: string, runRoot: string, criticId: string): string[] | undefined {
  return registryArgv(entrypoint, "critic:review", [
    ["run", runRoot],
    ["critic", criticId],
    ["token", CRITIC_TOKEN],
    ["decision", placeholder("approve-or-request_changes")],
    ["summary", placeholder("completeness-verdict-in-the-critics-own-words")],
  ]);
}

export function completionActions(
  entrypoint: string,
  runRoot: string,
  view: JsonObject,
  gates: GateView[],
  records: CommandView[],
): NextActions {
  const argv: string[][] = [];
  const orphanEvidence = (view.orphan_evidence ?? []) as { orphan_sha256: string }[];
  const dispositions = new Set(
    ((view.orphan_evidence_dispositions ?? []) as { orphan_sha256: string }[]).map(
      ({ orphan_sha256 }) => orphan_sha256,
    ),
  );
  const undispositioned = orphanEvidence
    .map(({ orphan_sha256 }) => orphan_sha256)
    .filter((sha) => !dispositions.has(sha));
  if (undispositioned.length > 0) {
    return {
      argv,
      unavailable: undispositioned.map(
        (sha) =>
          `orphan evidence ${sha} blocks completion and no registry command dispositions it; the disposition has to be recorded before the run can seal`,
      ),
    };
  }
  const missingRunGates = gates.filter(
    (gate) =>
      gate.scope === "run" &&
      !records.some(
        (record) =>
          record.status === "succeeded" && record.task_id === null && record.gate_id === gate.id,
      ),
  );
  for (const gate of missingRunGates) {
    pushArgv(argv, gateArgv(entrypoint, runRoot, gate, COORDINATOR));
  }
  if (missingRunGates.length > 0) return { argv, unavailable: [] };
  const critic = view.completion_critic as { critic_id: string; status: string } | null;
  if (critic === null || critic.status === "expired") {
    pushArgv(argv, criticStart(entrypoint, runRoot));
    return { argv, unavailable: [] };
  }
  if (critic.status === "assigned" || critic.status === "packet_published") {
    argv.push(...criticChecks(entrypoint, runRoot, critic.critic_id, gates, records));
    pushArgv(argv, criticReview(entrypoint, runRoot, critic.critic_id));
    return { argv, unavailable: [] };
  }
  if (critic.status !== "reviewed") return { argv, unavailable: [] };
  const review = view.completion_review as { status: string; review_sha256: string } | null;
  if (review?.status === "clean") {
    pushArgv(
      argv,
      registryArgv(entrypoint, "run:complete", [
        ["run", runRoot],
        ["actor", COORDINATOR],
        ["auth-token", CRITIC_TOKEN],
      ]),
    );
    return { argv, unavailable: [] };
  }
  if (review?.status !== "findings") return { argv, unavailable: [] };
  const remediations = (view.completion_remediations ?? []) as { review_sha256: string }[];
  if (remediations.some((entry) => entry.review_sha256 === review.review_sha256)) {
    pushArgv(argv, criticStart(entrypoint, runRoot));
    return { argv, unavailable: [] };
  }
  return {
    argv,
    unavailable: [
      `completion review ${review.review_sha256} recorded findings and no registry command records the remediation that answers them`,
    ],
  };
}
