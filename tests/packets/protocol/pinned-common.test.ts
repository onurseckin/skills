import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  loadCommonInstructions,
  verifyCommonInstructions,
} from "../../../olt/scripts/src/packets/common-instructions.ts";
import { buildPacketFromPinnedRuntime } from "../../../olt/scripts/src/packets/render-packet.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { workflowState } from "../../workflow/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

const vfs = new VirtualMemoryFS();
const session = createVirtualFSSession(vfs);

afterAll(() => {
  session.cleanup();
  vfs.reset();
});

async function fixtureRun() {
  const root = `/virtual/packet-common-${Math.random().toString(36).slice(2)}`;
  const repo = join(root, "repo");
  vfs.mkdirSync(repo, { recursive: true });
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
