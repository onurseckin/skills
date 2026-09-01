/**
 * Dedicated Test Suite for Epistemic Supersession Index.
 *
 * Covers:
 * 1. Epistemic Status transitions & type guards (ACTIVE, SUPERSEDED, DEPRECATED).
 * 2. Directed lineage graph traversal (getSuccessorLineage, getTerminalSuccessor).
 * 3. Transitive chains (A -> B -> C -> Bedrock Invariant).
 * 4. Cycle detection & acyclicity validation (validateLineageAcyclicity, cycle path reporting, self-referencing nodes).
 * 5. Obsolete state checks (isObsolete).
 * 6. State export/import and JSON roundtrips.
 */

import { describe, expect, it } from "bun:test";
import {
  EPISTEMIC_STATUSES,
  isEpistemicStatus,
  type EpistemicStatus,
  type RegisterSupersessionNodeOptions,
  type SupersessionIndexState,
  type SupersessionNode,
  SupersessionIndex,
} from "../../../../olt/scripts/src/mind/memory/index.ts";

describe("SupersessionIndex Dedicated Suite", () => {


describe("Cycle Detection & Acyclicity Validation", () => {
    it("validates that a linear directed chain is acyclic", () => {
      const index = new SupersessionIndex();
      index.registerEntry({ id: "node-1", title: "Node 1", status: "SUPERSEDED", supersededBy: "node-2" });
      index.registerEntry({ id: "node-2", title: "Node 2", status: "SUPERSEDED", supersededBy: "node-3" });
      index.registerEntry({ id: "node-3", title: "Node 3", status: "ACTIVE" });

      const check = index.validateLineageAcyclicity();
      expect(check.valid).toBe(true);
      expect(check.cycles.length).toBe(0);
    });

    it("detects a direct 2-node cycle (A -> B -> A) and returns cycle path", () => {
      const index = new SupersessionIndex();
      index.registerEntry({ id: "cyc-A", title: "Cycle A", status: "SUPERSEDED", supersededBy: "cyc-B" });
      index.registerEntry({ id: "cyc-B", title: "Cycle B", status: "SUPERSEDED", supersededBy: "cyc-A" });

      const check = index.validateLineageAcyclicity();
      expect(check.valid).toBe(false);
      expect(check.cycles.length).toBeGreaterThan(0);
      expect(check.cycles[0]).toContain("cyc-A");
      expect(check.cycles[0]).toContain("cyc-B");
    });

    it("detects a 3-node cycle (A -> B -> C -> A)", () => {
      const index = new SupersessionIndex();
      index.registerEntry({ id: "c1", title: "C1", status: "SUPERSEDED", supersededBy: "c2" });
      index.registerEntry({ id: "c2", title: "C2", status: "SUPERSEDED", supersededBy: "c3" });
      index.registerEntry({ id: "c3", title: "C3", status: "SUPERSEDED", supersededBy: "c1" });

      const check = index.validateLineageAcyclicity();
      expect(check.valid).toBe(false);
      expect(check.cycles.length).toBe(1);
      expect(check.cycles[0]).toEqual(["c1", "c2", "c3", "c1"]);
    });

    it("handles self-referencing loops (A -> A) gracefully in lineage traversal without infinite loop", () => {
      const index = new SupersessionIndex();
      index.registerEntry({ id: "self-loop", title: "Self Loop", status: "SUPERSEDED", supersededBy: "self-loop" });

      // getSuccessorLineage must break immediately
      const lineage = index.getSuccessorLineage("self-loop");
      expect(lineage).toEqual(["self-loop"]);

      // getTerminalSuccessor must not throw or infinite-loop
      const terminal = index.getTerminalSuccessor("self-loop");
      expect(terminal?.id).toBe("self-loop");
    });

    it("detects cycles in disconnected graphs with both healthy and cyclic components", () => {
      const index = new SupersessionIndex();

      // Healthy component
      index.registerEntry({ id: "healthy-1", title: "H1", status: "SUPERSEDED", supersededBy: "healthy-2" });
      index.registerEntry({ id: "healthy-2", title: "H2", status: "ACTIVE" });

      // Cyclic component
      index.registerEntry({ id: "bad-x", title: "BX", status: "SUPERSEDED", supersededBy: "bad-y" });
      index.registerEntry({ id: "bad-y", title: "BY", status: "SUPERSEDED", supersededBy: "bad-x" });

      const check = index.validateLineageAcyclicity();
      expect(check.valid).toBe(false);
      expect(check.cycles.length).toBeGreaterThan(0);
    });
  });

describe("State Export, Import & JSON Roundtrips", () => {
    it("exports state and imports state into a new index instance", () => {
      const index = new SupersessionIndex();
      index.registerEntry({
        id: "export-1",
        title: "Exported Entry 1",
        status: "ACTIVE",
        metadata: { tag: "exp" },
      });
      index.registerEntry({
        id: "export-2",
        title: "Exported Entry 2",
        status: "SUPERSEDED",
        supersededBy: "export-1",
        reason: "Replaced by Entry 1",
      });

      const exportedState = index.exportState();
      expect(exportedState.version).toBe(1);
      expect(exportedState.exportedAt).toBeDefined();
      expect(exportedState.nodes.length).toBe(2);

      const targetIndex = new SupersessionIndex();
      targetIndex.importState(exportedState);

      expect(targetIndex.size()).toBe(2);
      expect(targetIndex.getEpistemicStatus("export-1")).toBe("ACTIVE");
      expect(targetIndex.getEpistemicStatus("export-2")).toBe("SUPERSEDED");
      expect(targetIndex.getEntry("export-2")?.reason).toBe("Replaced by Entry 1");
    });

    it("serializes to JSON and deserializes via fromJSON static factory", () => {
      const index = new SupersessionIndex();
      index.registerEntry({ id: "json-node-a", title: "JSON Node A", status: "ACTIVE" });
      index.registerEntry({ id: "json-node-b", title: "JSON Node B", status: "SUPERSEDED", supersededBy: "json-node-a" });

      const jsonStr = index.toJSON();
      expect(typeof jsonStr).toBe("string");
      expect(jsonStr).toContain("json-node-a");
      expect(jsonStr).toContain("json-node-b");

      const restored = SupersessionIndex.fromJSON(jsonStr);
      expect(restored.size()).toBe(2);
      expect(restored.hasEntry("json-node-a")).toBe(true);
      expect(restored.hasEntry("json-node-b")).toBe(true);
      expect(restored.getTerminalSuccessor("json-node-b")?.id).toBe("json-node-a");
    });

    it("constructs an index from state using fromState static factory", () => {
      const state: SupersessionIndexState = {
        version: 1,
        exportedAt: "2026-09-01T00:00:00.000Z",
        nodes: [
          { id: "s-node-1", title: "State Node 1", status: "ACTIVE", timestamp: "2026-09-01T00:00:00.000Z" },
          { id: "s-node-2", title: "State Node 2", status: "DEPRECATED", timestamp: "2026-09-01T00:00:00.000Z" },
        ],
      };

      const index = SupersessionIndex.fromState(state);
      expect(index.size()).toBe(2);
      expect(index.getEpistemicStatus("s-node-1")).toBe("ACTIVE");
      expect(index.getEpistemicStatus("s-node-2")).toBe("DEPRECATED");
    });

    it("throws an error when importing malformed state", () => {
      const index = new SupersessionIndex();

      expect(() => {
        index.importState(null as unknown as SupersessionIndexState);
      }).toThrow(/invalid/i);

      expect(() => {
        index.importState({} as unknown as SupersessionIndexState);
      }).toThrow(/invalid/i);
    });

    it("initializes index with initialNodes in constructor", () => {
      const initial: SupersessionNode[] = [
        { id: "init-1", title: "Init 1", status: "ACTIVE", timestamp: "2026-08-01T00:00:00.000Z" },
        { id: "init-2", title: "Init 2", status: "SUPERSEDED", supersededBy: "init-1", timestamp: "2026-08-01T00:00:00.000Z" },
      ];

      const index = new SupersessionIndex(initial);
      expect(index.size()).toBe(2);
      expect(index.hasEntry("init-1")).toBe(true);
      expect(index.hasEntry("init-2")).toBe(true);
      expect(index.getTerminalSuccessor("init-2")?.id).toBe("init-1");
    });
  });
});
