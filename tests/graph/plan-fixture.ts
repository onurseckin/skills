import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyPlan } from "../../olt/scripts/src/graph/apply-plan.ts";
import { graphDocument, validPlanningDocuments } from "./fixtures.ts";
import { MemoryPlanningStore } from "./memory-store.ts";

export class PlanFixture {
  public readonly prompt = "First\n\nThird";
  public requirements: Record<string, unknown>;
  public graph: Record<string, unknown>;
  public store = new MemoryPlanningStore(this.prompt);
  public root = "";
  public requirementsPath = "";
  public graphPath = "";

  public constructor() {
    const documents = validPlanningDocuments(this.prompt);
    this.requirements = documents.requirements;
    this.graph = documents.graph;
  }

  public async setup(): Promise<void> {
    this.root = await mkdtemp(join(tmpdir(), "harness-plan-"));
    this.requirementsPath = join(this.root, "requirements.json");
    this.graphPath = join(this.root, "graph.json");
    await this.write();
  }

  public async cleanup(): Promise<void> {
    if (this.root) await rm(this.root, { force: true, recursive: true });
  }

  public async write(): Promise<void> {
    await Promise.all([
      writeFile(this.requirementsPath, JSON.stringify(this.requirements), "utf8"),
      writeFile(this.graphPath, JSON.stringify(this.graph), "utf8"),
    ]);
  }

  public apply(expectedRevision: number | null = 0): Promise<Record<string, unknown>> {
    return applyPlan(
      this.store,
      "planner",
      this.requirementsPath,
      this.graphPath,
      expectedRevision,
    );
  }

  public resetGraph(revision = 1): void {
    this.graph = graphDocument(this.requirements, revision);
  }
}
