import type { CommandPathBinding } from "../../core/contracts/index.ts";

function pathsOverlap(left: string, right: string): boolean {
  const a = left.replace(/\/(?:\*\*)?\*?$/u, "").split("/");
  const b = right.replace(/\/(?:\*\*)?\*?$/u, "").split("/");
  return a.slice(0, Math.min(a.length, b.length)).every((part, index) => part === b[index]);
}

export function gateControlBindingsOverlapWriteScopes(
  bindings: readonly CommandPathBinding[],
  writeScopes: readonly (readonly string[])[],
): boolean {
  const protectedPaths = bindings
    .filter(({ role, scope }) => scope === "repository" && role !== "target")
    .map(({ relative_path }) => relative_path!);
  return protectedPaths.some((path) =>
    writeScopes.some((scopes) => scopes.some((scope) => pathsOverlap(path, scope))),
  );
}

export function gateControlBindingScopeIssues(
  bindings: readonly CommandPathBinding[],
  writeScopes: readonly (readonly string[])[],
): string[] {
  return gateControlBindingsOverlapWriteScopes(bindings, writeScopes)
    ? ["gate control input overlaps a current task mutable write scope"]
    : [];
}
