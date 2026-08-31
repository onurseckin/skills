import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPacket } from "../../../../olt/scripts/src/packets/render-packet.ts";
import {
  createPacketBundle,
  verifyPacketBundle,
} from "../../../../olt/scripts/src/packets/packet-bundle.ts";
import {
  isolateValidatorContext,
  excludeValidatorContamination,
  VALIDATOR_EXCLUSIONS,
} from "../../../../olt/scripts/src/packets/validator-context.ts";
import { evidenceSchema } from "../../../../olt/scripts/src/packets/evidence-schema.ts";
import { loadRoleContract } from "../../../../olt/scripts/src/packets/role-contract.ts";
import { claimTask } from "../../../../olt/scripts/src/workflow/lease/claim.ts";
import { at, TestPort, workflowState } from "../../../workflow/test-port.ts";
import { getCapsuleCliCommands } from "../../../../olt/scripts/src/packets/capsule-memory.ts";
import { inspectionContext } from "../slicing/inspection-fixture.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots.length = 0;
});

const clock = at("2026-08-13T12:00:00.000Z");
const commonBytes = new TextEncoder().encode("Canonical common instructions for tests.\n");
const commonSha256 = createHash("sha256").update(commonBytes).digest("hex");

function baseTaskState() {
  const port = new TestPort(workflowState());
  const claim = claimTask(port, "T-1", "worker-1", "implementer", { clock });
  return {
    state: claim.state,
    token: claim.token,
  };
}

describe("Decoupled Capsule Memory - Bundle Storage", () => {
  describe("Packet Bundle Storage & Metadata Decoupling", () => {
    test("createPacketBundle writes packet.md and metadata.json as decoupled files", async () => {
      const root = await mkdtemp(join(tmpdir(), "packet-bundle-test-"));
      roots.push(root);

      const { state, token } = baseTaskState();
      const built = buildPacket({
        runId: "run-bundle",
        graphRevision: 1,
        role: "implementer",
        agentId: "worker-1",
        attempt: 1,
        state,
        task: state.tasks["T-1"],
        commonInstructions: { bytes: commonBytes, sha256: commonSha256 },
        evidenceSchema: evidenceSchema("implementer"),
        targetedCommands: [["bun", "test"]],
        leaseToken: token,
        clock,
        authoritativeContext: { ...inspectionContext() },
      });

      const paths = createPacketBundle(root, "packet-impl-1", built, false);
      expect(paths.markdownPath).toBe(join(root, "packet-impl-1", "packet.md"));
      expect(paths.metadataPath).toBe(join(root, "packet-impl-1", "metadata.json"));

      const readMarkdown = await readFile(paths.markdownPath, "utf-8");
      const readMetadataJson = JSON.parse(await readFile(paths.metadataPath, "utf-8"));

      expect(readMarkdown).toBe(built.markdown);
      expect(readMetadataJson).toEqual(built.metadata);

      // Verify bundle verification passes
      const verified = verifyPacketBundle(root, "packet-impl-1", built);
      expect(verified).toEqual(paths);
    });

    test("createPacketBundle enforces immutability and rejects mutation attempts", async () => {
      const root = await mkdtemp(join(tmpdir(), "packet-immutability-"));
      roots.push(root);

      const { state, token } = baseTaskState();
      const built1 = buildPacket({
        runId: "run-bundle",
        graphRevision: 1,
        role: "implementer",
        agentId: "worker-1",
        attempt: 1,
        state,
        task: state.tasks["T-1"],
        commonInstructions: { bytes: commonBytes, sha256: commonSha256 },
        evidenceSchema: evidenceSchema("implementer"),
        targetedCommands: [["bun", "test"]],
        leaseToken: token,
        clock,
        authoritativeContext: { ...inspectionContext() },
      });

      createPacketBundle(root, "packet-static-1", built1, false);

      const built2 = {
        markdown: built1.markdown + "\nMutated content",
        metadata: { ...built1.metadata, version: 2 },
      };

      // Attempting to overwrite existing bundle with different content must throw
      expect(() => createPacketBundle(root, "packet-static-1", built2, false)).toThrow(
        /already exists/u,
      );
      expect(() => createPacketBundle(root, "packet-static-1", built2, true)).toThrow(
        /already exists/u,
      );
    });
  });
});

