export interface SyncDirectoryReader<Entry> {
  readSync(): Entry | null;
  closeSync(): void;
}

export function collectBoundedDirectoryEntries<Entry>(
  directory: SyncDirectoryReader<Entry>,
  remaining: number,
  limitError: () => Error,
  compare: (left: Entry, right: Entry) => number,
): Entry[] {
  const entries: Entry[] = [];
  try {
    while (true) {
      const entry = directory.readSync();
      if (entry === null) break;
      entries.push(entry);
      if (entries.length > remaining) throw limitError();
    }
  } finally {
    directory.closeSync();
  }
  return entries.sort(compare);
}
