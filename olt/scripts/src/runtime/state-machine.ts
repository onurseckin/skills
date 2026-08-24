import { writeFileSync, renameSync, readFileSync, existsSync } from "node:fs";

export class StateMachine {
  constructor(private path: string) {}

  transition(newState: string): void {
    const tmpPath = `${this.path}.tmp`;
    writeFileSync(tmpPath, JSON.stringify({ state: newState }), { encoding: "utf8" });
    renameSync(tmpPath, this.path);
  }

  getState(): string | null {
    if (!existsSync(this.path)) return null;
    try {
      const content = readFileSync(this.path, { encoding: "utf8" });
      const parsed = JSON.parse(content) as { state?: string };
      return parsed.state || null;
    } catch {
      return null;
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
