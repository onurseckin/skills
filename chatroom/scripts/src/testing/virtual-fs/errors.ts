export class VirtualFSError extends Error {
  readonly code: string;
  readonly path?: string | undefined;
  readonly syscall?: string | undefined;

  constructor(
    code: string,
    message: string,
    syscall?: string | undefined,
    path?: string | undefined,
  ) {
    super(message);
    this.name = "VirtualFSError";
    this.code = code;
    this.syscall = syscall;
    this.path = path;
  }

  static enoent(targetPath: string, syscall = "open"): VirtualFSError {
    return new VirtualFSError(
      "ENOENT",
      `ENOENT: no such file or directory, ${syscall} '${targetPath}'`,
      syscall,
      targetPath,
    );
  }

  static eexist(targetPath: string, syscall = "mkdir"): VirtualFSError {
    return new VirtualFSError(
      "EEXIST",
      `EEXIST: file already exists, ${syscall} '${targetPath}'`,
      syscall,
      targetPath,
    );
  }

  static enotdir(targetPath: string, syscall = "open"): VirtualFSError {
    return new VirtualFSError(
      "ENOTDIR",
      `ENOTDIR: not a directory, ${syscall} '${targetPath}'`,
      syscall,
      targetPath,
    );
  }

  static eisdir(targetPath: string, syscall = "read"): VirtualFSError {
    return new VirtualFSError(
      "EISDIR",
      `EISDIR: illegal operation on a directory, ${syscall} '${targetPath}'`,
      syscall,
      targetPath,
    );
  }

  static eperm(targetPath: string, syscall = "unlink"): VirtualFSError {
    return new VirtualFSError(
      "EPERM",
      `EPERM: operation not permitted, ${syscall} '${targetPath}'`,
      syscall,
      targetPath,
    );
  }
}
