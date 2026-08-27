export class ModularityScopeError extends Error {
  public constructor(path: string) {
    super(`Expected a repository-relative POSIX path, received: ${path}`);
    this.name = "ModularityScopeError";
  }
}

export function assertRepositoryRelativePosixPath(path: string): void {
  const segments = path.split("/");
  const isInvalid =
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..");

  if (isInvalid) {
    throw new ModularityScopeError(path);
  }
}
