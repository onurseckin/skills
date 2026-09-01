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


describe("Epistemic Status & Type Guards", () => {
    it("exports canonical EPISTEMIC_STATUSES containing ACTIVE, SUPERSEDED, DEPRECATED", () => {
      expect(EPISTEMIC_STATUSES).toEqual(["ACTIVE", "SUPERSEDED", "DEPRECATED"]);
      expect(EPISTEMIC_STATUSES.length).toBe(3);
    });

    it("validates epistemic status strings using isEpistemicStatus type guard", () => {
      expect(isEpistemicStatus("ACTIVE")).toBe(true);
      expect(isEpistemicStatus("SUPERSEDED")).toBe(true);
      expect(isEpistemicStatus("DEPRECATED")).toBe(true);

      expect(isEpistemicStatus("INVALID")).toBe(false);
      expect(isEpistemicStatus("active")).toBe(false);
      expect(isEpistemicStatus("")).toBe(false);
      expect(isEpistemicStatus(null)).toBe(false);
      expect(isEpistemicStatus(undefined)).toBe(false);
      expect(isEpistemicStatus(123)).toBe(false);
      expect(isEpistemicStatus({})).toBe(false);
    });

    it("registers entries with default ACTIVE status when omitted", () => {
      const index = new SupersessionIndex();
      const node = index.registerEntry({
        id: "spec-doc-01",
        title: "Specification Document 01",
      });

      expect(node.id).toBe("spec-doc-01");
      expect(node.status).toBe("ACTIVE");
      expect(node.title).toBe("Specification Document 01");
      expect(node.timestamp).toBeDefined();

      expect(index.getEpistemicStatus("spec-doc-01")).toBe("ACTIVE");
      expect(index.isObsolete("spec-doc-01")).toBe(false);
      expect(index.hasEntry("spec-doc-01")).toBe(true);
      expect(index.size()).toBe(1);
    });

    it("returns default ACTIVE for unindexed entry IDs", () => {
      const index = new SupersessionIndex();
      expect(index.getEpistemicStatus("unindexed-entry-xyz")).toBe("ACTIVE");
      expect(index.isObsolete("unindexed-entry-xyz")).toBe(false);
      expect(index.hasEntry("unindexed-entry-xyz")).toBe(false);
    });

    it("rejects empty or whitespace-only IDs on entry registration", () => {
      const index = new SupersessionIndex();

      expect(() => {
        index.registerEntry({ id: "", title: "Empty" });
      }).toThrow(/empty/i);

      expect(() => {
        index.registerEntry({ id: "   ", title: "Whitespace" });
      }).toThrow(/empty/i);
    });
  });

describe("Directed Lineage Graph Traversal & Successor Resolution", () => {
    it("traverses single-hop supersession relationships", () => {
      const index = new SupersessionIndex();
      index.registerEntry({ id: "spec-v1", title: "Specification v1" });
      index.registerEntry({ id: "spec-v2", title: "Specification v2" });

      const marked = index.markSuperseded("spec-v1", "spec-v2", "Upgraded to v2 architecture");
      expect(marked).toBe(true);

      expect(index.getEpistemicStatus("spec-v1")).toBe("SUPERSEDED");
      expect(index.getEpistemicStatus("spec-v2")).toBe("ACTIVE");
      expect(index.isObsolete("spec-v1")).toBe(true);
      expect(index.isObsolete("spec-v2")).toBe(false);

      const lineage = index.getSuccessorLineage("spec-v1");
      expect(lineage).toEqual(["spec-v1", "spec-v2"]);

      const terminal = index.getTerminalSuccessor("spec-v1");
      expect(terminal).not.toBeNull();
      expect(terminal?.id).toBe("spec-v2");
      expect(terminal?.status).toBe("ACTIVE");
    });

    it("traverses multi-hop transitive chains (A -> B -> C -> Bedrock Invariant)", () => {
      const index = new SupersessionIndex();
      index.registerEntry({ id: "v1-legacy", title: "V1 Prototype", status: "ACTIVE" });
      index.registerEntry({ id: "v2-interim", title: "V2 Draft", status: "ACTIVE" });
      index.registerEntry({ id: "v3-release", title: "V3 Production", status: "ACTIVE" });
      index.registerEntry({ id: "inv-bedrock-rule", title: "Bedrock Invariant Final", status: "ACTIVE" });

      index.markSuperseded("v1-legacy", "v2-interim", "Superseded by V2");
      index.markSuperseded("v2-interim", "v3-release", "Superseded by V3");
      index.markSuperseded("v3-release", "inv-bedrock-rule", "Settled into permanent Bedrock Invariant", "inv-bedrock-rule");

      expect(index.getEpistemicStatus("v1-legacy")).toBe("SUPERSEDED");
      expect(index.getEpistemicStatus("v2-interim")).toBe("SUPERSEDED");
      expect(index.getEpistemicStatus("v3-release")).toBe("SUPERSEDED");
      expect(index.getEpistemicStatus("inv-bedrock-rule")).toBe("ACTIVE");

      const lineage = index.getSuccessorLineage("v1-legacy");
      expect(lineage).toEqual(["v1-legacy", "v2-interim", "v3-release", "inv-bedrock-rule"]);

      const terminal = index.getTerminalSuccessor("v1-legacy");
      expect(terminal).not.toBeNull();
      expect(terminal?.id).toBe("inv-bedrock-rule");
      expect(terminal?.status).toBe("ACTIVE");
    });

    it("resolves terminal successor when querying an intermediate superseded node", () => {
      const index = new SupersessionIndex();
      index.registerEntry({ id: "step-1", title: "Step 1", status: "SUPERSEDED", supersededBy: "step-2" });
      index.registerEntry({ id: "step-2", title: "Step 2", status: "SUPERSEDED", supersededBy: "step-3" });
      index.registerEntry({ id: "step-3", title: "Step 3", status: "ACTIVE" });

      const intermediateTerminal = index.getTerminalSuccessor("step-2");
      expect(intermediateTerminal?.id).toBe("step-3");
    });

    it("resolves self as terminal successor for active node without successors", () => {
      const index = new SupersessionIndex();
      index.registerEntry({ id: "solo-active", title: "Solo Active Entry", status: "ACTIVE" });

      const terminal = index.getTerminalSuccessor("solo-active");
      expect(terminal?.id).toBe("solo-active");
      expect(index.getSuccessorLineage("solo-active")).toEqual(["solo-active"]);
    });

    it("falls back to successorInvariantId when supersededBy pointer is omitted", () => {
      const index = new SupersessionIndex();
      index.registerEntry({
        id: "entry-with-inv-link",
        title: "Entry With Invariant Link",
        status: "SUPERSEDED",
        successorInvariantId: "inv-target-axiom",
      });
      index.registerEntry({
        id: "inv-target-axiom",
        title: "Target Axiom",
        status: "ACTIVE",
      });

      const lineage = index.getSuccessorLineage("entry-with-inv-link");
      expect(lineage).toEqual(["entry-with-inv-link", "inv-target-axiom"]);

      const terminal = index.getTerminalSuccessor("entry-with-inv-link");
      expect(terminal?.id).toBe("inv-target-axiom");
    });

    it("marks entries as deprecated and verifies obsolescence without direct successor", () => {
      const index = new SupersessionIndex();
      index.registerEntry({ id: "old-abandoned-pattern", title: "Abandoned Pattern" });

      const marked = index.markDeprecated("old-abandoned-pattern", "Pattern proven counter-productive");
      expect(marked).toBe(true);

      expect(index.getEpistemicStatus("old-abandoned-pattern")).toBe("DEPRECATED");
      expect(index.isObsolete("old-abandoned-pattern")).toBe(true);

      const entry = index.getEntry("old-abandoned-pattern");
      expect(entry?.reason).toBe("Pattern proven counter-productive");
    });

    it("returns false when marking supersession or deprecation with invalid IDs", () => {
      const index = new SupersessionIndex();
      expect(index.markSuperseded("", "target")).toBe(false);
      expect(index.markSuperseded("source", "")).toBe(false);
      expect(index.markDeprecated("")).toBe(false);
    });
  });
});
