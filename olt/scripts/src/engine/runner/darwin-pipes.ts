import * as ffi from "bun:ffi";
import { HarnessError } from "../../core/errors/index.ts";
import { parseDarwinProcessIdentity } from "./darwin-process-identity.ts";
import type { ProcessIdentity } from "./process-identity.ts";
import { scanDarwinTokenOwners } from "./darwin-token-owners.ts";

const PROC_UID_ONLY = 4;
const PROC_PIDLISTFDS = 1;
const PROC_PIDFDSOCKETINFO = 3;
const PROC_PIDFDPIPEINFO = 6;
const PROC_PIDTBSDINFO = 3;
const SOCKET_FD_TYPE = 2;
const PIPE_FD_TYPE = 6;
const FD_ENTRY_BYTES = 8;
const PIPE_INFO_BYTES = 184;
const PIPE_HANDLE_OFFSET = 160;
const SOCKET_INFO_BYTES = 1_024;
const SOCKET_HANDLE_OFFSET = 160;
const SOCKET_KIND_OFFSET = 256;
const SOCKET_PEER_OFFSET = 264;
const SOCKINFO_UN = 3;
const BSD_INFO_BYTES = 136;
const MAX_TOKEN_SCAN_PROCESSES = 65_536;

type Pointer = number | bigint;
type Native = (...arguments_: Array<number | bigint>) => number | bigint;

interface Libproc {
  procListPids: Native;
  procPidInfo: Native;
  procPidFdInfo: Native;
  pointer: (buffer: Uint8Array) => Pointer;
  handle: unknown;
}

let loaded: Libproc | undefined;

function libproc(): Libproc {
  if (loaded) return loaded;
  const runtime = ffi as unknown as {
    FFIType: Record<string, string>;
    ptr: (buffer: Uint8Array) => Pointer;
  };
  const types = runtime.FFIType;
  const handle = ffi.dlopen("/usr/lib/libproc.dylib", {
    proc_listpids: {
      args: [types.u32, types.u32, types.ptr, types.i32],
      returns: types.i32,
    },
    proc_pidinfo: {
      args: [types.i32, types.i32, types.u64, types.ptr, types.i32],
      returns: types.i32,
    },
    proc_pidfdinfo: {
      args: [types.i32, types.i32, types.i32, types.ptr, types.i32],
      returns: types.i32,
    },
  });
  const symbols = handle.symbols as unknown as Record<string, Native>;
  loaded = {
    procListPids: symbols.proc_listpids!,
    procPidInfo: symbols.proc_pidinfo!,
    procPidFdInfo: symbols.proc_pidfdinfo!,
    pointer: runtime.ptr,
    handle,
  };
  return loaded;
}

function allUserPids(native: Libproc): number[] {
  const required = Number(native.procListPids(PROC_UID_ONLY, process.getuid!(), 0, 0));
  if (required <= 0) throw new HarnessError("INVALID_STATE", "cannot enumerate user processes");
  if (required > MAX_TOKEN_SCAN_PROCESSES * 4)
    throw new HarnessError("INVALID_STATE", "ownership-token process scan is too large");
  const buffer = Buffer.alloc(required + 4_096);
  const used = Number(
    native.procListPids(PROC_UID_ONLY, process.getuid!(), native.pointer(buffer), buffer.length),
  );
  if (used < 0 || used >= buffer.length)
    throw new HarnessError("INVALID_STATE", "user process list was truncated");
  const pids: number[] = [];
  for (let offset = 0; offset + 4 <= used; offset += 4) {
    const pid = buffer.readInt32LE(offset);
    if (pid > 0) pids.push(pid);
  }
  if (pids.length > MAX_TOKEN_SCAN_PROCESSES)
    throw new HarnessError("INVALID_STATE", "ownership-token process scan is too large");
  return pids;
}

function pipeHandles(native: Libproc, pid: number): Set<bigint> {
  const required = Number(native.procPidInfo(pid, PROC_PIDLISTFDS, 0, 0, 0));
  if (required <= 0) return new Set();
  const descriptors = Buffer.alloc(required + FD_ENTRY_BYTES * 16);
  const used = Number(
    native.procPidInfo(pid, PROC_PIDLISTFDS, 0, native.pointer(descriptors), descriptors.length),
  );
  if (used <= 0) return new Set();
  const handles = new Set<bigint>();
  for (let offset = 0; offset + FD_ENTRY_BYTES <= used; offset += FD_ENTRY_BYTES) {
    const type = descriptors.readUInt32LE(offset + 4);
    if (type !== PIPE_FD_TYPE && type !== SOCKET_FD_TYPE) continue;
    const info = Buffer.alloc(type === PIPE_FD_TYPE ? PIPE_INFO_BYTES : SOCKET_INFO_BYTES);
    const found = Number(
      native.procPidFdInfo(
        pid,
        descriptors.readInt32LE(offset),
        type === PIPE_FD_TYPE ? PROC_PIDFDPIPEINFO : PROC_PIDFDSOCKETINFO,
        native.pointer(info),
        info.length,
      ),
    );
    if (type === PIPE_FD_TYPE && found >= PIPE_HANDLE_OFFSET + 16) {
      handles.add(info.readBigUInt64LE(PIPE_HANDLE_OFFSET));
      handles.add(info.readBigUInt64LE(PIPE_HANDLE_OFFSET + 8));
    } else if (
      type === SOCKET_FD_TYPE &&
      found >= SOCKET_PEER_OFFSET + 8 &&
      info.readInt32LE(SOCKET_KIND_OFFSET) === SOCKINFO_UN
    ) {
      handles.add(info.readBigUInt64LE(SOCKET_HANDLE_OFFSET));
      handles.add(info.readBigUInt64LE(SOCKET_PEER_OFFSET));
    }
  }
  return handles;
}

export function darwinPipeHandles(pid: number): Set<bigint> {
  return pipeHandles(libproc(), pid);
}

export function darwinProcessIdentity(
  pid: number,
): { pid: number; parent: number; group: number; birth: string } | undefined {
  const native = libproc();
  const info = Buffer.alloc(BSD_INFO_BYTES);
  const found = Number(
    native.procPidInfo(pid, PROC_PIDTBSDINFO, 0, native.pointer(info), info.length),
  );
  if (found < BSD_INFO_BYTES) return undefined;
  return parseDarwinProcessIdentity(info, pid);
}

export function darwinPipeOwners(anchors: ReadonlySet<bigint>): Set<number> {
  const native = libproc();
  const owners = new Set<number>();
  for (const pid of allUserPids(native)) {
    if (pid === process.pid) continue;
    if ([...pipeHandles(native, pid)].some((handle) => anchors.has(handle))) owners.add(pid);
  }
  return owners;
}

export function darwinTokenOwnerIdentities(token: string): ProcessIdentity[] {
  return scanDarwinTokenOwners(allUserPids(libproc()), token, darwinProcessIdentity);
}
