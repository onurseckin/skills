import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCommonInstructions } from "../../orchestrating-long-tasks/scripts/src/packets/common-instructions.ts";
import { buildPacketFromPinnedRuntime } from "../../orchestrating-long-tasks/scripts/src/packets/render-packet.ts";
import { initRun } from "../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { workflowState } from "../workflow/test-port.ts";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

async function pinnedRun() {
  const root = await mkdtemp(join(tmpdir(), "packet-pinned-common-"));
  roots.push(root);
  const repo = join(root, "repo");
  const runtime = join(root, "runtime");
  await mkdir(join(runtime, "assets"), { recursive: true });
  await mkdir(join(runtime, "src", "config"), { recursive: true });
  await mkdir(repo);
  const bytes = new TextEncoder().encode("Pinned common instructions.\n");
  await writeFile(join(runtime, "assets", "common-instructions.md"), bytes);
  await writeFile(join(runtime, "harness.ts"), "#!/usr/bin/env bun\n");
  await writeFile(
    join(runtime, "src", "config", "constants.ts"),
    'export const RUNTIME_VERSION = "test-runtime";\n',
  );
  return {
    bytes,
    run: initRun(repo, "packet-run", new TextEncoder().encode("prompt"), "file", true, {
      runtimeSource: runtime,
    }),
  };
}

describe("pinned common packet instructions", () => {
  test("loads only from an integrity-verified pinned runtime", async () => {
    const fixture = await pinnedRun();
    const loaded = await loadCommonInstructions(fixture.run);
    expect(loaded.bytes).toEqual(fixture.bytes);
    await writeFile(join(fixture.run, "runtime", "assets", "common-instructions.md"), "tampered\n");
    await expect(loadCommonInstructions(fixture.run)).rejects.toThrow();
  });

  test("constructs production packets through the pinned loader", async () => {
    const fixture = await pinnedRun();
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
    expect(packet.markdown).toContain("Pinned common instructions.");
  });
});
