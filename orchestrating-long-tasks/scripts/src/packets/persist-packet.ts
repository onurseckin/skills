import { join } from "node:path";
import { canonicalJsonBytes } from "../core/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { tokenMatches } from "../workflow/lease/token.ts";
import { assertCriticIndependent } from "../workflow/completion/critic-identity.ts";
import type { Clock, PacketRecord, TransactionPort, WorkflowState } from "../workflow/types.ts";
import { systemClock } from "../workflow/types.ts";
import { createPacketBundle, verifyPacketBundle } from "./packet-bundle.ts";
import type { BuiltPacket } from "./types.ts";
import { metadataInteger, metadataText, packetRecord } from "./packet-record.ts";
import { assertActiveCriticDeadline } from "./authorization-deadline.ts";
import { sameRepositoryBinding } from "../workflow/completion/repository-binding.ts";

export interface PacketAuthorization {
  agentId: string;
  token?: string;
  attempt: number;
}
export interface PublishedPacket {
  markdownPath: string;
  metadataPath: string;
  record: PacketRecord;
}
function authorize(
  state: WorkflowState,
  packet: BuiltPacket,
  auth: PacketAuthorization,
  now: Date,
): void {
  if (state.completion_result?.status === "complete") {
    throw new HarnessError("INVALID_STATE", "run is already completed");
  }
  const role = metadataText(packet.metadata, "role");
  const agent = metadataText(packet.metadata, "agent_id");
  const attempt = metadataInteger(packet.metadata, "attempt");
  if (agent !== auth.agentId || attempt !== auth.attempt)
    throw new HarnessError("INVALID_STATE", "packet publication identity changed");
  const taskId = packet.metadata.task_id;
  if (!["implementer", "repairer", "validator"].includes(role)) {
    if (taskId !== null)
      throw new HarnessError("INVALID_STATE", "run-level packet has a task association");
    if (role === "completeness-critic") {
      const critic = state.completion_critic;
      assertCriticIndependent(state, agent);
      if (critic) assertActiveCriticDeadline(critic.deadline_at, now.valueOf());
      if (
        !critic ||
        critic.critic_id !== agent ||
        critic.attempt !== attempt ||
        metadataText(packet.metadata, "readiness_sha256") !== critic.readiness_sha256 ||
        !sameRepositoryBinding(packet.metadata.repository_binding, critic.repository_binding) ||
        !["assigned", "packet_published"].includes(critic.status) ||
        !tokenMatches(auth.token, critic.token_digest)
      )
        throw new HarnessError("INVALID_STATE", "completeness critic authority changed");
      if (!sameRepositoryBinding(state.current_repository_binding, critic.repository_binding))
        throw new HarnessError(
          "INVALID_STATE",
          "repository bytes changed before critic packet publication",
        );
    }
    return;
  }
  if (typeof taskId !== "string" || !state.tasks[taskId])
    throw new HarnessError("INVALID_STATE", "packet task is not authoritative");
  const task = state.tasks[taskId]!;
  if (role === "validator") {
    if (
      task.status !== "validating" ||
      task.validation?.validator_id !== agent ||
      task.validation.attempt !== attempt ||
      Date.parse(task.validation.deadline_at) <= now.valueOf() ||
      !tokenMatches(auth.token, task.validation.token_digest)
    )
      throw new HarnessError("INVALID_STATE", "validator packet authority changed");
    return;
  }
  if (
    !["leased", "running"].includes(task.status) ||
    task.lease?.agent_id !== agent ||
    task.lease.role !== role ||
    task.lease.attempt !== attempt ||
    Date.parse(task.lease.expires_at) <= now.valueOf() ||
    !tokenMatches(auth.token, task.lease.token_digest)
  )
    throw new HarnessError("INVALID_STATE", "task packet authority changed");
}

export async function persistPacket(
  root: string,
  id: string,
  packet: BuiltPacket,
): Promise<string> {
  return createPacketBundle(root, id, packet, false).markdownPath;
}

export async function publishPacket(
  runRoot: string,
  id: string,
  packet: BuiltPacket,
  port: TransactionPort,
  authorization: PacketAuthorization,
  clock: Clock = systemClock,
): Promise<PublishedPacket> {
  const root = join(runRoot, "packets");
  const record = packetRecord(id, packet, clock.now());
  const existing = port.read().packets?.[id];
  if (existing) {
    const expected = {
      ...record,
      status: existing.status,
      published_at: existing.published_at,
    };
    if (
      !Buffer.from(canonicalJsonBytes(existing)).equals(Buffer.from(canonicalJsonBytes(expected)))
    )
      throw new HarnessError("INVALID_STATE", `packet registration differs: ${id}`);
    if (existing.agent_id !== authorization.agentId || existing.attempt !== authorization.attempt)
      throw new HarnessError("INVALID_STATE", "packet retry identity differs from publication");
    if (existing.status === "published")
      return { ...verifyPacketBundle(root, id, packet), record: existing };
  } else {
    authorize(port.read(), packet, authorization, clock.now());
    port.transact(
      authorization.agentId,
      "packet-prepared",
      { packet_id: id, packet_sha256: record.packet_sha256 },
      (draft) => {
        authorize(draft, packet, authorization, clock.now());
        draft.packets ??= {};
        if (draft.packets[id])
          throw new HarnessError("INVALID_STATE", `packet is already registered: ${id}`);
        draft.packets[id] = record;
      },
    );
  }
  const paths = createPacketBundle(root, id, packet, true);
  const state = port.transact(
    authorization.agentId,
    "packet-published",
    {
      packet_id: id,
      packet_sha256: record.packet_sha256,
      markdown_path: record.markdown_path,
      metadata_path: record.metadata_path,
    },
    (draft) => {
      authorize(draft, packet, authorization, clock.now());
      const prepared = draft.packets?.[id];
      if (
        !prepared ||
        prepared.status !== "preparing" ||
        prepared.packet_sha256 !== record.packet_sha256
      )
        throw new HarnessError("INTEGRITY", `packet preparation differs: ${id}`);
      prepared.status = "published";
      if (record.role === "completeness-critic") {
        draft.completion_critic!.status = "packet_published";
        draft.completion_critic!.packet_id = id;
        const historical = draft.completion_critic_history?.find(
          (entry) => entry.attempt === record.attempt && entry.critic_id === record.agent_id,
        );
        if (!historical)
          throw new HarnessError("INTEGRITY", "completion critic authorization history is missing");
        historical.status = "packet_published";
        historical.packet_id = id;
      }
    },
  );
  return { ...paths, record: state.packets![id]! };
}
