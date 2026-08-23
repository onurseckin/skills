import { test, expect } from "bun:test";
import { GraphScheduler } from "../../scheduler.ts";

test("GraphScheduler manages dependencies correctly", () => {
  const scheduler = new GraphScheduler();
  scheduler.addNode({ id: "A", dependencies: [] });
  scheduler.addNode({ id: "B", dependencies: ["A"] });
  scheduler.addNode({ id: "C", dependencies: ["A"] });
  scheduler.addNode({ id: "D", dependencies: ["B", "C"] });

  let ready = scheduler.getReadyNodes();
  expect(ready.length).toBe(1);
  expect(ready[0]!.id).toBe("A");

  scheduler.completeNode("A");
  ready = scheduler.getReadyNodes();
  expect(ready.length).toBe(2);
  const readyIds = ready.map((r) => r.id).sort();
  expect(readyIds).toEqual(["B", "C"]);

  scheduler.completeNode("B");
  ready = scheduler.getReadyNodes();
  expect(ready.length).toBe(1);
  expect(ready[0]!.id).toBe("C");

  scheduler.completeNode("C");
  ready = scheduler.getReadyNodes();
  expect(ready.length).toBe(1);
  expect(ready[0]!.id).toBe("D");

  scheduler.completeNode("D");
  ready = scheduler.getReadyNodes();
  expect(ready.length).toBe(0);
});
