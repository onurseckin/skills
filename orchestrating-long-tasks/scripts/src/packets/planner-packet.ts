import { join } from "node:path";
import { readRegularFileNoFollow } from "../core/no-follow.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { loadRun } from "../store/index.ts";
import { requireText } from "../workflow/task-state.ts";
import type { PublishedPacket } from "./persist-packet.ts";
import { publishPacket } from "./persist-packet.ts";
import { evidenceSchema } from "./evidence-schema.ts";
import { preplanPacketPort } from "./preplan-port.ts";
import { buildPacketFromPinnedRuntime } from "./render-packet.ts";
import {
  recordRepositoryInspection,
  repositoryInspectionContext,
} from "./repository-inspection.ts";

function decoded(path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(readRegularFileNoFollow(path));
  } catch (error) {
    throw new HarnessError("INTEGRITY", `planner packet asset is unreadable: ${String(error)}`);
  }
}

export async function initializePlannerPacket(
  runRoot: string,
  plannerId: string,
): Promise<PublishedPacket & { packet: Awaited<ReturnType<typeof buildPacketFromPinnedRuntime>> }> {
  plannerId = requireText(plannerId, "planner_id");
  recordRepositoryInspection(runRoot, plannerId, "baseline");
  const loaded = loadRun(runRoot);
  const port = preplanPacketPort(loaded.runRoot);
  const context = repositoryInspectionContext(loaded.state, false);
  const requirementsPath = join(loaded.runRoot, "planning", "requirements.json");
  const graphPath = join(loaded.runRoot, "planning", "graph.json");
  const runtime = join(loaded.runRoot, "runtime", "harness.ts");
  const packet = await buildPacketFromPinnedRuntime(loaded.runRoot, {
    runId: loaded.manifest.run_id,
    graphRevision: 0,
    role: "planner",
    agentId: plannerId,
    state: port.read(),
    roleInstructions: decoded(join(loaded.runRoot, "runtime", "assets", "planner.md")),
    authoritativeContext: {
      original_prompt: new TextDecoder("utf-8", { fatal: true }).decode(loaded.prompt),
      capture_manifest: structuredClone(loaded.manifest),
      ...context,
      expected_revision: 0,
    },
    evidenceSchema: evidenceSchema("planner"),
    planningWriteScope: [requirementsPath, graphPath],
    targetedCommands: [
      [
        "bun",
        runtime,
        "validate",
        "--run",
        loaded.runRoot,
        "--requirements",
        requirementsPath,
        "--graph",
        graphPath,
      ],
      [
        "bun",
        runtime,
        "plan-apply",
        "--run",
        loaded.runRoot,
        "--requirements",
        requirementsPath,
        "--graph",
        graphPath,
        "--expected-revision",
        "0",
        "--actor",
        plannerId,
      ],
    ],
    attempt: 1,
  });
  const published = await publishPacket(loaded.runRoot, "planner-0", packet, port, {
    agentId: plannerId,
    attempt: 1,
  });
  return { ...published, packet };
}
