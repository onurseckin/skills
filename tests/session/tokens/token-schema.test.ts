import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  resolveActiveSession,
  enableInMemorySessionStore,
  disableInMemorySessionStore,
  setInMemorySessionData,
} from "../../../olt/scripts/src/authority/session/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

type PersistedSessionReader = (path: string, encoding: "utf8") => string;

function resolveWithInjectedRead(
  options: Parameters<typeof resolveActiveSession>[0],
  readPersistedSessionFile: PersistedSessionReader,
) {
  return resolveActiveSession({
    ...options,
    readPersistedSessionFile,
  });
}

describe("Authority Session Registry - Schema & Fail-Closed Validation", () => {
  const sandboxDir = "/virtual/capsules/registry-schema";

  beforeEach(() => {
    enableInMemorySessionStore();
  });

  afterEach(() => {
    disableInMemorySessionStore();
  });

  it("fails closed when a corrupt process record precedes valid workspace evidence", () => {
    const sessionsDir = `${sandboxDir}/.olt/.sessions`;
    setInMemorySessionData(`${sessionsDir}/55555.json`, "NOT_JSON");
    setInMemorySessionData(
      `${sandboxDir}/.session.json`,
      JSON.stringify({ agent_id: "workspace-agent", role: "implementer" }),
    );

    expect(() =>
      resolveActiveSession({ cwd: sandboxDir, runRoot: sandboxDir, pid: 55555, ppid: 0, env: {} }),
    ).toThrow(HarnessError);
  });

  it("fails closed when a corrupt process record precedes valid environment evidence", () => {
    const sessionsDir = `${sandboxDir}/.olt/.sessions`;
    setInMemorySessionData(`${sessionsDir}/55556.json`, "NOT_JSON");

    expect(() =>
      resolveActiveSession({
        cwd: sandboxDir,
        runRoot: sandboxDir,
        pid: 55556,
        ppid: 0,
        env: { AGENT_ID: "environment-agent", ROLE: "implementer" },
      }),
    ).toThrow(HarnessError);
  });

  it("fails closed when the nearest workspace session is corrupt despite a valid parent identity", () => {
    const workspaceDir = `${sandboxDir}/child`;
    setInMemorySessionData(`${workspaceDir}/.session.json`, "{ broken json");
    setInMemorySessionData(
      `${sandboxDir}/.olt-identity.json`,
      JSON.stringify({ agent_id: "parent-agent", role: "implementer" }),
    );

    expect(() =>
      resolveActiveSession({ cwd: workspaceDir, runRoot: sandboxDir, pid: 0, ppid: 0, env: {} }),
    ).toThrow(HarnessError);
  });

  it("fails closed when persisted session evidence has an empty agent_id", () => {
    const sessionsDir = `${sandboxDir}/.olt/.sessions`;
    const sessionPath = `${sessionsDir}/55557.json`;
    setInMemorySessionData(sessionPath, JSON.stringify({ agent_id: "" }));

    expect(() =>
      resolveActiveSession({ cwd: sandboxDir, runRoot: sandboxDir, pid: 55557, ppid: 0, env: {} }),
    ).toThrow(HarnessError);
  });

  it("fails closed when the parent process session is corrupt before a valid child PID record", () => {
    const sessionsDir = `${sandboxDir}/.olt/.sessions`;
    const parentPath = `${sessionsDir}/55558.json`;
    setInMemorySessionData(parentPath, "NOT_JSON");
    setInMemorySessionData(
      `${sessionsDir}/55559.json`,
      JSON.stringify({ agent_id: "child-agent", role: "implementer" }),
    );

    expect(() =>
      resolveActiveSession({
        cwd: sandboxDir,
        runRoot: sandboxDir,
        pid: 55559,
        ppid: 55558,
        env: {},
      }),
    ).toThrow(HarnessError);
  });

  it("treats an injected own-data ENOENT read failure as absent evidence", () => {
    let reads = 0;
    const missing = Object.create(null) as { code?: string; message?: string };
    Object.defineProperty(missing, "code", { value: "ENOENT" });
    Object.defineProperty(missing, "message", { value: "gone" });

    const resolved = resolveWithInjectedRead(
      { cwd: sandboxDir, runRoot: sandboxDir, pid: 55560, ppid: 0, env: {} },
      () => {
        reads += 1;
        throw missing;
      },
    );

    expect(reads).toBeGreaterThan(0);
    expect(resolved).toBeNull();
  });

  it("fails closed for unsafe injected persisted-read error shapes", () => {
    const sessionPath = `${sandboxDir}/.olt/.sessions/55560.json`;
    let getterRead = false;
    const getterCode = {};
    Object.defineProperty(getterCode, "code", {
      get() {
        getterRead = true;
        return "ENOENT";
      },
    });
    const errorCases: ReadonlyArray<readonly [string, unknown, string]> = [
      ["inherited code", Object.create({ code: "ENOENT" }), "unknown error"],
      ["getter code", getterCode, "unknown error"],
      [
        "proxy descriptor trap",
        new Proxy(
          {},
          {
            getOwnPropertyDescriptor() {
              throw new Error("descriptor trap");
            },
          },
        ),
        "unknown error",
      ],
      ["primitive error", "primitive read failure", "primitive read failure"],
      ["EACCES", { code: "EACCES", message: "permission denied" }, "permission denied"],
    ];

    for (const [name, readError, cause] of errorCases) {
      try {
        resolveWithInjectedRead(
          { cwd: sandboxDir, runRoot: sandboxDir, pid: 55560, ppid: 0, env: {} },
          () => {
            throw readError;
          },
        );
        expect.unreachable(`${name} must not be treated as absent`);
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(HarnessError);
        expect((error as HarnessError).code).toBe("INTEGRITY");
        expect((error as HarnessError).message).toContain("process_ancestry_pid_55560");
        expect((error as HarnessError).message).toContain(sessionPath);
        expect((error as HarnessError).message).toContain(cause);
      }
    }

    expect(getterRead).toBe(false);
  });

  it("fails closed for every malformed optional persisted session field", () => {
    const malformedFields: ReadonlyArray<readonly [string, unknown]> = [
      ["role", ""],
      ["role", "   "],
      ["role", null],
      ["role", false],
      ["token", ""],
      ["token", "   "],
      ["token", null],
      ["token", ["tok_hidden_value"]],
      ["can_execute_shell", null],
      ["can_execute_shell", "true"],
      ["can_edit_files", null],
      ["can_edit_files", "false"],
      ["write_scope", "tests/authority"],
      ["write_scope", ["tests/authority", 1]],
      ["task_id", null],
      ["task_id", false],
      ["granted_at", null],
      ["granted_at", false],
    ];
    const sessionsDir = `${sandboxDir}/.olt/.sessions`;

    for (const [index, [field, value]] of malformedFields.entries()) {
      const pid = 55600 + index;
      const sessionPath = `${sessionsDir}/${pid}.json`;
      setInMemorySessionData(
        sessionPath,
        JSON.stringify({ agent_id: "valid-agent", [field]: value }),
      );

      try {
        resolveActiveSession({ cwd: sandboxDir, runRoot: sandboxDir, pid, ppid: 0, env: {} });
        expect.unreachable(`malformed ${field} must be rejected`);
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(HarnessError);
        expect((error as HarnessError).code).toBe("INTEGRITY");
        expect((error as HarnessError).message).toContain("process_ancestry_pid_");
        expect((error as HarnessError).message).toContain(sessionPath);
        expect((error as HarnessError).message).not.toContain("tok_hidden_value");
      }
    }
  });

  it("accepts legacy persisted identity records with every optional field omitted", () => {
    setInMemorySessionData(
      `${sandboxDir}/.olt-identity.json`,
      JSON.stringify({ agent_id: "legacy-agent" }),
    );

    const resolved = resolveActiveSession({
      cwd: sandboxDir,
      runRoot: sandboxDir,
      pid: 0,
      ppid: 0,
      env: {},
    });

    expect(resolved?.agent_id).toBe("legacy-agent");
    expect(resolved?.role).toBe("implementer");
    expect(resolved?.token).toBe("unauthenticated");
    expect(resolved?.mechanisms_detected).toEqual(["workspace_directory_session"]);
  });
});
