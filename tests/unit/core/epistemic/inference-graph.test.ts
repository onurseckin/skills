import { describe, expect, it } from "bun:test";
import { InferenceGraph } from "../../../../olt/scripts/src/core/epistemic/index.ts";

describe("Inference Graph & Epistemic State Propagation", () => {
  it("creates nodes with defaults, custom grades, and computes size", () => {
    const graph = new InferenceGraph();
    const nodeA = graph.addNode("node-a", { confidence: 0.95, kind: "axiom", label: "Axiom A" });
    const nodeB = graph.addNode("node-b", { confidence: 0.2, kind: "evidence" });

    expect(graph.size()).toBe(2);
    expect(nodeA.grade).toBe("VERY_HIGH");
    expect(nodeB.grade).toBe("VERY_LOW");
    expect(graph.hasNode("node-a")).toBe(true);
    expect(graph.getNode("node-b")?.label).toBe("node-b");
  });

  it("adds and removes directed edges and manages node removal cleanly", () => {
    const graph = new InferenceGraph();
    graph.addNode("n1");
    graph.addNode("n2");
    graph.addNode("n3");

    expect(graph.addEdge("n1", "n2", 0.8)).toBe(true);
    expect(graph.addEdge("n2", "n3", 0.5)).toBe(true);
    expect(graph.addEdge("n1", "n1")).toBe(false);

    expect(graph.getDownstreamDependents("n1")).toEqual(["n2", "n3"]);
    expect(graph.getUpstreamDependencies("n3")).toEqual(["n2", "n1"]);

    expect(graph.removeEdge("n1", "n2")).toBe(true);
    expect(graph.getDownstreamDependents("n1")).toEqual([]);

    expect(graph.removeNode("n2")).toBe(true);
    expect(graph.hasNode("n2")).toBe(false);
    expect(graph.size()).toBe(2);
  });

  it("marks downstream nodes as stale upon upstream confidence mutation", () => {
    const graph = new InferenceGraph();
    graph.addNode("evidence_1", { confidence: 1.0, kind: "evidence" });
    graph.addNode("hypothesis_1", { confidence: 0.5, kind: "hypothesis" });
    graph.addNode("hypothesis_2", { confidence: 0.5, kind: "hypothesis" });

    graph.addEdge("evidence_1", "hypothesis_1", 1.0);
    graph.addEdge("hypothesis_1", "hypothesis_2", 1.0);

    const affected = graph.markStale("evidence_1");
    expect(affected).toEqual(["evidence_1", "hypothesis_1", "hypothesis_2"]);
    expect(graph.getNode("hypothesis_2")?.isStale).toBe(true);
  });

  it("recomputes stale nodes topologically and propagates confidence updates", () => {
    const graph = new InferenceGraph();
    graph.addNode("e1", { confidence: 0.8, kind: "evidence" });
    graph.addNode("e2", { confidence: 0.6, kind: "evidence" });
    graph.addNode("h1", { confidence: 0.0, kind: "hypothesis" });

    graph.addEdge("e1", "h1", 0.5);
    graph.addEdge("e2", "h1", 0.5);

    const updatedH1 = graph.recomputeNode("h1");
    expect(updatedH1?.confidence).toBeCloseTo(0.7, 5);
    expect(updatedH1?.grade).toBe("MEDIUM");
    expect(updatedH1?.isStale).toBe(false);

    graph.updateNodeConfidence("e1", 1.0);
    expect(graph.getNode("h1")?.isStale).toBe(true);

    const propagated = graph.propagateAll();
    expect(propagated).toContain("h1");
    expect(graph.getNode("h1")?.confidence).toBeCloseTo(0.8, 5);
    expect(graph.getNode("h1")?.grade).toBe("HIGH");
  });

  it("detects acyclicity and produces topological sorts", () => {
    const graph = new InferenceGraph();
    graph.addNode("a");
    graph.addNode("b");
    graph.addNode("c");

    graph.addEdge("a", "b");
    graph.addEdge("b", "c");

    expect(graph.hasCycle()).toBe(false);
    expect(graph.topologicalSort()).toEqual(["a", "b", "c"]);

    const snapshot = graph.snapshot();
    expect(snapshot.nodes.length).toBe(3);
    expect(snapshot.edges.length).toBe(2);
  });
});
