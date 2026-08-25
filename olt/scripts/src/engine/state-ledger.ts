import { writeFileSync, renameSync, readFileSync, existsSync } from "node:fs";

export class StateLedger {
  private cache: string[] = [];

  constructor(private path: string) {}

  appendState(state: string): void {
    this.cache.push(state);
    const tmpPath = `${this.path}.tmp`;
    const current = this.readAll();
    writeFileSync(tmpPath, JSON.stringify(current), { encoding: "utf8" });
    renameSync(tmpPath, this.path);
  }

  readAll(): string[] {
    if (this.cache.length > 0) return [...this.cache];
    if (!existsSync(this.path)) return [];
    try {
      const content = readFileSync(this.path, { encoding: "utf8" });
      const parsed = JSON.parse(content) as unknown;
      if (Array.isArray(parsed)) {
        const result = parsed.filter((v): v is string => typeof v === "string");
        this.cache = [...result];
        return result;
      }
      return [];
    } catch {
      return [];
    }
  }
}

export class DeductiveStateMachine {
  constructor(public readonly state: Record<string, unknown>) {}

  public isPhaseVerified(phase: string): boolean {
    switch (phase) {
      case "plan":
        return !!this.state.requirements;
      case "queue":
      case "task":
        return (
          !!this.state.tasks &&
          typeof this.state.tasks === "object" &&
          this.state.tasks !== null &&
          Object.keys(this.state.tasks as Record<string, unknown>).length > 0
        );
      case "critic": {
        const cc = this.state.completion_critic;
        const isValidCC =
          cc !== null &&
          typeof cc === "object" &&
          "status" in cc &&
          (cc as { status?: unknown }).status === "reviewed";
        return (
          !!this.state.critic_verdict ||
          !!this.state.critic_review ||
          !!this.state.completion_review ||
          isValidCC
        );
      }
      case "run":
        return !!this.state.completion_result;
      default:
        return true;
    }
  }
}
