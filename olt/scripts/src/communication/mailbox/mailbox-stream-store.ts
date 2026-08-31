import type { MailboxEnvelope } from "../types.ts";
import { isVirtualMailboxPath, registerInMemoryMailboxDir } from "./mailbox-paths.ts";

const inMemoryMailboxes = new Map<string, string[]>();
const inMemoryQuarantines = new Map<string, string[]>();
let inMemoryStreamModeEnabled = false;

export const setInMemoryStreamMode = (e: boolean): void => {
  inMemoryStreamModeEnabled = e;
};

export const isInMemoryStreamMode = (): boolean => inMemoryStreamModeEnabled;

export const getInMemoryMailbox = (p: string): readonly string[] | undefined =>
  inMemoryMailboxes.get(p);

export const setInMemoryMailbox = (p: string, lines: readonly string[]): void => {
  inMemoryMailboxes.set(p, [...lines]);
};

export const getInMemoryQuarantine = (p: string): readonly string[] | undefined =>
  inMemoryQuarantines.get(p);

export const clearInMemoryMailboxStore = (): void => {
  inMemoryMailboxes.clear();
  inMemoryQuarantines.clear();
};

export const shouldUseInMemory = (p: string): boolean =>
  inMemoryStreamModeEnabled || isVirtualMailboxPath(p) || inMemoryMailboxes.has(p);

export function appendInMemoryMessage(inboxPath: string, envelope: MailboxEnvelope<unknown>): void {
  const lastSlash = Math.max(inboxPath.lastIndexOf("/"), inboxPath.lastIndexOf("\\"));
  const dir = lastSlash > 0 ? inboxPath.slice(0, lastSlash) : inboxPath;
  registerInMemoryMailboxDir(dir);
  const existing = inMemoryMailboxes.get(inboxPath) ?? [];
  inMemoryMailboxes.set(inboxPath, [...existing, JSON.stringify(envelope)]);
}

export function writeInMemoryQuarantine(quarantinePath: string, formatted: string): void {
  const existing = inMemoryQuarantines.get(quarantinePath) ?? [];
  inMemoryQuarantines.set(quarantinePath, [...existing, formatted]);
}

export function rewriteInMemoryInbox(
  inboxPath: string,
  envelopes: readonly MailboxEnvelope<unknown>[],
): void {
  inMemoryMailboxes.set(
    inboxPath,
    envelopes.map((env) => JSON.stringify(env)),
  );
}

export function rotateInMemoryMailbox(
  inboxPath: string,
  archivePath: string,
  toArchive: readonly MailboxEnvelope<unknown>[],
  toRetain: readonly MailboxEnvelope<unknown>[],
): void {
  const existing = inMemoryMailboxes.get(archivePath) ?? [];
  inMemoryMailboxes.set(archivePath, [
    ...existing,
    ...toArchive.map((e) => JSON.stringify(e)),
  ]);
  inMemoryMailboxes.set(
    inboxPath,
    toRetain.map((e) => JSON.stringify(e)),
  );
}
