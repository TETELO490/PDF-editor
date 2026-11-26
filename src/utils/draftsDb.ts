import type { PdfAnnotation } from '../types/pdf';
import type { DocumentKind } from './recentFilesDb';

export interface DraftProject {
  id: string;
  name: string;
  kind: DocumentKind;
  pdfBytes: Uint8Array;
  annotations: PdfAnnotation[];
  updatedAt: number;
}

const DB_NAME = 'bluefill_drafts_db';
const STORE_NAME = 'drafts';
const MAX_DRAFTS = 12;

function openDraftsDb(): Promise<IDBDatabase> {
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

export async function loadDrafts(): Promise<DraftProject[]> {
  try {
    const db = await openDraftsDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = (req.result as DraftProject[]) || [];
        const normalized = rows.map((row) => ({
          ...row,
          pdfBytes:
            row.pdfBytes instanceof Uint8Array
              ? row.pdfBytes
              : new Uint8Array(row.pdfBytes),
          annotations: Array.isArray(row.annotations) ? row.annotations : [],
        }));
        normalized.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(normalized);
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function saveDraft(draft: DraftProject): Promise<DraftProject[]> {
  try {
    const db = await openDraftsDb();
    const existing = await loadDrafts();
    const filtered = existing.filter((item) => item.id !== draft.id);
    const nextList = [
      {
        ...draft,
        pdfBytes: new Uint8Array(draft.pdfBytes),
        updatedAt: Date.now(),
      },
      ...filtered,
    ].slice(0, MAX_DRAFTS);

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

export async function deleteDraft(draftId: string): Promise<DraftProject[]> {
  try {
    const db = await openDraftsDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(draftId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    return await loadDrafts();
  } catch {
    return [];
  }
}
