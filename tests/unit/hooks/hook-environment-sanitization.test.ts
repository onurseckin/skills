import { describe, expect, test } from "bun:test";
import {
  buildHookChildEnvironment,
  type HookDefinition,
} from "../../../olt/scripts/src/hooks/index.ts";

describe("Hook child environment sanitization", () => {
  test("admits only approved ambient values, safe hook configuration, and protected lifecycle metadata", () => {
    const hook: HookDefinition = {
      events: ["task:complete"],
      action: "shell",
      env: {
        CUSTOM_VAR: "configured",
        PATH: "/hook/bin",
        Path: "/hook/windows-bin",
        pAtH: "/hook/mixed-case-bin",
        LIFECYCLE_EVENT: "overridden-event",
        LIFECYCLE_PAYLOAD: "overridden-payload",
      },
    };
    const parentEnv = {
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      LC_CTYPE: "UTF-8",
      TZ: "UTC",
      TMPDIR: "/tmp/approved",
      TMP: "/tmp/tmp",
      TEMP: "/tmp/temp",
      SYSTEMROOT: "C:\\Windows",
      WINDIR: "C:\\Windows",
      CUSTOM_VAR: "ambient",
      PATH: "/parent/bin",
      AWS_SECRET_ACCESS_KEY: "synthetic-aws-secret",
      API_TOKEN: "synthetic-api-token",
      NODE_OPTIONS: "--require synthetic-hook",
      DYLD_INSERT_LIBRARIES: "/tmp/injected.dylib",
      HOME: "/synthetic/home",
    };

    const environment = buildHookChildEnvironment(
      hook,
      "task:complete",
      { taskId: "t-1" },
      parentEnv,
    );

    expect(environment).toEqual({
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      LC_CTYPE: "UTF-8",
      TZ: "UTC",
      TMPDIR: "/tmp/approved",
      TMP: "/tmp/tmp",
      TEMP: "/tmp/temp",
      SYSTEMROOT: "C:\\Windows",
      WINDIR: "C:\\Windows",
      CUSTOM_VAR: "configured",
      LIFECYCLE_EVENT: "task:complete",
      LIFECYCLE_PAYLOAD: JSON.stringify({ taskId: "t-1" }),
    });
    expect(environment).not.toHaveProperty("PATH");
    expect(environment).not.toHaveProperty("Path");
    expect(environment).not.toHaveProperty("pAtH");
    expect(environment).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(environment).not.toHaveProperty("API_TOKEN");
    expect(environment).not.toHaveProperty("NODE_OPTIONS");
    expect(environment).not.toHaveProperty("DYLD_INSERT_LIBRARIES");
    expect(environment).not.toHaveProperty("HOME");
  });
});
