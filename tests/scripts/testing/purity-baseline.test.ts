import { describe, expect, test } from "bun:test";
import {
  parseBaseline,
  PURITY_BASELINE_SCHEMA,
} from "../../../scripts/testing/purity-baseline/index.ts";

const HEADER = `{"schema":"${PURITY_BASELINE_SCHEMA}"}`;

describe("purity baseline reason field support", () => {
  test("an entry with a valid reason string parses correctly", () => {
    const text = [
      HEADER,
      '{"file":"tests/alpha.test.ts","rule":"no-physical-fs-call","count":3,"reason":"containment auditor: asserts against live fs"}',
      "",
    ].join("\n");
    const doc = parseBaseline(text);
    expect(doc.entries).toEqual([
      {
        file: "tests/alpha.test.ts",
        rule: "no-physical-fs-call",
        count: 3,
        reason: "containment auditor: asserts against live fs",
      },
    ]);
  });

  test("an entry with reason: '' or whitespace-only throws baselineFailure", () => {
    expect(() =>
      parseBaseline(`${HEADER}\n{"file":"tests/a.test.ts","rule":"r","count":1,"reason":""}\n`),
    ).toThrow("line 2 has an invalid reason");

    expect(() =>
      parseBaseline(`${HEADER}\n{"file":"tests/a.test.ts","rule":"r","count":1,"reason":"   "}\n`),
    ).toThrow("line 2 has an invalid reason");
  });

  test("an entry with unknown keys still throws baselineFailure", () => {
    expect(() =>
      parseBaseline(
        `${HEADER}\n{"file":"tests/a.test.ts","rule":"r","count":1,"reason":"valid","extra":123}\n`,
      ),
    ).toThrow("has unknown keys");
  });
});
