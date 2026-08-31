import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadCommonInstructions,
  verifyCommonInstructions,
} from "../../../olt/scripts/src/packets/common-instructions.ts";
import { buildPacketFromPinnedRuntime } from "../../../olt/scripts/src/packets/render-packet.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { workflowState } from "../../workflow/test-port.ts";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

async function fixtureRun() {
  const root = await mkdtemp(join(tmpdir(), "packet-common-"));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo);
  return {
    run: initRun(repo, "packet-run", new TextEncoder().encode("prompt"), "file", true),
  };
}

describe("canonical common packet instructions", () => {
  test("loads and verifies canonical common instructions", async () => {
    const fixture = await fixtureRun();
    const loaded = await loadCommonInstructions(fixture.run);
    expect(loaded.bytes.byteLength).toBeGreaterThan(0);
    expect(loaded.sha256).toBeDefined();
    expect(() =>
      verifyCommonInstructions({ bytes: new Uint8Array([0]), sha256: "invalid" }),
    ).toThrow();
    // A lone UTF-8 continuation byte is never valid on its own — TextDecoder's fatal mode
    // rejects it, distinct from the digest-mismatch throw exercised just above.
    expect(() =>
      verifyCommonInstructions({ bytes: new Uint8Array([0x80]), sha256: "irrelevant" }),
    ).toThrow("common instructions are not valid UTF-8");
  });

  test("rejects common instructions that decode to nothing but whitespace", () => {
    const bytes = new TextEncoder().encode("   \n\t  ");
    expect(() =>
      verifyCommonInstructions({
        bytes,
        sha256: "0".repeat(64), // wrong on purpose: the emptiness check must fire first
      }),
    ).toThrow("common instructions must not be empty");
  });

  test("constructs production packets embedding canonical instructions", async () => {
    const fixture = await fixtureRun();
    const packet = await buildPacketFromPinnedRuntime(fixture.run, {
      runId: "packet-run",
      graphRevision: 1,
      role: "planner",
      agentId: "planner",
      state: workflowState(),
      authoritativeContext: { original_prompt: "prompt" },
      evidenceSchema: { required: ["requirements"] },
      targetedCommands: [],
      attempt: 1,
    });
    expect(packet.metadata.common_instructions_sha256).toBeDefined();
    expect(packet.markdown).toContain("# planner packet");
    expect(packet.markdown).toContain("Actionable Task Checklist");
  });
});
