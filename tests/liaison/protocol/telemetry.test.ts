import { describe, expect, it } from "bun:test";
import {
  computeAgentTypeCounts,
  computeDistinctImplementerCount,
  createExecutionTelemetry,
  detectTelemetryAnomalies,
  extractImplementerIds,
  filterArtefactsByClass,
  groupArtefactsByClass,
  hasArtefactClass,
  isExecutionTelemetry,
  parseTelemetry,
  serializeTelemetry,
} from "../../../olt/scripts/src/liaison/protocol/telemetry.ts";
import type {
  AgentRoster,
  EvidenceArtefact,
} from "../../../olt/scripts/src/liaison/protocol/types.ts";

describe("Execution telemetry schema & discrepancy detection", () => {
  const sampleRoster: AgentRoster = {
    implementer: ["implementer_task-1", "implementer_task-2", "implementer_task-1"], // 2 distinct
    validator: ["validator_task-1", "validator_task-2"],
    coordinator: ["coordinator_main"],
  };

  const sampleEvidence: readonly EvidenceArtefact[] = [
    {
      artefact_class: "dom_metrics",
      path: "evidence/dom-metrics.json",
      size_bytes: 4096,
    },
    {
      artefact_class: "optical_critique",
      path: "evidence/optical-critique.md",
      description: "Visual analysis of modal layout",
    },
    {
      artefact_class: "unit_test_log",
      path: "evidence/test-results.xml",
    },
  ];

  describe("Agent roster calculations", () => {
    it("computes distinct agent counts by type", () => {
      const counts = computeAgentTypeCounts(sampleRoster);
      expect(counts.implementer).toBe(2);
      expect(counts.validator).toBe(2);
      expect(counts.coordinator).toBe(1);
    });

    it("extracts unique implementer ids and counts", () => {
      const ids = extractImplementerIds(sampleRoster);
      expect(ids).toEqual(["implementer_task-1", "implementer_task-2"]);
      expect(computeDistinctImplementerCount(sampleRoster)).toBe(2);
    });
  });

  describe("Telemetry creation, serialization and validation", () => {
    it("creates, serializes, and parses structured telemetry", () => {
      const telemetry = createExecutionTelemetry({
        run_id: "run-wave-45",
        wave_id: "wave-45",
        distinct_agents_by_type: sampleRoster,
        lane_count: 2,
        evidence_artefacts: sampleEvidence,
        browser_sessions: { opened: 5, closed: 5, active: 0 },
      });

      expect(telemetry.run_id).toBe("run-wave-45");
      expect(telemetry.wave_id).toBe("wave-45");
      expect(telemetry.distinct_implementer_count).toBe(2);
      expect(isExecutionTelemetry(telemetry)).toBe(true);

      const serialized = serializeTelemetry(telemetry);
      const deserialized = parseTelemetry(serialized);
      expect(deserialized.run_id).toBe(telemetry.run_id);
      expect(deserialized.lane_count).toBe(2);
      expect(deserialized.evidence_artefacts).toHaveLength(3);
    });

    it("throws on invalid deserialization input", () => {
      expect(() => parseTelemetry('{"invalid": true}')).toThrow("Invalid telemetry payload");
    });
  });

  describe("Serial execution anomaly detection (Forensics §2.9)", () => {
    it("exposes serial execution when lane count exceeds distinct implementers", () => {
      // Forensics §2.9: 1 implementer identity serving 4 disjoint lanes
      const serialTelemetry = createExecutionTelemetry({
        run_id: "run-wave-44",
        distinct_agents_by_type: {
          implementer: ["implementer_solo"],
        },
        lane_count: 4,
        distinct_implementer_count: 1,
        evidence_artefacts: sampleEvidence,
        browser_sessions: { opened: 2, closed: 2, active: 0 },
      });

      const anomalies = detectTelemetryAnomalies(serialTelemetry);
      const serialAnomaly = anomalies.find((a) => a.type === "SERIAL_EXECUTION_DETECTED");

      expect(serialAnomaly).toBeDefined();
      expect(serialAnomaly?.severity).toBe("ERROR");
      expect(serialAnomaly?.details.lane_count).toBe(4);
      expect(serialAnomaly?.details.distinct_implementer_count).toBe(1);
      expect(serialAnomaly?.details.deficit).toBe(3);
    });

    it("does not flag serial anomaly when distinct implementers match lane count", () => {
      const parallelTelemetry = createExecutionTelemetry({
        run_id: "run-wave-46",
        distinct_agents_by_type: {
          implementer: ["imp-1", "imp-2", "imp-3"],
        },
        lane_count: 3,
        distinct_implementer_count: 3,
        evidence_artefacts: sampleEvidence,
        browser_sessions: { opened: 3, closed: 3, active: 0 },
      });

      const anomalies = detectTelemetryAnomalies(parallelTelemetry);
      const serialAnomaly = anomalies.find((a) => a.type === "SERIAL_EXECUTION_DETECTED");
      expect(serialAnomaly).toBeUndefined();
    });
  });

  describe("Browser session leak detection", () => {
    it("detects orphaned unclosed browser sessions", () => {
      const leakyTelemetry = createExecutionTelemetry({
        run_id: "run-ui-1",
        distinct_agents_by_type: sampleRoster,
        lane_count: 2,
        evidence_artefacts: sampleEvidence,
        browser_sessions: { opened: 12, closed: 8, active: 4 },
      });

      const anomalies = detectTelemetryAnomalies(leakyTelemetry);
      const leakAnomaly = anomalies.find((a) => a.type === "BROWSER_SESSION_LEAK");

      expect(leakAnomaly).toBeDefined();
      expect(leakAnomaly?.severity).toBe("WARNING");
      expect(leakAnomaly?.details.unclosed).toBe(4);
    });

    it("passes when all browser sessions are closed", () => {
      const cleanTelemetry = createExecutionTelemetry({
        run_id: "run-ui-2",
        distinct_agents_by_type: sampleRoster,
        lane_count: 2,
        evidence_artefacts: sampleEvidence,
        browser_sessions: { opened: 10, closed: 10, active: 0 },
      });

      const anomalies = detectTelemetryAnomalies(cleanTelemetry);
      expect(anomalies.find((a) => a.type === "BROWSER_SESSION_LEAK")).toBeUndefined();
    });
  });

  describe("Evidence artefact classification & querying", () => {
    const telemetry = createExecutionTelemetry({
      run_id: "run-evidence",
      distinct_agents_by_type: sampleRoster,
      lane_count: 2,
      evidence_artefacts: sampleEvidence,
      browser_sessions: { opened: 1, closed: 1, active: 0 },
    });

    it("filters and checks artefacts by class", () => {
      expect(hasArtefactClass(telemetry, "dom_metrics")).toBe(true);
      expect(hasArtefactClass(telemetry, "optical_critique")).toBe(true);
      expect(hasArtefactClass(telemetry, "non_existent")).toBe(false);

      const domArtefacts = filterArtefactsByClass(telemetry, "dom_metrics");
      expect(domArtefacts).toHaveLength(1);
      expect(domArtefacts[0].path).toBe("evidence/dom-metrics.json");
    });

    it("groups artefacts by class", () => {
      const grouped = groupArtefactsByClass(telemetry);
      expect(Object.keys(grouped)).toContain("dom_metrics");
      expect(Object.keys(grouped)).toContain("optical_critique");
      expect(Object.keys(grouped)).toContain("unit_test_log");
    });

    it("flags empty evidence warning when lanes executed", () => {
      const emptyEvidenceTelemetry = createExecutionTelemetry({
        run_id: "run-empty",
        distinct_agents_by_type: sampleRoster,
        lane_count: 2,
        evidence_artefacts: [],
        browser_sessions: { opened: 0, closed: 0, active: 0 },
      });

      const anomalies = detectTelemetryAnomalies(emptyEvidenceTelemetry);
      expect(anomalies.find((a) => a.type === "EMPTY_EVIDENCE_ARTEFACTS")).toBeDefined();
    });
  });
});
