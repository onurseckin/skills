import { spyOn } from "bun:test";
import type { BigIntStats } from "node:fs";
import * as fsp from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join, resolve } from "node:path";
import { requirementsDocument } from "../../requirements/validation/fixtures.ts";
import {
  applyPlan,
  type PlanningMutation,
  type PlanningSnapshot,
  type PlanningStore,
} from "../../../olt/scripts/src/graph/apply-plan.ts";

export const vPlanFs = new Map<string, Uint8Array>();
export const vPlanDirs = new Set<string>();
export const vPlanSymlinks = new Map<string, string>();
let planDirCounter = 0;
const vPlanSpies: Array<{ mockRestore: () => void }> = [];

const norm = (p: string): string => resolve(p).replace(/\/+$/, "");

export function installPlanFsSpies(): void {
  if (vPlanSpies.length > 0) return;
  const olstat = fsp.lstat.bind(fsp),
    oopen = fsp.open.bind(fsp);
  const owrite = fsp.writeFile.bind(fsp),
    osymlink = fsp.symlink.bind(fsp),
    orm = fsp.rm.bind(fsp);

  vPlanSpies.push(
    spyOn(fsp, "mkdtemp").mockImplementation(async () => {
      const dir = `/virtual/plan-dir-${++planDirCounter}`;
      vPlanDirs.add(dir);
      return dir;
    }),
    spyOn(fsp, "writeFile").mockImplementation(async (path, data) => {
      const s = norm(String(path));
      if (s.startsWith("/virtual/")) {
        vPlanFs.set(
          s,
          typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data as Uint8Array),
        );
        return;
      }
      return owrite(path, data);
    }),
    spyOn(fsp, "symlink").mockImplementation(async (target, path) => {
      const s = norm(String(path));
      if (s.startsWith("/virtual/")) {
        vPlanSymlinks.set(s, String(target));
        return;
      }
      return osymlink(target, path);
    }),
    spyOn(fsp, "rm").mockImplementation(async (path) => {
      const s = norm(String(path));
      if (s.startsWith("/virtual/")) {
        vPlanFs.delete(s);
        vPlanDirs.delete(s);
        vPlanSymlinks.delete(s);
        for (const k of Array.from(vPlanFs.keys())) if (k.startsWith(`${s}/`)) vPlanFs.delete(k);
        for (const d of Array.from(vPlanDirs)) if (d.startsWith(`${s}/`)) vPlanDirs.delete(d);
        return;
      }
      return orm(path, { force: true, recursive: true });
    }),
    spyOn(fsp, "lstat").mockImplementation(async (path, options?: unknown) => {
      const s = norm(String(path));
      if (s.startsWith("/virtual/")) {
        if (vPlanSymlinks.has(s))
          return {
            isSymbolicLink: () => true,
            isFile: () => false,
            isDirectory: () => false,
            dev: 1n,
            ino: 2n,
            mode: 0o120000n,
            size: 0n,
            mtimeNs: 0n,
          } as unknown as BigIntStats;
        if (vPlanDirs.has(s))
          return {
            isSymbolicLink: () => false,
            isFile: () => false,
            isDirectory: () => true,
            dev: 1n,
            ino: 3n,
            mode: 0o040755n,
            size: 0n,
            mtimeNs: 0n,
          } as unknown as BigIntStats;
        const file = vPlanFs.get(s);
        if (!file) {
          const err = new Error(`ENOENT: ${s}`) as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
        return {
          isSymbolicLink: () => false,
          isFile: () => true,
          isDirectory: () => false,
          dev: 1n,
          ino: 1n,
          mode: 0o100644n,
          size: BigInt(file.length),
          mtimeNs: 0n,
        } as unknown as BigIntStats;
      }
      return olstat(path, options as Parameters<typeof olstat>[1]);
    }),
    spyOn(fsp, "open").mockImplementation(async (path, flags) => {
      const s = norm(String(path));
      if (s.startsWith("/virtual/")) {
        if (vPlanSymlinks.has(s)) {
          const err = new Error(
            `ELOOP: symbolic link encountered, open '${s}'`,
          ) as NodeJS.ErrnoException;
          err.code = "ELOOP";
          throw err;
        }
        const file = vPlanFs.get(s);
        if (!file) {
          const err = new Error(`ENOENT: ${s}`) as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
        return {
          stat: async () =>
            ({
              isSymbolicLink: () => false,
              isFile: () => true,
              isDirectory: () => false,
              dev: 1n,
              ino: 1n,
              mode: 0o100644n,
              size: BigInt(file.length),
              mtimeNs: 0n,
            }) as unknown as BigIntStats,
          read: async (buf: Uint8Array, offset: number, length: number, position: number) => {
            const slice = file.subarray(position, position + length);
            buf.set(slice, offset);
            return { bytesRead: slice.length, buffer: buf };
          },
          close: async () => {},
        } as unknown as FileHandle;
      }
      return oopen(path, flags);
    }),
  );
}

export function clearPlanFs(): void {
  for (const s of vPlanSpies.splice(0)) s.mockRestore();
  vPlanFs.clear();
  vPlanDirs.clear();
  vPlanSymlinks.clear();
}

export function graphDocument(
  requirements: Record<string, unknown>,
  revision = 1,
): Record<string, unknown> {
  const requirementIds = (requirements.requirements as Record<string, unknown>[]).map(
    ({ id }) => id as string,
  );
  const nodes: Record<string, unknown>[] = [];
  const edges: Record<string, unknown>[] = [];
  requirementIds.forEach((requirementId, offset) => {
    const index = offset + 1;
    const taskId = `task-${index}`;
    const artifactId = `artifact-${index}`;
    nodes.push(
      {
        id: `requirement-${index}`,
        type: "requirement",
        label: requirementId,
        requirement_id: requirementId,
      },
      { id: artifactId, type: "artifact", label: `Artifact ${index}` },
      {
        id: taskId,
        type: "task",
        label: `Task ${index}`,
        requirement_ids: [requirementId],
        write_scope: [`src/area-${index}`],
        resource_scope: [],
        status: index === 1 ? "ready" : "proposed",
        priority: 10 - index,
        effort: index,
        created_order: index,
      },
    );
    edges.push({ source: taskId, target: artifactId, type: "produces" });
  });
  if (requirementIds.length > 1)
    edges.push({ source: "task-2", target: "task-1", type: "depends_on" });
  return {
    schema: "harness.graph",
    version: 1,
    revision,
    nodes,
    edges,
    gates: [
      {
        id: "gate-required",
        command: ["bun", "test", "tests/planning"],
        cwd: ".",
        scope: "task",
        requirement_ids: requirementIds,
        mandatory: true,
      },
      {
        id: "gate-final",
        command: ["bun", "test", "tests"],
        cwd: ".",
        scope: "run",
        requirement_ids: [],
        mandatory: true,
      },
    ],
  };
}

export function validPlanningDocuments(prompt = "First\n\nThird"): {
  prompt: string;
  requirements: Record<string, unknown>;
  graph: Record<string, unknown>;
} {
  const requirements = requirementsDocument(prompt);
  return { prompt, requirements, graph: graphDocument(requirements) };
}

export function taskById(graph: Record<string, unknown>, id: string): Record<string, unknown> {
  const task = (graph.nodes as Record<string, unknown>[]).find((node) => node.id === id);
  if (!task) throw new Error(`Missing fixture task ${id}`);
  return task;
}

export class MemoryPlanningStore implements PlanningStore {
  public state: Record<string, unknown>;
  public readonly events: Record<string, unknown>[] = [];
  private readonly prompt: Uint8Array;

  public constructor(prompt: string) {
    this.prompt = new TextEncoder().encode(prompt);
    this.state = { revision: 0, tasks: {}, plan_history: [] };
  }

  public async load(): Promise<PlanningSnapshot> {
    return { prompt: this.prompt.slice(), state: structuredClone(this.state) };
  }

  public async transact(
    actor: string,
    kind: string,
    payload: Record<string, unknown>,
    mutation: PlanningMutation,
  ): Promise<Record<string, unknown>> {
    const next = structuredClone(this.state);
    await mutation(next);
    next.revision = (next.revision as number) + 1;
    this.state = next;
    this.events.push({ actor, kind, payload: structuredClone(payload) });
    return structuredClone(next);
  }

  public mutateRuntime(mutation: (state: Record<string, unknown>) => void): number {
    const next = structuredClone(this.state);
    mutation(next);
    next.revision = (next.revision as number) + 1;
    this.state = next;
    return next.revision as number;
  }
}

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
    installPlanFsSpies();
    planDirCounter += 1;
    this.root = `/virtual/plan-dir-${planDirCounter}`;
    vPlanDirs.add(this.root);
    this.requirementsPath = join(this.root, "requirements.json");
    this.graphPath = join(this.root, "graph.json");
    await this.write();
  }

  public async cleanup(): Promise<void> {
    clearPlanFs();
  }

  public async write(): Promise<void> {
    const reqBytes = Buffer.from(JSON.stringify(this.requirements), "utf-8");
    const graphBytes = Buffer.from(JSON.stringify(this.graph), "utf-8");
    vPlanFs.set(norm(this.requirementsPath), reqBytes);
    vPlanFs.set(norm(this.graphPath), graphBytes);
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
