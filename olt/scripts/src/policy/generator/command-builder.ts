import type { RepoEcosystem, PackageManager } from "../types/index.ts";
import type { ParsedMakefile, ParsedPythonManifest } from "./manifest-readers.ts";

export interface AllowedCommandsContext {
  readonly ecosystem: RepoEcosystem;
  readonly packageManager?: PackageManager | undefined;
  readonly isMonorepo: boolean;
  readonly isTs: boolean;
  readonly hasOxlint: boolean;
  readonly hasBiome: boolean;
  readonly hasEslint: boolean;
  readonly hasVitest: boolean;
  readonly hasJest: boolean;
  readonly py: ParsedPythonManifest;
  readonly make: ParsedMakefile;
  readonly turboExists: boolean;
}

export function buildAllowedCommands(ctx: AllowedCommandsContext): readonly string[] {
  const cmds = new Set<string>();

  if (ctx.ecosystem === "bun") {
    [
      "bun test",
      "bun run",
      "tsc",
      "git status",
      "git diff",
      "git log",
      "ls",
      "find",
      "grep",
      "cat",
      "wc",
    ].forEach((c) => cmds.add(c));
    cmds.add("bun");
  } else if (ctx.ecosystem === "cargo") {
    ["cargo test", "cargo check", "cargo clippy", "git status", "git diff", "ls", "grep"].forEach(
      (c) => cmds.add(c),
    );
    cmds.add("cargo build");
    cmds.add("cargo");
    cmds.add("git log");
  } else if (ctx.ecosystem === "python") {
    [
      "pytest",
      "python -m pytest",
      "mypy",
      "ruff check",
      "git status",
      "git diff",
      "ls",
      "grep",
    ].forEach((c) => cmds.add(c));
    cmds.add("python");
    cmds.add("python3");
    cmds.add("ruff");
    cmds.add("git log");
    if (ctx.py.usesFlake8) cmds.add("flake8");
    if (ctx.py.usesPoetry) {
      cmds.add("poetry");
      cmds.add("poetry run pytest");
    }
    if (ctx.py.usesPipenv) {
      cmds.add("pipenv");
      cmds.add("pipenv run pytest");
    }
  } else if (ctx.ecosystem === "node") {
    const p = ctx.packageManager ?? "npm";
    [`${p} test`, "npm test", "git status", "git diff", "ls", "grep"].forEach((c) => cmds.add(c));
    cmds.add(`${p} run`);
    cmds.add(p);
    cmds.add("npx");
    cmds.add("git log");
  } else {
    ["git status", "git diff", "git log", "ls", "find", "grep", "cat", "wc"].forEach((c) =>
      cmds.add(c),
    );
  }

  if (ctx.isMonorepo || ctx.turboExists) {
    cmds.add("turbo");
    cmds.add("turbo run");
  }
  if (ctx.hasOxlint) {
    cmds.add("oxlint");
    cmds.add("npx oxlint");
  }
  if (ctx.hasBiome) {
    cmds.add("biome");
    cmds.add("biome check");
    cmds.add("npx biome");
  }
  if (ctx.hasEslint) {
    cmds.add("eslint");
    cmds.add("npx eslint");
  }
  if (ctx.hasVitest) {
    cmds.add("vitest");
    cmds.add("npx vitest");
  }
  if (ctx.hasJest) {
    cmds.add("jest");
    cmds.add("npx jest");
  }
  if (ctx.isTs) {
    cmds.add("tsc");
    cmds.add("npx tsc");
  }
  if (ctx.make.exists) {
    cmds.add("make");
    if (ctx.make.hasTarget("test")) cmds.add("make test");
    if (ctx.make.hasTarget("lint")) cmds.add("make lint");
  }

  return Array.from(cmds);
}
