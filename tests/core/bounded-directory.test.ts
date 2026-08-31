import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collectBoundedDirectoryEntries } from "../../olt/scripts/src/core/bounded-directory.ts";

interface Entry {
  name: string;
}

function reader(names: string[]) {
  let reads = 0;
  let closed = false;
  return {
    directory: {
      readSync(): Entry | null {
        const name = names[reads++];
        return name === undefined ? null : { name };
      },
      closeSync(): void {
        closed = true;
      },
    },
    state: () => ({ reads, closed }),
  };
}

describe("bounded streaming directory enumeration", () => {
  test("stops at remaining-cap plus one, closes, and fails before sorting", () => {
    const source = reader(["c", "b", "a", "unreached"]);
    let comparisons = 0;
    expect(() =>
      collectBoundedDirectoryEntries(
        source.directory,
        2,
        () => new Error("directory cap exceeded"),
        (left, right) => {
          comparisons += 1;
          return left.name.localeCompare(right.name);
        },
      ),
    ).toThrow("directory cap exceeded");
    expect(source.state()).toEqual({ reads: 3, closed: true });
    expect(comparisons).toBe(0);
  });

  test("sorts only the bounded entries and closes on success", () => {
    const source = reader(["c", "a", "b"]);
    expect(
      collectBoundedDirectoryEntries(
        source.directory,
        3,
        () => new Error("directory cap exceeded"),
        (left, right) => left.name.localeCompare(right.name),
      ).map(({ name }) => name),
    ).toEqual(["a", "b", "c"]);
    expect(source.state()).toEqual({ reads: 4, closed: true });
  });

  test("routes every repository directory walk through the bounded streaming helper", () => {
    const sourceRoot = join(import.meta.dir, "..", "..", "..", "olt", "scripts", "src");
    for (const relative of [
      "packets/repository-content-paths.ts",
      "packets/repository-snapshot.ts",
      "engine/runner/signing/gate-path-tree.ts",
    ]) {
      const source = readFileSync(join(sourceRoot, relative), "utf8");
      expect(source).toContain("opendirSync");
      expect(source).toContain("collectBoundedDirectoryEntries");
      expect(source).not.toContain("readdirSync");
    }
  });
});
