import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  discoverScreenshotCandidates,
  extractImagesFromText,
  extractVisualReportsFromText,
  findVisualReportCandidates,
  scanDirectoryForImages,
  scanDirectoryForVisualReports,
} from "../../../olt/scripts/src/reporting/screenshot-scanner.ts";
import { cleanupVirtualBrowserFS, setupVirtualBrowserFS, tempDir } from "./browser-run-fixture.ts";

export const screenshotScannerSuiteName = "scanDirectoryForImages & screenshot scanning";

describe(screenshotScannerSuiteName, () => {
  let vfs: ReturnType<typeof setupVirtualBrowserFS>;

  beforeEach(() => {
    vfs = setupVirtualBrowserFS();
  });

  afterEach(() => {
    cleanupVirtualBrowserFS();
  });

  test("finds image files, skipping dotfiles, node_modules, .git, and .capsules", () => {
    const dir = tempDir("images");
    vfs.writeFileSync(join(dir, "a.png"), "x");
    vfs.writeFileSync(join(dir, "b.txt"), "x");
    vfs.mkdirSync(join(dir, "node_modules"), { recursive: true });
    vfs.writeFileSync(join(dir, "node_modules", "c.png"), "x");
    vfs.mkdirSync(join(dir, ".git"), { recursive: true });
    vfs.writeFileSync(join(dir, ".git", "d.png"), "x");
    vfs.mkdirSync(join(dir, ".olt", "capsules"), { recursive: true });
    vfs.writeFileSync(join(dir, ".olt", "capsules", "e.png"), "x");
    vfs.writeFileSync(join(dir, ".hidden.png"), "x");

    expect(scanDirectoryForImages(dir)).toEqual([join(dir, "a.png")]);
  });

  test("recurses into nested subdirectories", () => {
    const dir = tempDir("nested-images");
    vfs.mkdirSync(join(dir, "sub", "deeper"), { recursive: true });
    vfs.writeFileSync(join(dir, "sub", "deeper", "shot.jpeg"), "x");

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
      vfs.mkdirSync(current, { recursive: true });
    }
    vfs.writeFileSync(join(current, "buried.png"), "x");

    expect(scanDirectoryForImages(dir, 2)).toEqual([]);
  });

  test("a directory that cannot be read is skipped rather than throwing", () => {
    const dir = tempDir("unreadable");
    const locked = join(dir, "locked");
    vfs.mkdirSync(locked, { recursive: true });
    vfs.writeFileSync(join(locked, "shot.png"), "x");

    expect(() => scanDirectoryForImages(dir)).not.toThrow();
  });

  test("finds report files by the recognised naming patterns", () => {
    const dir = tempDir("reports");
    vfs.mkdirSync(dir, { recursive: true });
    vfs.writeFileSync(join(dir, "visual-report.json"), "{}");
    vfs.writeFileSync(join(dir, "home-visual-report.json"), "{}");
    vfs.writeFileSync(join(dir, "visual_report.json"), "{}");
    vfs.writeFileSync(join(dir, "unrelated.json"), "{}");

    expect(scanDirectoryForVisualReports(dir).sort()).toEqual(
      [
        join(dir, "home-visual-report.json"),
        join(dir, "visual-report.json"),
        join(dir, "visual_report.json"),
      ].sort(),
    );
  });

  test("extractImagesFromText pulls valid paths out of text", () => {
    const dir = tempDir("extract-text");
    vfs.mkdirSync(dir, { recursive: true });
    const png = join(dir, "screen.png");
    const jpg = join(dir, "photo.jpg");
    vfs.writeFileSync(png, "x");
    vfs.writeFileSync(jpg, "x");

    const text = `wrote screenshot to ${png} and another to ${jpg} and ignored absent.png`;
    expect(extractImagesFromText(text)).toEqual([png, jpg]);
  });

  test("extractVisualReportsFromText pulls valid visual reports out of text", () => {
    const dir = tempDir("extract-vr");
    vfs.mkdirSync(dir, { recursive: true });
    const vr = join(dir, "visual-report.json");
    vfs.writeFileSync(vr, "{}");

    const text = `saved report at ${vr} and not at missing-visual-report.json`;
    expect(extractVisualReportsFromText(text)).toEqual([vr]);
  });

  test("discoverScreenshotCandidates collects explicit paths, search dirs, and stdout/stderr", () => {
    const dir = tempDir("discover");
    vfs.mkdirSync(dir, { recursive: true });
    const explicit = join(dir, "explicit.png");
    const found = join(dir, "found.png");
    const stdoutPath = join(dir, "stdout.png");
    vfs.writeFileSync(explicit, "x");
    vfs.writeFileSync(found, "x");
    vfs.writeFileSync(stdoutPath, "x");

    const candidates = discoverScreenshotCandidates([dir], `output: ${stdoutPath}`, undefined, [
      explicit,
    ]);

    expect(candidates.sort()).toEqual([explicit, found, stdoutPath].sort());
  });

  test("collects explicit paths, recognised subdirectories, and text mentions", () => {
    const dir = tempDir("find-vr");
    vfs.mkdirSync(dir, { recursive: true });
    const explicit = join(dir, "explicit-visual-report.json");
    vfs.writeFileSync(explicit, "{}");
    vfs.writeFileSync(join(dir, "visual-report.json"), "{}");
    vfs.mkdirSync(join(dir, "test-results"), { recursive: true });
    vfs.writeFileSync(join(dir, "test-results", "nested-visual-report.json"), "{}");
    const cited = join(dir, "cited-visual-report.json");
    vfs.writeFileSync(cited, "{}");

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
    vfs.mkdirSync(dir, { recursive: true });
    const notReport = join(dir, "notes.txt");
    vfs.writeFileSync(notReport, "x");

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
    vfs.mkdirSync(dir, { recursive: true });
    const path = join(dir, "err-visual-report.json");
    vfs.writeFileSync(path, "{}");

    expect(findVisualReportCandidates([], undefined, `wrote ${path}`)).toEqual([path]);
  });
});
