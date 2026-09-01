import { describe, expect, it } from "bun:test";
import {
  DEFICIT_CRITICALITY_CLASSES,
  DIAGNOSTIC_ERROR_KINDS,
  DEFAULT_KNOWN_SUBSYSTEMS,
  inferSubsystemFromPath,
  extractStackFrames,
  computeStackSignature,
  parseRawDiagnostics,
  clusterDiagnosticErrors,
  runEmpiricalBaselineProbes,
  formatDeficitTopologyMatrixMarkdown,
  DiagnosticClusteringEngine,
  type DeficitTopologyMatrix,
  type ParsedDiagnosticError,
} from "../../../../olt/scripts/src/mind/defects/index.ts";
