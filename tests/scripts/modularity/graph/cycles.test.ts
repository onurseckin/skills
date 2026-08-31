import { expect, test } from "bun:test";
import {
  type ImportEdge,
  stronglyConnectedComponents,
} from "../../../../scripts/modularity/graph/index.ts";

function edge(from: string, to: string): ImportEdge {
  return { from, to, typeOnly: false, viaFacade: true };
}

test("finds a deterministically sorted multi-file cycle", () => {
  expect(
    stronglyConnectedComponents([edge("b.ts", "a.ts"), edge("a.ts", "b.ts"), edge("c.ts", "a.ts")]),
  ).toEqual([["a.ts", "b.ts"]]);
});

test("counts a self-edge and proves removing one cycle edge clears the finding", () => {
  const cycle = [edge("a.ts", "b.ts"), edge("b.ts", "a.ts")];
  expect(stronglyConnectedComponents([...cycle, edge("self.ts", "self.ts")])).toEqual([
    ["a.ts", "b.ts"],
    ["self.ts"],
  ]);
  expect(stronglyConnectedComponents(cycle.slice(0, 1))).toEqual([]);
});
