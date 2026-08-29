import { describe, expect, it } from "bun:test";
import { ViolationAlertDispatcher } from "../../../../olt/scripts/src/policy/audit/violation-alert.ts";
import type { ViolationAlert } from "../../../../olt/scripts/src/policy/audit/types.ts";

describe("ViolationAlertDispatcher", () => {
  it("dispatches alerts to subscribers asynchronously", async () => {
    const dispatcher = new ViolationAlertDispatcher();
    const received: ViolationAlert[] = [];

    const unsubscribe = dispatcher.subscribe((alert) => {
      received.push(alert);
    });

    const alert = await dispatcher.createAlert({
      category: "rbac",
      initialSeverity: "high",
      ruleId: "rbac_command_denial",
      actor: { id: "agent-1", role: "implementer" },
      message: "Forbidden command execution",
      violations: ["Command rm -rf / is strictly forbidden"],
    });

    expect(received.length).toBe(1);
    expect(received[0]?.id).toBe(alert.id);
    expect(received[0]?.ruleId).toBe("rbac_command_denial");

    unsubscribe();

    await dispatcher.createAlert({
      category: "worktree",
      initialSeverity: "warning",
      ruleId: "worktree_root_escape",
      actor: { id: "agent-2", role: "implementer" },
      message: "Worktree escape",
      violations: ["Invalid root path"],
    });

    expect(received.length).toBe(1);
  });

  it("escalates alert severity when violations exceed threshold in time window", async () => {
    const dispatcher = new ViolationAlertDispatcher({
      maxViolationsPerWindow: 2,
      windowMs: 10000,
      escalateToSeverity: "critical",
    });

    const alert1 = await dispatcher.createAlert({
      category: "rbac",
      initialSeverity: "warning",
      ruleId: "rule-1",
      actor: { id: "bad-actor" },
      message: "First violation",
      violations: ["warning 1"],
    });

    expect(alert1.severity).toBe("warning");

    const alert2 = await dispatcher.createAlert({
      category: "rbac",
      initialSeverity: "warning",
      ruleId: "rule-2",
      actor: { id: "bad-actor" },
      message: "Second violation",
      violations: ["warning 2"],
    });

    expect(alert2.severity).toBe("critical");
  });

  it("manages acknowledgment lifecycle of alerts", async () => {
    const dispatcher = new ViolationAlertDispatcher();

    const alert = await dispatcher.createAlert({
      category: "commit",
      initialSeverity: "high",
      ruleId: "commit_message_format",
      actor: { id: "agent-1" },
      message: "Invalid commit message",
      violations: ["Does not conform to conventional commits"],
    });

    expect(dispatcher.getUnacknowledgedAlerts().length).toBe(1);

    const acknowledged = dispatcher.acknowledgeAlert(alert.id);
    expect(acknowledged).toBe(true);
    expect(dispatcher.getUnacknowledgedAlerts().length).toBe(0);
  });
});
