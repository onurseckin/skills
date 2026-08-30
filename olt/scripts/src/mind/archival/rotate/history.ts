import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadRun } from "../../../engine/store/index.ts";

export interface GenerationLineageNode {
  readonly runId: string;
  readonly capsulePath: string;
  readonly generation: number;
  readonly sealedAt: string | null;
  readonly eventHead: string | null;
}

export interface RotationMetadata {
  readonly generation: number;
  readonly isRotated: boolean;
  readonly rotatedAt: string | null;
  readonly previousGeneration: {
    readonly runId: string;
    readonly eventHead: string | null;
    readonly sealedAt: string | null;
  } | null;
  readonly nextGeneration: {
    readonly runId: string;
    readonly generation: number;
    readonly rotatedAt: string;
  } | null;
}

export function readRotationMetadata(capsulePath: string): RotationMetadata | null {
  if (!existsSync(capsulePath) || !lstatSync(capsulePath).isDirectory()) {
    return null;
  }
  try {
    const loaded = loadRun(capsulePath, false);
    const state = loaded.state as Record<string, unknown>;
    const mind = state["mind"] as Record<string, unknown> | undefined;
    if (!mind || typeof mind !== "object") return null;

    const generation = typeof mind["generation"] === "number" ? mind["generation"] : 1;
    const isRotated = mind["status"] === "rotated";
    const rotatedAt = typeof mind["rotated_at"] === "string" ? mind["rotated_at"] : null;

    const prev = mind["previous_generation"] as Record<string, unknown> | undefined;
    const previousGeneration =
      prev && typeof prev["run_id"] === "string"
        ? {
            runId: prev["run_id"],
            eventHead: typeof prev["event_head"] === "string" ? prev["event_head"] : null,
            sealedAt: typeof prev["sealed_at"] === "string" ? prev["sealed_at"] : null,
          }
        : null;

    const next = mind["next_generation"] as Record<string, unknown> | undefined;
    const nextGeneration =
      next && typeof next["run_id"] === "string" && typeof next["generation"] === "number"
        ? {
            runId: next["run_id"],
            generation: next["generation"],
            rotatedAt: typeof next["rotated_at"] === "string" ? next["rotated_at"] : "",
          }
        : null;

    return {
      generation,
      isRotated,
      rotatedAt,
      previousGeneration,
      nextGeneration,
    };
  } catch {
    return null;
  }
}

export function getGenerationLineage(
  capsulePath: string,
  maxDepth: number = 50,
): readonly GenerationLineageNode[] {
  const lineage: GenerationLineageNode[] = [];
  const visited = new Set<string>();
  let currentPath: string | null = existsSync(capsulePath) ? realpathSync(capsulePath) : null;

  while (currentPath && lineage.length < maxDepth && !visited.has(currentPath)) {
    visited.add(currentPath);
    const meta = readRotationMetadata(currentPath);
    if (!meta) break;

    const loaded = loadRun(currentPath, false);
    const runId = loaded.manifest.run_id || dirname(currentPath);

    lineage.push({
      runId,
      capsulePath: currentPath,
      generation: meta.generation,
      sealedAt: meta.rotatedAt,
      eventHead: meta.previousGeneration?.eventHead ?? null,
    });

    if (meta.previousGeneration?.runId) {
      const parentDir = dirname(currentPath);
      const prevPath = join(parentDir, meta.previousGeneration.runId);
      if (existsSync(prevPath) && lstatSync(prevPath).isDirectory()) {
        currentPath = realpathSync(prevPath);
      } else {
        break;
      }
    } else {
      break;
    }
  }

  return lineage;
}
