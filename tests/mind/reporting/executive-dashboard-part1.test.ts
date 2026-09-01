import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExecutiveDashboardEngine,
  createInitialDashboardState,
  renderDashboardMarkdown,
  writeDashboardFiles,
  writeDashboardFilesSync,
  readDashboardState,
  readDashboardStateSync,
  updateDashboardSection,
  calculateUptimeString,
  computeTrackCompletion,
  computeOverallRoadmapProgress,
  CANONICAL_BEDROCK_INVARIANTS,
  DEFAULT_PRODUCT_CRAFT_PILLARS,
  type ExecutiveDashboardState,
  type ParetoArbitrationDecisionRecord,
  type BedrockInvariantRecord,
  type RoadmapDeliverableTask,
} from "../../../olt/scripts/src/mind/reporting/index.ts";


