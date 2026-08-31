import type { CapsuleSpec } from "../../../olt/scripts/src/orchestrator/multi-capsule.ts";
import type { SynthesizedTaskSpec } from "../../../olt/scripts/src/orchestrator/topology/types.ts";

export function createSampleCapsuleSpecs(): readonly CapsuleSpec[] {
  return [
    { id: "cap-alpha", repoPath: "/repo", writeScope: ["src/alpha/"] },
    { id: "cap-beta", repoPath: "/repo", writeScope: ["src/beta/"] },
    { id: "cap-gamma", repoPath: "/repo", writeScope: ["src/gamma/"] },
  ];
}

export function createSampleTaskSpecs(): readonly SynthesizedTaskSpec[] {
  return [
    { id: "task-a", writeScope: ["src/a.ts"], effort: 2 },
    { id: "task-b", writeScope: ["src/b.ts"], effort: 3 },
    { id: "task-c", writeScope: ["src/c.ts"], effort: 1 },
  ];
}
