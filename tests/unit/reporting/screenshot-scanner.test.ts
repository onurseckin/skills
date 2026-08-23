import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverScreenshotCandidates,
  extractImagesFromText,
  extractVisualReportsFromText,
  findVisualReportCandidates,
  scanDirectoryForImages,
  scanDirectoryForVisualReports,
} from "../../../olt/scripts/src/reporting/screenshot-scanner.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `screenshot-scanner-${name}-`));
  roots.push(dir);
  return dir;
}

describe("scanDirectoryForImages", () => {
  test("finds image files, skipping dotfiles, node_modules, .git, and .capsules", () => {
    const dir = tempDir("images");
    writeFileSync(join(dir, "a.png"), "x");
    writeFileSync(join(dir, "b.txt"), "x");
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules", "c.png"), "x");
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "d.png"), "x");
    mkdirSync(join(dir, ".capsules"));
    writeFileSync(join(dir, ".capsules", "e.png"), "x");
    writeFileSync(join(dir, ".hidden.png"), "x");

    expect(scanDirectoryForImages(dir)).toEqual([join(dir, "a.png")]);
  });

  test("recurses into nested subdirectories", () => {
    const dir = tempDir("nested-images");
    mkdirSync(join(dir, "sub", "deeper"), { recursive: true });
    writeFileSync(join(dir, "sub", "deeper", "shot.jpeg"), "x");

    expect(scanDirectoryForImages(dir)).toEqual([join(dir, "sub", "deeper", "shot.jpeg")]);
  });

  test("returns nothing for a directory that does not exist", () => {
    expect(scanDirectoryForImages(join(tempDir("absent"), "nope"))).toEqual([]);
  });

  test("stops recursing once the depth limit is exceeded", () => {
    const dir = tempDir("too-deep");
    let current = dir;
    for (let level = 0; level < 10; level += 1) {
      current = join(current, `level-${level}`);
      mkdirSync(current);
    }
    writeFileSync(join(current, "buried.png"), "x");

    expect(scanDirectoryForImages(dir, 2)).toEqual([]);
  });

  test("a directory that cannot be read is skipped rather than throwing", () => {
    const dir = tempDir("unreadable");
    const locked = join(dir, "locked");
    mkdirSync(locked);
    writeFileSync(join(locked, "shot.png"), "x");
    chmodSync(locked, 0o000);

    expect(() => scanDirectoryForImages(dir)).not.toThrow();
    chmodSync(locked, 0o755);
  });
});

describe("scanDirectoryForVisualReports", () => {
  test("finds report files by the recognised naming patterns", () => {
    const dir = tempDir("reports");
    writeFileSync(join(dir, "visual-report.json"), "{}");
    writeFileSync(join(dir, "home-visual-report.json"), "{}");
    writeFileSync(join(dir, "visual_report.json"), "{}");
    writeFileSync(join(dir, "unrelated.json"), "{}");

    expect(scanDirectoryForVisualReports(dir).sort()).toEqual(
      [
        join(dir, "home-visual-report.json"),
        join(dir, "visual-report.json"),
        join(dir, "visual_report.json"),
      ].sort(),
    );
  });

  test("recurses and skips dot/system directories", () => {
    const dir = tempDir("reports-nested");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "visual-report.json"), "{}");
    mkdirSync(join(dir, ".capsules"));
    writeFileSync(join(dir, ".capsules", "visual-report.json"), "{}");

    expect(scanDirectoryForVisualReports(dir)).toEqual([join(dir, "sub", "visual-report.json")]);
  });

  test("returns nothing for a directory that does not exist", () => {
    expect(scanDirectoryForVisualReports(join(tempDir("absent-vr"), "nope"))).toEqual([]);
  });
});

describe("extractImagesFromText", () => {
  test("resolves relative mentions against the given base directory", () => {
    const dir = tempDir("extract-images");
    writeFileSync(join(dir, "shot.png"), "x");

    expect(extractImagesFromText("saved to shot.png", dir)).toEqual([join(dir, "shot.png")]);
  });

  test("resolves an absolute path mention directly", () => {
    const dir = tempDir("extract-images-abs");
    const path = join(dir, "abs.png");
    writeFileSync(path, "x");

    expect(extractImagesFromText(`wrote ${path}`)).toEqual([path]);
  });

  test("without a base directory, resolves relative to the current working directory", () => {
    expect(extractImagesFromText("no-such-relative-file.png")).toEqual([]);
  });

  test("ignores a mention of a file that does not exist", () => {
    expect(extractImagesFromText("phantom.png", tempDir("extract-images-phantom"))).toEqual([]);
  });

  test("empty text yields no matches", () => {
    expect(extractImagesFromText("")).toEqual([]);
  });

  test("ignores a path that resolves to a directory, not a file", () => {
    const dir = tempDir("extract-images-dir");
    mkdirSync(join(dir, "shot.png"));

    expect(extractImagesFromText("shot.png", dir)).toEqual([]);
  });
});

describe("extractVisualReportsFromText", () => {
  test("resolves a relative visual-report mention against the base directory", () => {
    const dir = tempDir("extract-reports");
    writeFileSync(join(dir, "visual-report.json"), "{}");

    expect(extractVisualReportsFromText("wrote visual-report.json", dir)).toEqual([
      join(dir, "visual-report.json"),
    ]);
  });

  test("empty text yields no matches", () => {
    expect(extractVisualReportsFromText("")).toEqual([]);
  });

  test("ignores mentions of files that do not exist", () => {
    expect(extractVisualReportsFromText("phantom-visual-report.json")).toEqual([]);
  });
});

describe("discoverScreenshotCandidates", () => {
  test("collects explicit paths, recognised subdirectories, top-level files, and text mentions", () => {
    const dir = tempDir("discover");
    const explicit = join(dir, "explicit.png");
    writeFileSync(explicit, "x");
    writeFileSync(join(dir, "top.png"), "x");
    mkdirSync(join(dir, "screenshots"));
    writeFileSync(join(dir, "screenshots", "nested.png"), "x");
    const cited = join(dir, "cited.png");
    writeFileSync(cited, "x");

    const found = discoverScreenshotCandidates([dir], `stdout mentions ${cited}`, undefined, [
      explicit,
      "",
    ]);

    expect(found.sort()).toEqual(
      [explicit, join(dir, "top.png"), join(dir, "screenshots", "nested.png"), cited].sort(),
    );
  });

  test("ignores an explicit path that does not exist or is not an image", () => {
    const dir = tempDir("discover-bad-explicit");
    const notImage = join(dir, "notes.txt");
    writeFileSync(notImage, "x");

    expect(
      discoverScreenshotCandidates([], undefined, undefined, [join(dir, "absent.png")]),
    ).toEqual([]);
    expect(discoverScreenshotCandidates([], undefined, undefined, [notImage])).toEqual([]);
  });

  test("a search dir that does not exist contributes nothing", () => {
    expect(discoverScreenshotCandidates(["/nonexistent/for/sure"])).toEqual([]);
  });

  test("finds candidates mentioned in stderr as well as stdout", () => {
    const dir = tempDir("discover-stderr");
    const path = join(dir, "err.png");
    writeFileSync(path, "x");

    expect(discoverScreenshotCandidates([], undefined, `wrote ${path}`)).toEqual([path]);
  });
});

describe("findVisualReportCandidates", () => {
  test("collects explicit paths, recognised subdirectories, top-level files, and text mentions", () => {
    const dir = tempDir("find-vr");
    const explicit = join(dir, "explicit-visual-report.json");
    writeFileSync(explicit, "{}");
    writeFileSync(join(dir, "visual-report.json"), "{}");
    mkdirSync(join(dir, "test-results"));
    writeFileSync(join(dir, "test-results", "nested-visual-report.json"), "{}");
    const cited = join(dir, "cited-visual-report.json");
    writeFileSync(cited, "{}");

    const found = findVisualReportCandidates([dir], `stdout mentions ${cited}`, undefined, [
      explicit,
      "",
    ]);

    expect(found.sort()).toEqual(
      [
        explicit,
        join(dir, "visual-report.json"),
        join(dir, "test-results", "nested-visual-report.json"),
        cited,
      ].sort(),
    );
  });

  test("ignores an explicit path that does not exist or is not a visual report", () => {
    const dir = tempDir("find-vr-bad-explicit");
    const notReport = join(dir, "notes.txt");
    writeFileSync(notReport, "x");

    expect(
      findVisualReportCandidates([], undefined, undefined, [join(dir, "absent.json")]),
    ).toEqual([]);
    expect(findVisualReportCandidates([], undefined, undefined, [notReport])).toEqual([]);
  });

  test("a search dir that does not exist contributes nothing", () => {
    expect(findVisualReportCandidates(["/nonexistent/for/sure"])).toEqual([]);
  });

  test("finds candidates mentioned in stderr as well as stdout", () => {
    const dir = tempDir("find-vr-stderr");
    const path = join(dir, "err-visual-report.json");
    writeFileSync(path, "{}");

    expect(findVisualReportCandidates([], undefined, `wrote ${path}`)).toEqual([path]);
  });
});
