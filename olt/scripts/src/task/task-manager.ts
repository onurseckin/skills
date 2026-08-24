export class TaskManager {
  private activeLeases: Map<string, string> = new Map();

  public acquireLease(taskId: string, agentId: string): boolean {
    if (this.activeLeases.has(taskId)) {
      return false;
    }
    this.activeLeases.set(taskId, agentId);
    return true;
  }

  public releaseLease(taskId: string): void {
    this.activeLeases.delete(taskId);
  }
}
