import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";
import {
  exchangePaths,
  renameNoReplace,
} from "../../../olt/scripts/src/installer/native-rename.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("renameNoReplace", () => {
  test("moves a directory to a new, non-existent destination", () => {
    const root = scratchRoot(import.meta.path, "rename-success");
    const source = join(root, "source");
    const destination = join(root, "destination");
    mkdirSync(source);
    writeFileSync(join(source, "file.txt"), "hello");
    renameNoReplace(source, destination, "test move");
    expect(readFileSync(join(destination, "file.txt"), "utf8")).toBe("hello");
  });

  test("throws a HarnessError naming the destination when it already exists", () => {
    const root = scratchRoot(import.meta.path, "rename-eexist");
    const source = join(root, "source");
    const destination = join(root, "destination");
    mkdirSync(source);
    mkdirSync(destination);
    expect(() => renameNoReplace(source, destination, "test move")).toThrow(HarnessError);
    try {
      renameNoReplace(source, destination, "test move");
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).message).toContain("destination already exists");
      expect((error as HarnessError).message).toContain("test move");
    }
  });

  test("throws a HarnessError reporting the errno when the source does not exist", () => {
    const root = scratchRoot(import.meta.path, "rename-enoent");
    const source = join(root, "missing-source");
    const destination = join(root, "destination");
    expect(() => renameNoReplace(source, destination, "test move")).toThrow(HarnessError);
    try {
      renameNoReplace(source, destination, "test move");
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).message).toContain("rename failed with errno");
    }
  });
});

describe("exchangePaths", () => {
  test("swaps the contents of two existing directories", () => {
    const root = scratchRoot(import.meta.path, "exchange-success");
    const left = join(root, "left");
    const right = join(root, "right");
    mkdirSync(left);
    mkdirSync(right);
    writeFileSync(join(left, "file.txt"), "left-content");
    writeFileSync(join(right, "file.txt"), "right-content");
    exchangePaths(left, right, "test exchange");
    expect(readFileSync(join(left, "file.txt"), "utf8")).toBe("right-content");
    expect(readFileSync(join(right, "file.txt"), "utf8")).toBe("left-content");
  });

  test("throws a HarnessError when one side of the exchange does not exist", () => {
    const root = scratchRoot(import.meta.path, "exchange-missing");
    const left = join(root, "left");
    const right = join(root, "missing-right");
    mkdirSync(left);
    expect(() => exchangePaths(left, right, "test exchange")).toThrow(HarnessError);
  });
});
