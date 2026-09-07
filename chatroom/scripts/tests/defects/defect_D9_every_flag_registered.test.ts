import { describe, expect, it } from "bun:test";
import ts from "typescript";
import {
  ackSpec,
  daemonSpec,
  doctorSpec,
  executeCommand,
  initSpec,
  inviteSpec,
  joinSpec,
  readSpec,
  roomsSpec,
  saySpec,
  watchSpec,
} from "../../src/cli/index.ts";

const COMMAND_SPECS = [
  { spec: initSpec, file: "lifecycle/init.ts" },
  { spec: inviteSpec, file: "lifecycle/invite.ts" },
  { spec: joinSpec, file: "lifecycle/join.ts" },
  { spec: saySpec, file: "say.ts" },
  { spec: readSpec, file: "read.ts" },
  { spec: ackSpec, file: "ack.ts" },
  { spec: watchSpec, file: "watch.ts" },
  { spec: daemonSpec, file: "daemon.ts" },
  { spec: doctorSpec, file: "doctor.ts" },
  { spec: roomsSpec, file: "lifecycle/rooms.ts" },
] as const;

const FLAG_READER_FUNCTIONS = new Set([
  "textFlag",
  "intFlag",
  "boolFlag",
  "listFlag",
  "readStringFlag",
  "readBoolFlag",
]);

async function extractFlagsFromHandler(file: string): Promise<Set<string>> {
  const code = await Bun.file(
    new URL(`../../src/cli/commands/${file}`, import.meta.url).pathname,
  ).text();

  const sourceFile = ts.createSourceFile("handler.ts", code, ts.ScriptTarget.Latest, true);
  const handlerFlags = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const fnName = node.expression.getText(sourceFile);
      if (FLAG_READER_FUNCTIONS.has(fnName) && node.arguments.length >= 2) {
        const flagArg = node.arguments[1];
        if (flagArg !== undefined && ts.isStringLiteral(flagArg)) {
          handlerFlags.add(flagArg.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return handlerFlags;
}

describe("Defect D9: every handler flag is registered and no dead flags exist", () => {
  for (const { spec, file } of COMMAND_SPECS) {
    it(`verifies complete flag parity for ${spec.name}`, async () => {
      const handlerFlags = await extractFlagsFromHandler(file);
      const specFlags = new Set(spec.flags.map((f) => f.name));

      for (const flagName of handlerFlags) {
        expect(specFlags.has(flagName)).toBe(true);
      }

      for (const flagName of specFlags) {
        if (flagName === "json") {
          continue;
        }
        expect(handlerFlags.has(flagName)).toBe(true);
      }
    });
  }

  it("rejects unregistered flags at the CLI boundary with INVALID_ARGUMENT", async () => {
    let error: unknown;
    try {
      await executeCommand(["chat:read", "--room", "test", "--bogus-flag", "val"]);
    } catch (err: unknown) {
      error = err;
    }

    expect(error).toBeDefined();
    const cliErr = error as { code: string; message: string };
    expect(cliErr.code).toBe("INVALID_ARGUMENT");
    expect(cliErr.message.includes("bogus-flag")).toBe(true);
  });
});
