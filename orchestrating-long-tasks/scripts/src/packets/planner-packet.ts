import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HarnessError } from "../errors/harness-error.ts";
import { loadRun } from "../store/index.ts";
import { requireText } from "../workflow/task-state.ts";
import type { PublishedPacket } from "./persist-packet.ts";
import { evidenceSchema } from "./evidence-schema.ts";
import { preplanPacketPort } from "./preplan-port.ts";
import { publishRolePacket } from "./publish-role-packet.ts";
import type { BuiltPacket } from "./types.ts";
import {
  recordRepositoryInspection,
  repositoryInspectionContext,
} from "./repository-inspection.ts";

export async function initializePlannerPacket(
  runRoot: string,
  plannerId: string,
  expectedRevision?: number,
): Promise<PublishedPacket & { packet: BuiltPacket }> {
  plannerId = requireText(plannerId, "planner_id");
  recordRepositoryInspection(runRoot, plannerId, "baseline");
  const loaded = loadRun(runRoot);
  const port = preplanPacketPort(loaded.runRoot);
  const liveRevision = port.read().graph_revision ?? 0;
  if (expectedRevision !== undefined && expectedRevision !== liveRevision) {
    throw new HarnessError(
      "INVALID_STATE",
      `graph revision is ${String(liveRevision)}, expected ${expectedRevision}`,
    );
  }
  const revision = expectedRevision ?? liveRevision;
  const context = repositoryInspectionContext(loaded.state, false);
  const requirementsPath = join(loaded.runRoot, "planning", "requirements.json");
  const graphPath = join(loaded.runRoot, "planning", "graph.json");
  const harnessScript = fileURLToPath(new URL("../../harness.ts", import.meta.url));
  return publishRolePacket(
    loaded.runRoot,
    "planner-0",
    {
      runId: loaded.manifest.run_id,
      graphRevision: revision,
      role: "planner",
      agentId: plannerId,
      state: port.read(),
      authoritativeContext: {
        original_prompt: new TextDecoder("utf-8", { fatal: true }).decode(loaded.prompt),
        capture_manifest: structuredClone(loaded.manifest),
        ...context,
        expected_revision: revision,
      },
      evidenceSchema: evidenceSchema("planner"),
      planningWriteScope: [requirementsPath, graphPath],
      targetedCommands: [
        ["bun", harnessScript, "plan:status", "--run", loaded.runRoot],
        [
          "bun",
          harnessScript,
          "plan:apply",
          "--run",
          loaded.runRoot,
          "--actor",
          plannerId,
          "--expected-revision",
          String(revision),
        ],
      ],
      attempt: 1,
    },
    port,
    { agentId: plannerId, attempt: 1 },
  );
}
