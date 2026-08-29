import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { CognitiveMemoryState, ActiveHypothesis, RoadmapItem, MacroMetrics } from "./types.ts";
import { resolveCognitiveMemoryPath, DEFAULT_COGNITIVE_MEMORY_FILE } from "./types.ts";

export function readCognitiveMemory(customPath?: string): CognitiveMemoryState {
  const filePath = resolveCognitiveMemoryPath(customPath);
  if (!existsSync(filePath)) {
    return {
      version: 1,
      last_updated: new Date().toISOString(),
      strategic_focus: [
        "Continuous Zero-Any & Zero-Suppression Assurance",
        "Charter Alignment & Macro DAG Work/Span (P = W/S) Optimization",
        "Autonomous Task Discovery & 1:1 Isolated Execution",
      ],
      active_hypotheses: [
        {
          id: "hyp-1-parallelism",
          statement:
            "Disjoint write scope partitioning maximizes effective parallelism P = W/S across 4 tiers without collision.",
          confidence: 0.95,
          status: "active",
          evidence: ["Topological wave planning resolves write scope collisions ahead of dispatch"],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      roadmaps: [
        {
          id: "roadmap-autonomous-fleet",
          title: "Autonomous Fleet Continuous Improvement",
          target_horizon: "Perpetual",
          milestones: [
            "Anti-batching 1:1 partitioning enforcement",
            "Generational state archival and lean queue maintenance",
            "Zero zombie accumulation across completed task logs",
          ],
          status: "active",
        },
      ],
      macro_metrics: {
        work: 10,
        span: 2,
        parallelism: 5,
        efficiency: 0.95,
      },
    };
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const version = typeof parsed["version"] === "number" ? parsed["version"] : 1;
    const lastUpdated =
      typeof parsed["last_updated"] === "string"
        ? parsed["last_updated"]
        : new Date().toISOString();
    const strategicFocus = Array.isArray(parsed["strategic_focus"])
      ? (parsed["strategic_focus"] as readonly string[])
      : [];
    const activeHypotheses = Array.isArray(parsed["active_hypotheses"])
      ? (parsed["active_hypotheses"] as readonly ActiveHypothesis[])
      : [];
    const roadmaps = Array.isArray(parsed["roadmaps"])
      ? (parsed["roadmaps"] as readonly RoadmapItem[])
      : [];
    const macroMetrics =
      typeof parsed["macro_metrics"] === "object" && parsed["macro_metrics"] !== null
        ? (parsed["macro_metrics"] as MacroMetrics)
        : undefined;
    const context =
      typeof parsed["context"] === "object" && parsed["context"] !== null
        ? (parsed["context"] as Readonly<Record<string, unknown>>)
        : undefined;

    return {
      version,
      last_updated: lastUpdated,
      strategic_focus: strategicFocus,
      active_hypotheses: activeHypotheses,
      roadmaps,
      ...(macroMetrics !== undefined ? { macro_metrics: macroMetrics } : {}),
      ...(context !== undefined ? { context } : {}),
    };
  } catch {
    return {
      version: 1,
      last_updated: new Date().toISOString(),
      strategic_focus: [],
      active_hypotheses: [],
      roadmaps: [],
    };
  }
}

export function writeCognitiveMemory(memory: CognitiveMemoryState, customPath?: string): void {
  const filePath = resolveCognitiveMemoryPath(customPath);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(memory, null, 2) + "\n", "utf8");
}

export function updateCognitiveMemory(
  updater: (current: CognitiveMemoryState) => CognitiveMemoryState,
  customPath?: string,
): CognitiveMemoryState {
  const current = readCognitiveMemory(customPath);
  const updated = updater(current);
  const stateToPersist: CognitiveMemoryState = {
    ...updated,
    last_updated: new Date().toISOString(),
  };
  writeCognitiveMemory(stateToPersist, customPath);
  return stateToPersist;
}
