import * as fs from "node:fs";
import { noent, orig, type VirtualFsState } from "./virtual-fs-state.ts";

export function handleRw(
  s: VirtualFsState,
  fd: number,
  buf: unknown,
  off: unknown,
  len: unknown,
  pos: unknown,
  isW: boolean,
): number {
  const e = s.openDescriptors.get(fd);
  if (!e)
    return isW
      ? orig.writeSync(fd, buf as string, off as number, len as number, pos as number)
      : orig.readSync(
          fd,
          buf as NodeJS.ArrayBufferView,
          off as number,
          len as number,
          pos as number,
        );
  const d = s.vfs.existsSync(e.path) ? Buffer.from(s.vfs.readFileSync(e.path)) : Buffer.alloc(0);
  if (!isW) {
    const p = pos !== null && pos !== undefined ? Number(pos) : e.position;
    const rLen = Math.min(len as number, Math.max(0, d.length - p));
    const target = Buffer.isBuffer(buf)
      ? buf
      : Buffer.from((buf as { buffer: ArrayBuffer }).buffer);
    d.subarray(p, p + rLen).copy(target, off as number, 0, rLen);
    e.position = p + rLen;
    return rLen;
  }
  const b =
    typeof buf === "string"
      ? Buffer.from(buf)
      : Buffer.isBuffer(buf)
        ? buf
        : Buffer.from((buf as { buffer: ArrayBuffer }).buffer);
  const o = typeof off === "number" ? off : 0;
  const l = typeof len === "number" ? len : b.length;
  const slice = b.subarray(o, o + l);
  const position =
    typeof pos === "number" ? pos : (e.flags & fs.constants.O_APPEND) !== 0 ? d.length : e.position;
  const merged = Buffer.alloc(Math.max(d.length, position + slice.length));
  d.copy(merged, 0, 0, d.length);
  slice.copy(merged, position, 0, slice.length);
  s.vfs.writeFileSync(e.path, merged);
  e.position = position + slice.length;
  return slice.length;
}

export function handleRename(s: VirtualFsState, src: fs.PathLike, dst: fs.PathLike): void {
  const sStr = s.norm(String(src));
  const dStr = s.norm(String(dst));
  if (!s.isVirtualPath(sStr) && !s.isVirtualPath(dStr)) return orig.rename(sStr, dStr);
  const st = s.vfs.statSync(sStr);
  if (!st) noent("rename", `${sStr}' -> '${dStr}`);
  if (st.isDirectory()) {
    s.vfs.mkdirSync(dStr, { recursive: true });
    for (const entry of s.vfs.readdirSync(sStr, { recursive: true }) as string[]) {
      const cStat = s.vfs.statSync(`${sStr}/${entry}`);
      if (cStat?.isDirectory()) s.vfs.mkdirSync(`${dStr}/${entry}`, { recursive: true });
      else if (cStat?.isFile())
        s.vfs.writeFileSync(`${dStr}/${entry}`, s.vfs.readFileSync(`${sStr}/${entry}`));
    }
    s.vfs.rmSync(sStr, { recursive: true, force: true });
  } else {
    s.vfs.writeFileSync(dStr, s.vfs.readFileSync(sStr));
    s.vfs.unlinkSync(sStr);
    const cm = s.customModes.get(sStr);
    if (cm !== undefined) {
      s.customModes.delete(sStr);
      s.customModes.set(dStr, cm);
    }
    const cmt = s.customMtimes.get(sStr);
    if (cmt !== undefined) {
      s.customMtimes.delete(sStr);
      s.customMtimes.set(dStr, cmt);
    }
  }
}
