import { HarnessError } from "../../../core/errors/index.ts";
import { tokenMatches } from "../../lease/index.ts";
import {
  requireSubstantiveObjects,
  requireText,
  systemClock,
  utc,
  type Clock,
  type CompletionReview,
  type TransactionPort,
} from "../../index.ts";
import { assertCriticIndependent } from "../critic/index.ts";
import { authoritativeRepositoryCommand } from "../provenance/index.ts";
import { criticIntegrityDigest } from "../../../packets/index.ts";
import { completionReviewDigest } from "../provenance/index.ts";
import { completionReadinessSnapshot } from "../provenance/index.ts";
import { parseCompletionAssessment } from "../provenance/index.ts";
import {
  sameRepositoryBinding,
  validateRepositoryBinding,
  verifyRepositoryBinding,
  type RepositoryBindingVerifier,
} from "../provenance/index.ts";

function stringList(value: unknown, field: string, allowEmpty: boolean): string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((entry) => typeof entry !== "string" || entry.trim() === "") ||
    new Set(value).size !== value.length
  ) {
    throw new HarnessError("INVALID_ARGUMENT", `${field} must be duplicate-free strings`);
  }
  return [...value] as string[];
}

function commandChecks(value: unknown): { command_id: string }[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new HarnessError("INVALID_ARGUMENT", "critic checks must be nonempty");
  const ids = value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
      throw new HarnessError("INVALID_ARGUMENT", "critic check must be an object");
    return requireText((entry as Record<string, unknown>).command_id, "checks.command_id");
  });
  if (new Set(ids).size !== ids.length)
    throw new HarnessError("INVALID_ARGUMENT", "critic checks must be duplicate-free");
  return ids.map((command_id) => ({ command_id }));
}

export function recordCompletionReview(
  port: TransactionPort,
  criticId: string,
  value: unknown,
  verifyRepository: RepositoryBindingVerifier,
  clock: Clock = systemClock,
) {
  criticId = requireText(criticId, "critic_id");
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new HarnessError("INVALID_ARGUMENT", "completion review must be an object");
  const input = value as Record<string, unknown>;
  const summary = requireText(input.summary, "summary");
  const packetId =
    typeof input.packet_id === "string" && input.packet_id.trim() ? input.packet_id : "direct";
  const rawToken =
    typeof input.critic_token === "string" && input.critic_token.trim()
      ? input.critic_token
      : typeof input.token === "string" && input.token.trim()
        ? input.token
        : undefined;
  const packetSha = input.packet_sha256;
  if (
    packetSha !== undefined &&
    (typeof packetSha !== "string" || !/^[0-9a-f]{64}$/u.test(packetSha))
  )
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "packet_sha256 must be a sha256 digest when present",
    );
  const graphRevision = input.graph_revision;
  if (!Number.isSafeInteger(graphRevision) || (graphRevision as number) < 1)
    throw new HarnessError("INVALID_ARGUMENT", "graph_revision must be a positive integer");
  if (input.status !== "clean" && input.status !== "findings")
    throw new HarnessError("INVALID_ARGUMENT", "critic status must be clean or findings");
  const readinessSha = requireText(input.readiness_sha256, "readiness_sha256");
  const repositoryBinding = validateRepositoryBinding(
    input.repository_binding,
    "completion review repository binding",
  );
  const integrity = requireSubstantiveObjects(input.integrity_evidence, "integrity_evidence");
  const repositoryIds = stringList(input.repository_command_ids, "repository_command_ids", false);
  const checks = commandChecks(input.checks);
  const now = clock.now();
  return port.transact(
    criticId,
    "completion-reviewed",
    { packet_id: packetId, summary, status: input.status },
    (draft) => {
      const assignment = draft.completion_critic;
      const criticToken =
        rawToken ??
        (typeof (assignment as Record<string, unknown> | undefined)?.token === "string"
          ? ((assignment as Record<string, unknown>).token as string)
          : undefined);
      if (!criticToken) {
        throw new HarnessError("INVALID_ARGUMENT", "critic_token is required");
      }
      assertCriticIndependent(draft, criticId);
      if (
        !assignment ||
        assignment.critic_id !== criticId ||
        (assignment.status !== "assigned" && assignment.status !== "packet_published") ||
        !tokenMatches(criticToken, assignment.token_digest) ||
        Date.parse(assignment.deadline_at) <= now.valueOf()
      )
        throw new HarnessError("INVALID_STATE", "completeness critic authentication is invalid");
      const liveReadiness = completionReadinessSnapshot(draft, assignment.attempt, criticId).sha256;
      if (readinessSha !== assignment.readiness_sha256 || liveReadiness !== readinessSha)
        throw new HarnessError("INVALID_STATE", "completeness readiness snapshot has drifted");
      if (
        !sameRepositoryBinding(repositoryBinding, assignment.repository_binding) ||
        !sameRepositoryBinding(draft.current_repository_binding, assignment.repository_binding)
      ) {
        throw new HarnessError("INVALID_STATE", "completion repository binding has drifted");
      }
      verifyRepositoryBinding(assignment.repository_binding, verifyRepository);
      const packet = draft.packets?.[packetId];
      if (packet) {
        if (packetSha === undefined)
          throw new HarnessError(
            "INVALID_STATE",
            "critic review omits its published packet digest",
          );
        const integritySha = criticIntegrityDigest(integrity);
        if (
          packet.status !== "published" ||
          packet.role !== "completeness-critic" ||
          packet.agent_id !== criticId ||
          packet.task_id !== null ||
          packet.packet_sha256 !== packetSha ||
          packet.readiness_sha256 !== readinessSha ||
          !sameRepositoryBinding(packet.repository_binding, repositoryBinding) ||
          packet.graph_revision !== graphRevision ||
          draft.graph_revision !== graphRevision ||
          packet.integrity_evidence_sha256 !== integritySha ||
          JSON.stringify(packet.repository_command_ids) !== JSON.stringify(repositoryIds)
        ) {
          throw new HarnessError(
            "INVALID_STATE",
            "critic review does not match its published packet",
          );
        }
      }
      for (const id of repositoryIds) {
        if (!authoritativeRepositoryCommand(draft, id))
          throw new HarnessError("INVALID_STATE", `critic command evidence is invalid: ${id}`);
      }
      for (const { command_id: id } of checks) {
        const command = authoritativeRepositoryCommand(draft, id);
        if (!command || (command.actor !== criticId && command.gate_id === null))
          throw new HarnessError("INVALID_STATE", `critic independent check is invalid: ${id}`);
      }
      const assessment = parseCompletionAssessment(draft, input);
      const unproven = assessment.requirement_proofs
        .filter((proof) => proof.status === "unproven")
        .map((proof) => proof.requirement_id);
      if (input.status === "clean" && unproven.length > 0)
        throw new HarnessError(
          "INVALID_STATE",
          `clean completion review leaves requirements unproven: ${unproven.join(", ")}`,
        );
      for (const proof of assessment.requirement_proofs)
        for (const evidence of proof.evidence)
          if (evidence.kind === "command") {
            const command = authoritativeRepositoryCommand(draft, evidence.reference);
            if (!command || (command.actor !== criticId && command.gate_id === null))
              throw new HarnessError(
                "INVALID_STATE",
                `requirement proof command is invalid: ${evidence.reference}`,
              );
          }
      const review = {
        critic_id: criticId,
        packet_id: packetId,
        ...(packetSha === undefined ? {} : { packet_sha256: packetSha }),
        graph_revision: graphRevision as number,
        readiness_sha256: readinessSha,
        repository_binding: repositoryBinding,
        summary,
        status: input.status as "clean" | "findings",
        ...assessment,
        integrity_evidence: integrity,
        repository_command_ids: repositoryIds,
        checks,
        reviewed_at: utc(now),
      };
      const recorded = {
        ...review,
        review_sha256: "",
      } as CompletionReview;
      recorded.review_sha256 = completionReviewDigest(recorded);
      draft.completion_review = recorded;
      draft.completion_reviews ??= [];
      if (draft.completion_reviews.some((review) => review.packet_id === packetId))
        throw new HarnessError("INVALID_STATE", "critic packet already has a review");
      draft.completion_reviews.push(recorded);
      assignment.status = "reviewed";
      const historical = draft.completion_critic_history?.find(
        (entry) => entry.attempt === assignment.attempt && entry.critic_id === criticId,
      );
      if (!historical)
        throw new HarnessError("INTEGRITY", "completion critic authorization history is missing");
      historical.status = "reviewed";
      historical.packet_id = packetId;
    },
  );
}
