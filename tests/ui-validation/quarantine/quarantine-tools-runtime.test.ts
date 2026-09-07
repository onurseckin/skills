import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  HarnessError,
  ToolQuarantineEngine,
  getDefaultQuarantineEngine,
  setDefaultQuarantineEngine,
  resetDefaultQuarantineEngine,
} from "../fixtures.ts";

describe("Tool Quarantine Engine - Runtime Boundary & Compliance", () => {
  beforeEach(() => {
    resetDefaultQuarantineEngine();
  });

  afterEach(() => {
    resetDefaultQuarantineEngine();
  });

  describe("Runtime Boundary & Compliance Enforcement", () => {
    it("enforces runtime boundary and logs audit records", () => {
      const engine = new ToolQuarantineEngine();

      const allowedAudit = engine.auditToolInvocation({
        agentId: "opt-val-01",
        role: "ui-optical-validator",
        toolName: "take_screenshot",
        args: { format: "png" },
      });
      expect(allowedAudit.decision).toBe("ALLOWED");
      expect(allowedAudit.bypassDetected).toBe(false);

      const blockedAudit = engine.auditToolInvocation({
        agentId: "opt-val-01",
        role: "ui-optical-validator",
        toolName: "run_command",
        args: { CommandLine: "ls" },
      });
      expect(blockedAudit.decision).toBe("BLOCKED");

      const bypassAudit = engine.auditToolInvocation({
        agentId: "opt-val-01",
        role: "ui-optical-validator",
        toolName: "view_file",
        args: { AbsolutePath: "/repo/src/index.ts" },
      });
      expect(bypassAudit.decision).toBe("BLOCKED");
      expect(bypassAudit.bypassDetected).toBe(true);

      const history = engine.getAuditHistory();
      expect(history.length).toBe(3);

      engine.clearAuditHistory();
      expect(engine.getAuditHistory().length).toBe(0);
    });

    it("assertOpticalQuarantineCompliance throws HarnessError for violations", () => {
      const engine = new ToolQuarantineEngine();

      expect(() => {
        engine.assertOpticalQuarantineCompliance("write_to_file", { TargetFile: "/foo.ts" });
      }).toThrow(HarnessError);

      expect(() => {
        engine.assertOpticalQuarantineCompliance("navigate_page", { url: "file:///etc/hosts" });
      }).toThrow(HarnessError);

      expect(() => {
        engine.assertOpticalQuarantineCompliance("take_screenshot", {});
      }).not.toThrow();
    });

    it("manages singleton instance correctly", () => {
      const defaultEngine = getDefaultQuarantineEngine();
      expect(defaultEngine).toBeInstanceOf(ToolQuarantineEngine);
      expect(getDefaultQuarantineEngine()).toBe(defaultEngine);

      const customEngine = new ToolQuarantineEngine();
      setDefaultQuarantineEngine(customEngine);
      expect(getDefaultQuarantineEngine()).toBe(customEngine);
    });
  });
});
