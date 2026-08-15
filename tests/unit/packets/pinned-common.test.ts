import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadCommonInstructions,
  verifyCommonInstructions,
} from "../../../orchestrating-long-tasks/scripts/src/packets/common-instructions.ts";
import { buildPacketFromPinnedRuntime } from "../../../orchestrating-long-tasks/scripts/src/packets/render-packet.ts";
import { initRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { workflowState } from "../workflow/test-port.ts";

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
  });

  test("constructs production packets embedding canonical instructions", async () => {
    const fixture = await fixtureRun();
    const packet = await buildPacketFromPinnedRuntime(fixture.run, {
      runId: "packet-run",
      graphRevision: 1,
      role: "planner",
      agentId: "planner",
      state: workflowState(),
      roleInstructions: "Plan exact requirements.",
      authoritativeContext: { original_prompt: "prompt" },
      evidenceSchema: { required: ["requirements"] },
      targetedCommands: [],
      attempt: 1,
    });
    expect(packet.markdown).toContain("Common agent instructions");
  });
});
