import { expect, test } from "bun:test";

const MISSING_MODULE_SPECIFIER = "./module-that-does-not-exist.ts";

await import(MISSING_MODULE_SPECIFIER);

test("this case can never register because the module never loads", () => {
  expect(true).toBe(true);
});
