import type { JsonObject } from "../contracts/json.ts";
import {
  gateCommand,
  packetSecret,
  placeholder,
  type CommandView,
  type GateView,
  type PacketView,
} from "./action-types.ts";

export function completionActions(
  prefix: string[],
  runRoot: string,
  view: JsonObject,
  gates: GateView[],
  records: CommandView[],
): string[][] {
  const commands: string[][] = [];
  const orphanEvidence = (view.orphan_evidence ?? []) as {
    orphan_sha256: string;
    evidence: JsonObject;
  }[];
  const dispositions = new Set(
    ((view.orphan_evidence_dispositions ?? []) as unknown as { orphan_sha256: string }[]).map(
      ({ orphan_sha256 }) => orphan_sha256,
    ),
  );
  for (const orphan of orphanEvidence) {
    const sha = orphan.orphan_sha256;
    if (!dispositions.has(sha))
      commands.push([
        ...prefix,
        "disposition-orphan",
        "--run",
        runRoot,
        "--actor",
        "coordinator",
        "--disposition",
        placeholder(`orphan-disposition-json-for:${sha}`),
      ]);
  }
  if (commands.length > 0) return commands;
  const missingRunGates = gates.filter(
    (entry) =>
      entry.scope === "run" &&
      !records.some(
        (record) =>
          record.status === "succeeded" && record.task_id === null && record.gate_id === entry.id,
      ),
  );
  for (const gate of missingRunGates) commands.push(gateCommand(prefix, runRoot, gate));
  if (missingRunGates.length > 0) return commands;
  const critic = view.completion_critic as {
    critic_id: string;
    attempt: number;
    status: string;
    packet_id: string | null;
  } | null;
  if (critic === null || critic.status === "expired") {
    commands.push([
      ...prefix,
      "begin-critic",
      "--run",
      runRoot,
      "--critic",
      placeholder("fresh-critic-id"),
    ]);
    return commands;
  }
  const packets = view.packets as unknown as PacketView[];
  const criticPacket = packets.find((packet) => packet.id === critic.packet_id);
  const secret = packetSecret(criticPacket);
  if (critic.status === "assigned") {
    const repositoryIds = records
      .filter(
        (record) =>
          record.status === "succeeded" && record.task_id === null && record.gate_id !== null,
      )
      .map(({ id }) => id)
      .sort();
    commands.push([
      ...prefix,
      "packet",
      "--run",
      runRoot,
      "--role",
      "completeness-critic",
      "--agent",
      critic.critic_id,
      "--token",
      placeholder("host-only-bearer-secret-returned-by:begin-critic"),
      "--repository-command-ids",
      repositoryIds.join(","),
      "--id",
      `critic-${critic.attempt}`,
    ]);
  } else if (critic.status === "packet_published") {
    commands.push([
      ...prefix,
      "review-completion",
      "--run",
      runRoot,
      "--critic",
      critic.critic_id,
      "--token",
      secret,
      "--review",
      placeholder(`completion-review-json-for:${critic.packet_id}`),
    ]);
  } else if (critic.status === "reviewed") {
    const review = view.completion_review as {
      status: "clean" | "findings";
      review_sha256: string;
    } | null;
    if (review?.status === "findings") {
      const remediations = view.completion_remediations as unknown as {
        review_sha256: string;
      }[];
      if (remediations.some((entry) => entry.review_sha256 === review.review_sha256)) {
        commands.push([
          ...prefix,
          "begin-critic",
          "--run",
          runRoot,
          "--critic",
          placeholder("fresh-critic-id"),
        ]);
      } else {
        commands.push([
          ...prefix,
          "remediate-completion",
          "--run",
          runRoot,
          "--actor",
          "coordinator",
          "--remediation",
          placeholder(`completion-remediation-json-for:${review.review_sha256}`),
        ]);
      }
    } else if (review?.status === "clean") {
      commands.push([...prefix, "complete", "--run", runRoot, "--actor", "coordinator"]);
    }
  }
  return commands;
}
