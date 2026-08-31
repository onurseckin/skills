export class ModularityScopeError extends Error {
  public constructor(path: string) {
    super(`Expected a repository-relative POSIX path, received: ${path}`);
    this.name = "ModularityScopeError";
  }
}

export function assertRepositoryRelativePosixPath(path: string): void {
  if (path.length === 0) {
    throw new ModularityScopeError(path);
  }
  if (path.startsWith("/")) {
    throw new ModularityScopeError(path);
  }
  if (path.includes("\\")) {
    throw new ModularityScopeError(path);
  }
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new ModularityScopeError(path);
    }
    if (segment === ".") {
      throw new ModularityScopeError(path);
    }
    if (segment === "..") {
      throw new ModularityScopeError(path);
    }
  }
}
