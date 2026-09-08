import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { daemonHealthPath } from "../../chatroom/scripts/src/core/index.ts";
import {
  createInitialHealthRecord,
  writeHealthRecord,
} from "../../chatroom/scripts/src/daemon/index.ts";
import {
  verifyCronWiring,
  type WireCronOptions,
  type WireCronResult,
} from "../../chatroom/scripts/src/provision/index.ts";

describe("verifyCronWiring", () => {
  let tempDir: string | undefined;
  let previousChatroomHome: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cron-verify-test-"));
    previousChatroomHome = process.env["CHATROOM_HOME"];
    process.env["CHATROOM_HOME"] = tempDir;
  });

  afterEach(() => {
    try {
      if (tempDir && existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } finally {
      if (previousChatroomHome !== undefined) {
        process.env["CHATROOM_HOME"] = previousChatroomHome;
      } else {
        delete process.env["CHATROOM_HOME"];
      }
    }
  });

  describe("schedule mechanism", () => {
    it("returns true when schedule file exists and contains daemon tick", () => {
      const scheduleFile = join(tempDir ?? "", "schedule.json");
      writeFileSync(scheduleFile, JSON.stringify({ command: "chat:daemon --tick" }), "utf8");
      const result: WireCronResult = {
        mechanism: "schedule",
        expression: ["*", "/5 * * * *"].join(""),
        cadence_seconds: 300,
        configPath: scheduleFile,
      };
      expect(verifyCronWiring(result)).toBe(true);
    });

    it("returns false when schedule file does not exist", () => {
      const result: WireCronResult = {
        mechanism: "schedule",
        expression: ["*", "/5 * * * *"].join(""),
        cadence_seconds: 300,
        configPath: join(tempDir ?? "", "missing.json"),
      };
      expect(verifyCronWiring(result)).toBe(false);
    });

    it("returns false when schedule file does not contain daemon tick", () => {
      const scheduleFile = join(tempDir ?? "", "unrelated.json");
      writeFileSync(scheduleFile, JSON.stringify({ command: "other:command" }), "utf8");
      const result: WireCronResult = {
        mechanism: "schedule",
        expression: ["*", "/5 * * * *"].join(""),
        cadence_seconds: 300,
        configPath: scheduleFile,
      };
      expect(verifyCronWiring(result)).toBe(false);
    });

    it("returns false when configPath is null", () => {
      const result: WireCronResult = {
        mechanism: "schedule",
        expression: ["*", "/5 * * * *"].join(""),
        cadence_seconds: 300,
        configPath: null,
      };
      expect(verifyCronWiring(result)).toBe(false);
    });
  });

  describe("settings_hooks mechanism", () => {
    it("returns true when settings file exists and contains daemon tick", () => {
      const settingsFile = join(tempDir ?? "", "settings.json");
      writeFileSync(
        settingsFile,
        JSON.stringify({ hooks: { PostToolUse: ["chat:daemon --tick"] } }),
        "utf8",
      );
      const result: WireCronResult = {
        mechanism: "settings_hooks",
        expression: null,
        cadence_seconds: 900,
        configPath: settingsFile,
      };
      expect(verifyCronWiring(result)).toBe(true);
    });

    it("returns false when settings file is missing or lacks daemon tick", () => {
      const missingResult: WireCronResult = {
        mechanism: "settings_hooks",
        expression: null,
        cadence_seconds: 900,
        configPath: join(tempDir ?? "", "absent-settings.json"),
      };
      expect(verifyCronWiring(missingResult)).toBe(false);

      const emptySettingsFile = join(tempDir ?? "", "empty-settings.json");
      writeFileSync(emptySettingsFile, "{}", "utf8");
      const emptyResult: WireCronResult = {
        mechanism: "settings_hooks",
        expression: null,
        cadence_seconds: 900,
        configPath: emptySettingsFile,
      };
      expect(verifyCronWiring(emptyResult)).toBe(false);
    });
  });

  describe("notify_hook mechanism", () => {
    it("returns true when config toml exists and contains daemon tick", () => {
      const configFile = join(tempDir ?? "", "config.toml");
      writeFileSync(configFile, 'notify_hook = "chat:daemon --tick"\n', "utf8");
      const result: WireCronResult = {
        mechanism: "notify_hook",
        expression: null,
        cadence_seconds: 900,
        configPath: configFile,
      };
      expect(verifyCronWiring(result)).toBe(true);
    });

    it("returns false when config toml does not exist or lacks daemon tick", () => {
      const missingResult: WireCronResult = {
        mechanism: "notify_hook",
        expression: null,
        cadence_seconds: 900,
        configPath: join(tempDir ?? "", "missing-config.toml"),
      };
      expect(verifyCronWiring(missingResult)).toBe(false);

      const unrelatedFile = join(tempDir ?? "", "unrelated.toml");
      writeFileSync(unrelatedFile, 'notify_hook = "other:task"\n', "utf8");
      const unrelatedResult: WireCronResult = {
        mechanism: "notify_hook",
        expression: null,
        cadence_seconds: 900,
        configPath: unrelatedFile,
      };
      expect(verifyCronWiring(unrelatedResult)).toBe(false);
    });
  });

  describe("self_watchdog mechanism", () => {
    const watchdogResult: WireCronResult = {
      mechanism: "self_watchdog",
      expression: null,
      cadence_seconds: 300,
      configPath: null,
    };

    it("returns false when options is missing or options.room is empty", () => {
      expect(verifyCronWiring(watchdogResult)).toBe(false);
      expect(verifyCronWiring(watchdogResult, { host: "local", room: "" })).toBe(false);
    });

    it("returns false when daemon is absent or not running", () => {
      const options: WireCronOptions = {
        host: "local",
        room: "absent-room",
        reader: "absent-reader",
      };
      expect(verifyCronWiring(watchdogResult, options)).toBe(false);
    });

    it("returns false when daemon health record has a dead process pid", () => {
      const room = "test-room-dead";
      const reader = "test-reader";
      const deadPid = 99999999;
      const healthPath = daemonHealthPath(room, reader);
      mkdirSync(dirname(healthPath), { recursive: true });
      const record = createInitialHealthRecord(
        room,
        reader,
        deadPid,
        new Date().toISOString(),
        "boot-dead",
      );
      writeHealthRecord(healthPath, record);
      const options: WireCronOptions = {
        host: "local",
        room,
        reader,
      };
      expect(verifyCronWiring(watchdogResult, options)).toBe(false);
    });

    it("returns false when daemon health record is expired or stopped", () => {
      const room = "test-room-stopped";
      const reader = "test-reader";
      const healthPath = daemonHealthPath(room, reader);
      mkdirSync(dirname(healthPath), { recursive: true });
      const staleTimestamp = new Date(Date.now() - 60000).toISOString();
      const record = {
        ...createInitialHealthRecord(room, reader, process.pid, staleTimestamp, "boot-stale"),
        state: "STOPPED" as const,
        last_wake_at: staleTimestamp,
      };
      writeHealthRecord(healthPath, record);
      const options: WireCronOptions = {
        host: "local",
        room,
        reader,
      };
      expect(verifyCronWiring(watchdogResult, options)).toBe(false);
    });

    it("delegates to checkDaemon callback when provided", () => {
      const room = "test-room-custom";
      const reader = "test-reader";
      let capturedRoom = "";
      let capturedReader: string | undefined;

      const falseOptions: WireCronOptions = {
        host: "local",
        room,
        reader,
        checkDaemon: (r, readerArg) => {
          capturedRoom = r;
          capturedReader = readerArg;
          return false;
        },
      };
      expect(verifyCronWiring(watchdogResult, falseOptions)).toBe(false);
      expect(capturedRoom).toBe(room);
      expect(capturedReader).toBe(reader);

      const trueOptions: WireCronOptions = {
        host: "local",
        room,
        reader,
        checkDaemon: () => true,
      };
      expect(verifyCronWiring(watchdogResult, trueOptions)).toBe(true);
    });

    it("returns true when daemon is healthy and running with specified reader", () => {
      const room = "test-room-live";
      const reader = "test-reader";
      const healthPath = daemonHealthPath(room, reader);
      mkdirSync(dirname(healthPath), { recursive: true });
      const record = createInitialHealthRecord(
        room,
        reader,
        process.pid,
        new Date().toISOString(),
        "boot-live",
      );
      writeHealthRecord(healthPath, record);
      const options: WireCronOptions = {
        host: "local",
        room,
        reader,
      };
      expect(verifyCronWiring(watchdogResult, options)).toBe(true);
    });

    it("returns true when daemon is healthy and reader is omitted", () => {
      const room = "test-room-no-reader";
      const reader = "inferred-reader";
      const healthPath = daemonHealthPath(room, reader);
      mkdirSync(dirname(healthPath), { recursive: true });
      const record = createInitialHealthRecord(
        room,
        reader,
        process.pid,
        new Date().toISOString(),
        "boot-inferred",
      );
      writeHealthRecord(healthPath, record);
      const options: WireCronOptions = {
        host: "local",
        room,
      };
      expect(verifyCronWiring(watchdogResult, options)).toBe(true);
    });

    it("vacuity test: missing daemon is rejected by hardened check but accepted by unhardened check", () => {
      const options: WireCronOptions = {
        host: "local",
        room: "vacuity-absent-room",
        reader: "vacuity-absent-reader",
      };
      const unhardenedLegacyVerify = (res: WireCronResult): boolean => {
        if (res.mechanism === "self_watchdog") {
          return true;
        }
        return false;
      };
      const hardenedVerified = verifyCronWiring(watchdogResult, options);
      const unhardenedVerified = unhardenedLegacyVerify(watchdogResult);

      expect(hardenedVerified).toBe(false);
      expect(unhardenedVerified).toBe(true);
      expect(hardenedVerified).not.toBe(unhardenedVerified);
    });
  });
});
