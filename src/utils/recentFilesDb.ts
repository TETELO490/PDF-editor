export type DocumentKind = 'pdf' | 'word';

export interface RecentFileEntry {
  id: string;
  name: string;
  kind: DocumentKind;
  bytes: Uint8Array;
  openedAt: number;
}

const DB_NAME = 'bluefill_recent_files';
const STORE_NAME = 'files';
const MAX_RECENT = 8;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function detectDocumentKind(fileName: string): DocumentKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
    return 'word';
  }
  return 'pdf';
}

export async function loadRecentFiles(): Promise<RecentFileEntry[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (req.result as RecentFileEntry[]) || [];
        items.sort((a, b) => b.openedAt - a.openedAt);
        resolve(items);
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function saveRecentFile(entry: Omit<RecentFileEntry, 'id' | 'openedAt'>): Promise<RecentFileEntry[]> {
  try {
    const db = await openDb();
    const existing = await loadRecentFiles();
    const filtered = existing.filter(
      (item) => !(item.name === entry.name && item.kind === entry.kind)
    );
    const newEntry: RecentFileEntry = {
      ...entry,
      id: `${entry.kind}:${entry.name}`,
      openedAt: Date.now(),
    };
    const nextList = [newEntry, ...filtered].slice(0, MAX_RECENT);

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      nextList.forEach((item) => store.put(item));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });

    return nextList;
  } catch {
    return [];
  }
}
