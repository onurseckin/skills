import type {
  PlanningMutation,
  PlanningSnapshot,
  PlanningStore,
} from "../../src/graph/planning-store.ts";

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
