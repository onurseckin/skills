import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ParsedPackageJson {
  readonly exists: boolean;
  readonly scripts: Readonly<Record<string, string>>;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly packageManager?: string | undefined;
  hasDep(name: string): boolean;
  hasScript(name: string): boolean;
}

export interface ParsedTurboJson {
  readonly exists: boolean;
  readonly pipeline: Readonly<Record<string, unknown>>;
  hasTask(name: string): boolean;
}

export interface ParsedPythonManifest {
  readonly hasPyproject: boolean;
  readonly hasRequirements: boolean;
  readonly hasPipfile: boolean;
  readonly hasPoetryLock: boolean;
  readonly hasSetupPy: boolean;
  readonly usesRuff: boolean;
  readonly usesMypy: boolean;
  readonly usesPytest: boolean;
  readonly usesFlake8: boolean;
  readonly usesPoetry: boolean;
  readonly usesPipenv: boolean;
}

export interface ParsedMakefile {
  readonly exists: boolean;
  hasTarget(name: string): boolean;
}

function safeReadText(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }
}

function safeReadJson(path: string): Record<string, unknown> | undefined {
  const text = safeReadText(path);
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function readPackageJson(root: string): ParsedPackageJson {
  const data = safeReadJson(join(root, "package.json"));
  if (!data) {
    return {
      exists: false,
      scripts: {},
      dependencies: {},
      devDependencies: {},
      hasDep: () => false,
      hasScript: () => false,
    };
  }

  const scripts = (
    data["scripts"] && typeof data["scripts"] === "object" && !Array.isArray(data["scripts"])
      ? (data["scripts"] as Record<string, string>)
      : {}
  ) as Record<string, string>;

  const dependencies = (
    data["dependencies"] &&
    typeof data["dependencies"] === "object" &&
    !Array.isArray(data["dependencies"])
      ? (data["dependencies"] as Record<string, string>)
      : {}
  ) as Record<string, string>;

  const devDependencies = (
    data["devDependencies"] &&
    typeof data["devDependencies"] === "object" &&
    !Array.isArray(data["devDependencies"])
      ? (data["devDependencies"] as Record<string, string>)
      : {}
  ) as Record<string, string>;

  const packageManager =
    typeof data["packageManager"] === "string" ? data["packageManager"] : undefined;

  const allDeps = new Set([...Object.keys(dependencies), ...Object.keys(devDependencies)]);

  return {
    exists: true,
    scripts,
    dependencies,
    devDependencies,
    packageManager,
    hasDep: (name: string) => allDeps.has(name),
    hasScript: (name: string) => Object.prototype.hasOwnProperty.call(scripts, name),
  };
}

export function readTurboJson(root: string): ParsedTurboJson {
  const data = safeReadJson(join(root, "turbo.json"));
  if (!data) {
    return {
      exists: false,
      pipeline: {},
      hasTask: () => false,
    };
  }

  const pipeline = (
    data["pipeline"] && typeof data["pipeline"] === "object" && !Array.isArray(data["pipeline"])
      ? data["pipeline"]
      : data["tasks"] && typeof data["tasks"] === "object" && !Array.isArray(data["tasks"])
        ? data["tasks"]
        : {}
  ) as Record<string, unknown>;

  return {
    exists: true,
    pipeline,
    hasTask: (name: string) => Object.prototype.hasOwnProperty.call(pipeline, name),
  };
}

export function readPythonManifests(root: string): ParsedPythonManifest {
  const pyprojectText = safeReadText(join(root, "pyproject.toml")) ?? "";
  const reqText = safeReadText(join(root, "requirements.txt")) ?? "";
  const pipfileText = safeReadText(join(root, "Pipfile")) ?? "";
  const hasPoetryLock = existsSync(join(root, "poetry.lock"));
  const hasSetupPy = existsSync(join(root, "setup.py"));

  const hasPyproject = existsSync(join(root, "pyproject.toml"));
  const hasRequirements = existsSync(join(root, "requirements.txt"));
  const hasPipfile = existsSync(join(root, "Pipfile"));

  const combined = `${pyprojectText}\n${reqText}\n${pipfileText}`.toLowerCase();

  const usesRuff = combined.includes("ruff");
  const usesMypy = combined.includes("mypy");
  const usesPytest = combined.includes("pytest");
  const usesFlake8 = combined.includes("flake8");
  const usesPoetry = hasPoetryLock || combined.includes("poetry");
  const usesPipenv = hasPipfile || combined.includes("pipenv");

  return {
    hasPyproject,
    hasRequirements,
    hasPipfile,
    hasPoetryLock,
    hasSetupPy,
    usesRuff,
    usesMypy,
    usesPytest,
    usesFlake8,
    usesPoetry,
    usesPipenv,
  };
}

export function readMakefile(root: string): ParsedMakefile {
  const text = safeReadText(join(root, "Makefile")) ?? safeReadText(join(root, "makefile"));
  if (!text) {
    return {
      exists: false,
      hasTarget: () => false,
    };
  }

  const targetRegex = /^([a-zA-Z0-9_-]+):/gm;
  const targets = new Set<string>();
  let match: RegExpExecArray | null = null;
  while ((match = targetRegex.exec(text)) !== null) {
    if (match[1]) {
      targets.add(match[1].toLowerCase());
    }
  }

  return {
    exists: true,
    hasTarget: (name: string) => targets.has(name.toLowerCase()),
  };
}
