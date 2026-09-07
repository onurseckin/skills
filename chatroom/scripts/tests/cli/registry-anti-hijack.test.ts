import { describe, expect, it } from "bun:test";
import { ackCommand, ackSpec, executeCommand, readCommand, readSpec } from "../../src/cli/index.ts";

const chatRegistry = [readSpec, ackSpec];

describe("Registry Anti-Hijack Surface", () => {
  it("ensures no command in chatRegistry includes a reader flag", () => {
    for (const spec of chatRegistry) {
      const readerFlag = spec.flags.find((flag) => flag.name === "reader");
      expect(readerFlag).toBeUndefined();
    }
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
