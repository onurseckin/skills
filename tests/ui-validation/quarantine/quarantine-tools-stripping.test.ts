import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  ToolQuarantineEngine,
  resetDefaultQuarantineEngine,
} from "../fixtures.ts";

describe("Tool Quarantine Engine - Capability Stripping", () => {
  beforeEach(() => {
    resetDefaultQuarantineEngine();
  });

  afterEach(() => {
    resetDefaultQuarantineEngine();
  });

  describe("Tool Stripping & Capability Verification", () => {
    it("physically strips forbidden tools for ui-optical-validator", () => {
      const engine = new ToolQuarantineEngine();
      const allTools = [
        "run_command",
        "replace_file_content",
        "write_to_file",
        "list_dir",
        "grep_search",
        "find_by_name",
        "click",
        "fill",
        "hover",
        "navigate_page",
        "take_screenshot",
        "view_file",
        "msg:send",
        "task:probe",
      ];

      const stripped = engine.stripTools(allTools, "ui-optical-validator");
      expect(stripped).not.toContain("run_command");
      expect(stripped).not.toContain("replace_file_content");
      expect(stripped).not.toContain("write_to_file");
      expect(stripped).not.toContain("list_dir");
      expect(stripped).not.toContain("grep_search");
      expect(stripped).not.toContain("find_by_name");

      expect(stripped).toContain("click");
      expect(stripped).toContain("fill");
      expect(stripped).toContain("hover");
      expect(stripped).toContain("navigate_page");
      expect(stripped).toContain("take_screenshot");
      expect(stripped).toContain("view_file");
      expect(stripped).toContain("msg:send");
      expect(stripped).toContain("task:probe");
    });

    it("physically strips tool descriptor objects", () => {
      const engine = new ToolQuarantineEngine();
      const tools = [
        { name: "run_command", description: "Execute shell command" },
        { name: "write_to_file", description: "Write source code" },
        { name: "click", description: "Click DOM element" },
        { name: "take_screenshot", description: "Take screenshot" },
      ];

      const stripped = engine.stripTools(tools, "ui-optical-validator");
      expect(stripped.map((t) => t.name)).toEqual(["click", "take_screenshot"]);
    });

    it("does not strip tools for non-optical roles (e.g. implementer)", () => {
      const engine = new ToolQuarantineEngine();
      const tools = ["run_command", "write_to_file", "click"];
      const notStripped = engine.stripTools(tools, "implementer");
      expect(notStripped).toEqual(tools);
    });

    it("verifies capability classifications accurately", () => {
      const engine = new ToolQuarantineEngine();

      expect(engine.verifyCapability("click", "ui-optical-validator").allowed).toBe(true);
      expect(engine.verifyCapability("view_file", "ui-optical-validator").allowed).toBe(true);
      expect(engine.verifyCapability("msg:send", "ui-optical-validator").allowed).toBe(true);

      const runCommand = engine.verifyCapability("run_command", "ui-optical-validator");
      expect(runCommand.allowed).toBe(false);
      expect(runCommand.category).toBe("FORBIDDEN_COMMAND_EXECUTION");

      const writeToFile = engine.verifyCapability("write_to_file", "ui-optical-validator");
      expect(writeToFile.allowed).toBe(false);
      expect(writeToFile.category).toBe("FORBIDDEN_SOURCE_EDITING");

      const listDir = engine.verifyCapability("list_dir", "ui-optical-validator");
      expect(listDir.allowed).toBe(false);
      expect(listDir.category).toBe("FORBIDDEN_DIRECTORY_LISTING");

      const grep = engine.verifyCapability("grep_search", "ui-optical-validator");
      expect(grep.allowed).toBe(false);
      expect(grep.category).toBe("FORBIDDEN_PATTERN_SEARCHING");
    });
  });
});
