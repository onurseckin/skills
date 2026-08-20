import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";
import type { CapsuleChainManifest, DefectSynthesis } from "./types.ts";
import type { Manifest, RunState } from "../contracts/capsule.ts";
import type { WorkflowState } from "../workflow/types.ts";

export interface ChainCapsulesOptions {
  readonly sourceRunId: string;
  readonly targetRunId: string;
  readonly sourceCapsulePath: string;
  readonly targetCapsulePath: string;
  readonly roundNumber: number;
  readonly defectSynthesis?: DefectSynthesis | undefined;
}

export function chainCapsules(options: ChainCapsulesOptions): CapsuleChainManifest {
  const {
    sourceRunId,
    targetRunId,
    sourceCapsulePath,
    targetCapsulePath,
    roundNumber,
    defectSynthesis,
  } = options;

  if (!existsSync(sourceCapsulePath)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Source capsule path does not exist: ${sourceCapsulePath}`,
    );
  }

  // Read source manifest
  const sourceManifestPath = join(sourceCapsulePath, "manifest.json");
  let previousEventHead: string | null = null;
  const carryoverRequirements: string[] = [];
  const unresolvedFindingIds: string[] = [];

  if (existsSync(sourceManifestPath)) {
    try {
      const rawManifest = readFileSync(sourceManifestPath, "utf-8");
      JSON.parse(rawManifest) as Manifest;
    } catch (err: unknown) {
      throw new HarnessError(
        "INTEGRITY",
        `Corrupt source manifest at ${sourceManifestPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Read source state to extract open requirements and event head
  const sourceStatePath = join(sourceCapsulePath, "state.json");
  if (existsSync(sourceStatePath)) {
    try {
      const rawState = readFileSync(sourceStatePath, "utf-8");
      const stateObj = JSON.parse(rawState) as RunState & Partial<WorkflowState>;
      previousEventHead = stateObj.event_head ?? null;

      if (stateObj.requirements && Array.isArray(stateObj.requirements)) {
        for (const req of stateObj.requirements) {
          if (req && typeof req === "object" && "id" in req && req.status !== "satisfied") {
            carryoverRequirements.push(String(req.id));
          }
        }
      }

      if (stateObj.tasks && typeof stateObj.tasks === "object") {
        for (const t of Object.values(stateObj.tasks)) {
          if (t && typeof t === "object" && "findings" in t && Array.isArray(t.findings)) {
            for (const f of t.findings) {
              if (f && typeof f === "object" && "id" in f && f.status !== "resolved") {
                unresolvedFindingIds.push(String(f.id));
              }
            }
          }
        }
      }
    } catch (err: unknown) {
      // Swallowing this would chain a round onto an unreadable capsule and report zero carryover
      // requirements and zero unresolved findings, which is a clean slate the harness never saw.
      throw new HarnessError(
        "INTEGRITY",
        `Corrupt source state at ${sourceStatePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // If defect synthesis provided additional unresolved findings, add them
  if (defectSynthesis && defectSynthesis.unresolvedFindings) {
    for (const f of defectSynthesis.unresolvedFindings) {
      if (!unresolvedFindingIds.includes(f.id)) {
        unresolvedFindingIds.push(f.id);
      }
      if (f.requirement_id && !carryoverRequirements.includes(f.requirement_id)) {
        carryoverRequirements.push(f.requirement_id);
      }
    }
  }

  // Ensure target capsule directory exists
  if (!existsSync(targetCapsulePath)) {
    mkdirSync(targetCapsulePath, { recursive: true });
  }

  const manifest: CapsuleChainManifest = {
    schema: "orchestrator.chain_manifest",
    version: 1,
    sourceRunId,
    targetRunId,
    sourceCapsulePath,
    targetCapsulePath,
    roundNumber,
    chainedAt: new Date().toISOString(),
    carryoverRequirements,
    unresolvedFindingIds,
    previousEventHead,
  };

  const chainManifestFile = join(targetCapsulePath, "chain_manifest.json");
  writeFileSync(chainManifestFile, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

  return manifest;
}
