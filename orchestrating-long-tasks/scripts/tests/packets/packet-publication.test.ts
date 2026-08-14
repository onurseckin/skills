import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishPacket } from "../../src/packets/persist-packet.ts";
import { buildPacket } from "../../src/packets/render-packet.ts";
import { claimTask } from "../../src/workflow/lease/claim.ts";
import { tokenDigest } from "../../src/workflow/lease/token.ts";
import { completionReadinessSnapshot } from "../../src/workflow/completion/readiness-snapshot.ts";
import {
  at,
  commandRecord,
  repositoryBinding,
  TestPort,
  workflowState,
} from "../workflow/test-port.ts";
import { inspectionContext } from "./inspection-fixture.ts";

const bytes = new TextEncoder().encode("Canonical common instructions.\n");
const common = { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
const clock = at("2026-08-13T12:00:00.000Z");

function claimed() {
  const port = new TestPort(workflowState());
  const claim = claimTask(port, "T-1", "worker", "implementer", { clock });
  const packet = buildPacket({
    runId: "run-1",
    graphRevision: 1,
    role: "implementer",
    agentId: "worker",
    task: claim.state.tasks["T-1"],
    state: claim.state,
    commonInstructions: common,
    roleInstructions: "Implement the contract.",
    authoritativeContext: { original_prompt: "Implement R-1", ...inspectionContext() },
    evidenceSchema: { required: ["evidence"] },
    targetedCommands: [["bun", "test"]],
    leaseToken: claim.token,
    attempt: 1,
    clock,
  });
  return { port, claim, packet };
}

describe("durable packet publication", () => {
  test("atomically publishes the pair and registers immutable authoritative metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "packet-publication-"));
    const { port, claim, packet } = claimed();
    const published = await publishPacket(
      root,
      "implementer-1",
      packet,
      port,
      { agentId: "worker", token: claim.token, attempt: 1 },
      clock,
    );
    expect(await readFile(published.markdownPath, "utf8")).toBe(packet.markdown);
    expect(JSON.parse(await readFile(published.metadataPath, "utf8"))).toEqual(packet.metadata);
    expect(statSync(join(root, "packets", "implementer-1")).mode & 0o200).toBe(0o200);
    expect(statSync(published.markdownPath).mode & 0o222).toBe(0);
    expect(statSync(published.metadataPath).mode & 0o222).toBe(0);
    expect(port.read().packets?.["implementer-1"]).toMatchObject({
      status: "published",
      role: "implementer",
      task_id: "T-1",
      agent_id: "worker",
      packet_sha256: packet.metadata.packet_sha256,
    });
    expect(port.events.at(-1)).toMatchObject({ kind: "packet-published" });
    expect(port.events.filter((event) => event.kind === "packet-prepared")).toHaveLength(1);
  });

  test("retries the exact publication without a second event or overwrite", async () => {
    const root = await mkdtemp(join(tmpdir(), "packet-retry-"));
    const { port, claim, packet } = claimed();
    const authorization = { agentId: "worker", token: claim.token, attempt: 1 };
    const first = await publishPacket(root, "same", packet, port, authorization, clock);
    port.transact("test", "canonical-reload", {}, (draft) => {
      const entries = Object.entries(draft.packets!.same!).reverse();
      draft.packets!.same = Object.fromEntries(entries) as typeof draft.packets.same;
    });
    const second = await publishPacket(root, "same", packet, port, authorization, clock);
    expect(second).toEqual(first);
    expect(port.events.filter((event) => event.kind === "packet-published")).toHaveLength(1);
  });

  test("refuses a partial/conflicting pair without registering it", async () => {
    const root = await mkdtemp(join(tmpdir(), "packet-conflict-"));
    const { port, claim, packet } = claimed();
    await mkdir(join(root, "packets", "conflict"), { recursive: true });
    await writeFile(join(root, "packets", "conflict", "packet.md"), "spoof");
    await expect(
      publishPacket(
        root,
        "conflict",
        packet,
        port,
        { agentId: "worker", token: claim.token, attempt: 1 },
        clock,
      ),
    ).rejects.toBeDefined();
    expect(port.read().packets?.conflict?.status).toBe("preparing");
  });

  test("recovers an exact prepared packet after finalize transaction failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "packet-finalize-fault-"));
    const { port, claim, packet } = claimed();
    const authorization = { agentId: "worker", token: claim.token, attempt: 1 };
    port.failNext("packet-published");
    await expect(
      publishPacket(root, "recover", packet, port, authorization, clock),
    ).rejects.toThrow();
    expect(port.read().packets?.recover?.status).toBe("preparing");
    const recovered = await publishPacket(root, "recover", packet, port, authorization, clock);
    expect(recovered.record.status).toBe("published");
    expect(port.events.filter((event) => event.kind === "packet-prepared")).toHaveLength(1);
    expect(port.events.filter((event) => event.kind === "packet-published")).toHaveLength(1);
  });

  test("exact published retry survives the authorized task transition", async () => {
    const root = await mkdtemp(join(tmpdir(), "packet-transition-retry-"));
    const { port, claim, packet } = claimed();
    const authorization = { agentId: "worker", token: claim.token, attempt: 1 };
    const first = await publishPacket(root, "advanced", packet, port, authorization, clock);
    port.transact("worker", "task-advanced", {}, (draft) => {
      draft.tasks["T-1"]!.status = "submitted";
      delete draft.tasks["T-1"]!.lease;
    });
    expect(await publishPacket(root, "advanced", packet, port, authorization, clock)).toEqual(
      first,
    );
  });

  test("rejects publication after the lease expires", async () => {
    const root = await mkdtemp(join(tmpdir(), "packet-expired-"));
    const { port, claim, packet } = claimed();
    await expect(
      publishPacket(
        root,
        "expired",
        packet,
        port,
        { agentId: "worker", token: claim.token, attempt: 1 },
        at("2026-08-13T12:21:00.000Z"),
      ),
    ).rejects.toThrow();
    expect(port.read().packets?.expired).toBeUndefined();
  });

  test("reauthenticates against state at registration time", async () => {
    const root = await mkdtemp(join(tmpdir(), "packet-auth-race-"));
    const { port, claim, packet } = claimed();
    port.transact("test", "replace-token", {}, (draft) => {
      draft.tasks["T-1"]!.lease!.token_digest = "stale";
    });
    await expect(
      publishPacket(
        root,
        "stale",
        packet,
        port,
        { agentId: "worker", token: claim.token, attempt: 1 },
        clock,
      ),
    ).rejects.toBeDefined();
    expect(port.read().packets?.stale).toBeUndefined();
  });

  test("requires the assigned critic token and binds publication to that critic", async () => {
    const root = await mkdtemp(join(tmpdir(), "critic-publication-"));
    const port = new TestPort(workflowState());
    port.transact("coordinator", "command-recorded", {}, (draft) => {
      draft.commands["C-REPO"] = commandRecord("C-REPO", {
        task_id: null,
        actor: "coordinator",
      });
    });
    const criticToken = "critic-token";
    const criticState = port.read();
    const readiness = completionReadinessSnapshot(criticState, 1, "critic");
    port.transact("critic", "critic-assigned", {}, (draft) => {
      const authorization = {
        critic_id: "critic",
        token_digest: tokenDigest(criticToken),
        attempt: 1,
        status: "assigned" as const,
        started_at: clock.now().toISOString(),
        deadline_at: "2026-08-13T12:20:00.000Z",
        readiness_sha256: readiness.sha256,
        repository_binding: structuredClone(repositoryBinding),
      };
      draft.completion_critic = authorization;
      draft.completion_critic_history = [{ ...authorization }];
    });
    const assignment = { state: port.read(), token: criticToken };
    const packet = buildPacket({
      runId: "run-1",
      graphRevision: 1,
      role: "completeness-critic",
      agentId: "critic",
      state: assignment.state,
      commonInstructions: common,
      roleInstructions: "Audit the whole run.",
      authoritativeContext: {
        ...inspectionContext(),
        original_prompt: "Implement R-1",
        graph: { revision: 1 },
        plan_history: [{ revision: 1 }],
        integrity_evidence: [{ status: "passed", event_head: "abc" }],
        repository_evidence: { command_ids: ["C-REPO"] },
      },
      evidenceSchema: { required: ["status"] },
      targetedCommands: [["git", "status", "--short"]],
      leaseToken: assignment.token,
      attempt: 1,
      clock,
    });
    await expect(
      publishPacket(
        root,
        "critic-1",
        packet,
        port,
        { agentId: "critic", token: "wrong", attempt: 1 },
        clock,
      ),
    ).rejects.toBeDefined();
    await publishPacket(
      root,
      "critic-1",
      packet,
      port,
      { agentId: "critic", token: assignment.token, attempt: 1 },
      clock,
    );
    expect(port.read().completion_critic).toMatchObject({
      critic_id: "critic",
      status: "packet_published",
      packet_id: "critic-1",
      readiness_sha256: readiness.sha256,
    });
    expect(port.read().packets?.["critic-1"]?.readiness_sha256).toBe(readiness.sha256);
    expect(port.read().packets?.["critic-1"]?.repository_binding).toEqual(repositoryBinding);
  });
});
