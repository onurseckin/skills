import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  ToolQuarantineEngine,
  resetDefaultQuarantineEngine,
} from "../fixtures.ts";

describe("Tool Quarantine Engine - Backdoor Detection", () => {
  beforeEach(() => {
    resetDefaultQuarantineEngine();
  });

  afterEach(() => {
    resetDefaultQuarantineEngine();
  });

  describe("Backdoor Detection & Compliance", () => {
    it("detects backdoor script injection in evaluate_script", () => {
      const engine = new ToolQuarantineEngine();

      const fsBypass = engine.detectBackdoorBypass("evaluate_script", {
        script: "const fs = require('fs'); fs.readFileSync('/etc/passwd');",
      });
      expect(fsBypass.detected).toBe(true);
      expect(fsBypass.severity).toBe("CRITICAL");

      const procBypass = engine.detectBackdoorBypass("mcp_chrome-devtools_evaluate_script", {
        script: "process.env.SECRET_TOKEN",
      });
      expect(procBypass.detected).toBe(true);

      const safeScript = engine.detectBackdoorBypass("evaluate_script", {
        script: "document.querySelector('button.primary').getBoundingClientRect();",
      });
      expect(safeScript.detected).toBe(false);
    });

    it("detects file:// and javascript: backdoor bypasses in navigation URLs", () => {
      const engine = new ToolQuarantineEngine();

      const fileUrl = engine.detectBackdoorBypass("navigate_page", {
        url: "file:///Users/secret/repo/config.env",
      });
      expect(fileUrl.detected).toBe(true);
      expect(fileUrl.vector).toBe("LOCAL_FILESYSTEM_OR_DATA_URL_BYPASS");

      const jsUrl = engine.detectBackdoorBypass("navigate_page", {
        url: "javascript:document.write(localStorage.getItem('token'))",
      });
      expect(jsUrl.detected).toBe(true);

      const safeUrl = engine.detectBackdoorBypass("navigate_page", {
        url: "http://localhost:3000/dashboard",
      });
      expect(safeUrl.detected).toBe(false);
    });

    it("enforces view_file to only permit image screenshots and block source code inspection", () => {
      const engine = new ToolQuarantineEngine();

      const tsView = engine.detectBackdoorBypass("view_file", {
        AbsolutePath: "/Users/dev/repo/src/components/Button.tsx",
      });
      expect(tsView.detected).toBe(true);
      expect(tsView.vector).toBe("SOURCE_CODE_READ_ATTEMPT_VIA_VIEW_FILE");

      const jsonView = engine.detectBackdoorBypass("view_file", {
        path: "/Users/dev/repo/package.json",
      });
      expect(jsonView.detected).toBe(true);

      const pyView = engine.detectBackdoorBypass("view_file", {
        filePath: "/Users/dev/repo/server.py",
      });
      expect(pyView.detected).toBe(true);

      const pngView = engine.detectBackdoorBypass("view_file", {
        AbsolutePath:
          "/Users/dev/repo/.olt/capsules/run-01/evidence/screenshots/dashboard-1440x900.png",
      });
      expect(pngView.detected).toBe(false);

      const webpView = engine.detectBackdoorBypass("view_file", {
        AbsolutePath:
          "/Users/dev/repo/.olt/capsules/run-01/evidence/screenshots/modal-390x844.webp",
      });
      expect(webpView.detected).toBe(false);
    });

    it("detects shell command injection patterns in string arguments", () => {
      const engine = new ToolQuarantineEngine();

      const injected = engine.detectBackdoorBypass("click", {
        selector: "#submit-btn; rm -rf /",
      });
      expect(injected.detected).toBe(true);
      expect(injected.vector).toBe("SHELL_INJECTION_IN_ARGUMENT");

      const safeClick = engine.detectBackdoorBypass("click", {
        selector: "button[data-testid='submit-login']",
      });
      expect(safeClick.detected).toBe(false);
    });
  });
});
