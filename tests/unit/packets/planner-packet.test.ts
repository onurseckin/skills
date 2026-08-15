import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initializePlannerPacket } from "../../../orchestrating-long-tasks/scripts/src/packets/planner-packet.ts";
import { initRun, loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";

const roots: string[] = [];
const scriptsRoot = fileURLToPath(
  new URL("../../../orchestrating-long-tasks/scripts", import.meta.url),
);

function makeWritable(path: string): void {
  try {
    chmodSync(path, 0o777);
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const nested = join(path, entry.name);
      if (entry.isDirectory()) makeWritable(nested);
      else chmodSync(nested, 0o666);
    }
  } catch {}
}

afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => {
      makeWritable(root);
      return rm(root, { recursive: true, force: true });
    }),
  ),
);

describe("pre-plan planner packet", () => {
  test("is usable and durably registered at graph revision zero", async () => {
    const repo = await mkdtemp(join(tmpdir(), "planner-packet-"));
    roots.push(repo);
    const prompt = "Build the requested system";
    const run = initRun(repo, "planner-run", new TextEncoder().encode(prompt), "file", true, {
      runtimeSource: scriptsRoot,
    });
    const first = await initializePlannerPacket(run, "planner");
    expect(first.record).toMatchObject({
      id: "planner-0",
      status: "published",
      role: "planner",
      graph_revision: 0,
    });
    expect(await readFile(first.markdownPath, "utf8")).toContain(prompt);
    expect(await readFile(first.markdownPath, "utf8")).toContain("baseline_repository_state");
    expect(await readFile(first.markdownPath, "utf8")).toContain(
      join(run, "planning", "requirements.json"),
    );
    expect(loadRun(run).state.packets).toMatchObject({
      "planner-0": { graph_revision: 0, status: "published" },
    });
    const retried = await initializePlannerPacket(run, "planner");
    expect(retried).toEqual(first);
    expect(loadRun(run).events.filter(({ kind }) => kind === "packet-published")).toHaveLength(1);
  });
});
