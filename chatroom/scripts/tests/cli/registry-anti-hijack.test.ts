import { describe, expect, it } from "bun:test";
import {
  CHAT_COMMANDS,
  ackCommand,
  ackSpec,
  daemonCommand,
  daemonSpec,
  doctorCommand,
  doctorSpec,
  executeCommand,
  readCommand,
  readSpec,
  watchCommand,
  watchSpec,
} from "../../src/cli/index.ts";

describe("Registry Anti-Hijack Surface", () => {
  it("ensures every command in CHAT_COMMANDS excludes the reader flag", () => {
    expect(CHAT_COMMANDS.length).toBeGreaterThan(0);
    for (const cmd of CHAT_COMMANDS) {
      const flagNames = cmd.flags.map((flag) => flag.name);
      expect(flagNames).not.toContain("reader");
    }
  });

  it("specifically asserts that watchSpec declares neither reader nor ack-mode", () => {
    const watchFlagNames = watchSpec.flags.map((flag) => flag.name);
    expect(watchFlagNames).not.toContain("reader");
    expect(watchFlagNames).not.toContain("ack-mode");
  });

  it("specifically asserts that daemonSpec and doctorSpec do not declare reader", () => {
    const daemonFlagNames = daemonSpec.flags.map((flag) => flag.name);
    expect(daemonFlagNames).not.toContain("reader");
    const doctorFlagNames = doctorSpec.flags.map((flag) => flag.name);
    expect(doctorFlagNames).not.toContain("reader");
  });

  it("ensures readSpec has no source flag", () => {
    const sourceFlag = readSpec.flags.find((flag) => flag.name === "source");
    expect(sourceFlag).toBeUndefined();
  });

  it("throws INVALID_ARGUMENT when readCommand or ackCommand is called with --reader", async () => {
    let readErrorCode = "";
    try {
      await readCommand({ room: "room-1", reader: "victim" }, {});
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        readErrorCode = String((err as { code: unknown }).code);
      }
    }
    expect(readErrorCode).toBe("INVALID_ARGUMENT");

    let ackErrorCode = "";
    try {
      await ackCommand({ room: "room-1", reader: "victim", lease: "l-1" }, {});
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        ackErrorCode = String((err as { code: unknown }).code);
      }
    }
    expect(ackErrorCode).toBe("INVALID_ARGUMENT");

    let cliReadErrorCode = "";
    try {
      await executeCommand(["chat:read", "--room", "room-1", "--reader", "victim"]);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        cliReadErrorCode = String((err as { code: unknown }).code);
      }
    }
    expect(cliReadErrorCode).toBe("INVALID_ARGUMENT");

    let cliAckErrorCode = "";
    try {
      await executeCommand([
        "chat:ack",
        "--room",
        "room-1",
        "--lease",
        "l-1",
        "--reader",
        "victim",
      ]);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        cliAckErrorCode = String((err as { code: unknown }).code);
      }
    }
    expect(cliAckErrorCode).toBe("INVALID_ARGUMENT");
  });

  it("throws INVALID_ARGUMENT when watchCommand, daemonCommand, or doctorCommand is called with --reader", async () => {
    let watchErrorCode = "";
    try {
      await watchCommand({ room: "room-1", reader: "victim" }, {});
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        watchErrorCode = String((err as { code: unknown }).code);
      }
    }
    expect(watchErrorCode).toBe("INVALID_ARGUMENT");

    let daemonErrorCode = "";
    try {
      await daemonCommand({ room: "room-1", reader: "victim", status: true }, {});
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        daemonErrorCode = String((err as { code: unknown }).code);
      }
    }
    expect(daemonErrorCode).toBe("INVALID_ARGUMENT");

    let doctorErrorCode = "";
    try {
      await doctorCommand({ room: "room-1", reader: "victim" }, {});
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        doctorErrorCode = String((err as { code: unknown }).code);
      }
    }
    expect(doctorErrorCode).toBe("INVALID_ARGUMENT");
  });

  it("throws INVALID_ARGUMENT when watch, daemon, or doctor CLI commands are executed with --reader", async () => {
    let cliWatchErrorCode = "";
    try {
      await executeCommand(["chat:watch", "--room", "room-1", "--reader", "victim"]);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        cliWatchErrorCode = String((err as { code: unknown }).code);
      }
    }
    expect(cliWatchErrorCode).toBe("INVALID_ARGUMENT");

    let cliDaemonErrorCode = "";
    try {
      await executeCommand(["chat:daemon", "--room", "room-1", "--status", "--reader", "victim"]);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        cliDaemonErrorCode = String((err as { code: unknown }).code);
      }
    }
    expect(cliDaemonErrorCode).toBe("INVALID_ARGUMENT");

    let cliDoctorErrorCode = "";
    try {
      await executeCommand(["chat:doctor", "--room", "room-1", "--reader", "victim"]);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        cliDoctorErrorCode = String((err as { code: unknown }).code);
      }
    }
    expect(cliDoctorErrorCode).toBe("INVALID_ARGUMENT");
  });

  it("throws INVALID_ARGUMENT when readCommand is called with --source", async () => {
    let sourceErrorCode = "";
    try {
      await readCommand({ room: "room-1", source: "spool" }, {});
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        sourceErrorCode = String((err as { code: unknown }).code);
      }
    }
    expect(sourceErrorCode).toBe("INVALID_ARGUMENT");
  });
});
