import { describe, expect, it } from "bun:test";
import { detectArtificialSerializationEdges } from "../../../olt/scripts/src/engine/dag/index.ts";
import type { DagTaskNode } from "../../../olt/scripts/src/engine/dag/index.ts";

describe("DAG Engine - Artificial Serialization Edge Detection", () => {
  it("detects edge between tasks with disjoint scopes as candidate for decoupling", () => {
    const tasks: DagTaskNode[] = [
      { id: "t1", dependencies: [], writeScope: ["src/backend"] },
      { id: "t2", dependencies: ["t1"], writeScope: ["src/frontend"] },
    ];
    const artificial = detectArtificialSerializationEdges(tasks);
    expect(artificial).toHaveLength(1);
    expect(artificial[0]!.fromTaskId).toBe("t1");
    expect(artificial[0]!.toTaskId).toBe("t2");
    expect(artificial[0]!.canDecouple).toBe(true);
  });

  it("does not flag edges where write scopes legitimately overlap", () => {
    const tasks: DagTaskNode[] = [
      { id: "t1", dependencies: [], writeScope: ["src/common"] },
      { id: "t2", dependencies: ["t1"], writeScope: ["src/common/utils"] },
    ];
    const artificial = detectArtificialSerializationEdges(tasks);
    expect(artificial).toHaveLength(0);
  });
});
