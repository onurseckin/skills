export interface PlanningSnapshot {
  prompt: Uint8Array;
  state: Record<string, unknown>;
}

export type PlanningMutation = (state: Record<string, unknown>) => void | Promise<void>;

export interface PlanningStore {
  load(): Promise<PlanningSnapshot>;
  transact(
    actor: string,
    kind: string,
    payload: Record<string, unknown>,
    mutation: PlanningMutation,
  ): Promise<Record<string, unknown>>;
}
