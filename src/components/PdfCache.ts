/**
 * PdfCache.ts
 *
 * IndexedDB-backed cache with two object stores:
 *   "pdfs"   — stores raw PDF ArrayBuffers keyed by URL
 *   "pdflib" — stores the PDF.js script texts keyed by a version string
 *
 * This enables:
 *   1. Offline re-opening of previously viewed PDFs (no network needed)
 *   2. Offline loading of the PDF.js library itself after first CDN fetch
 */

const DB_NAME = "ViewerPdfCache";
const DB_VERSION = 1;
const STORE_PDFS = "pdfs";
const STORE_LIB = "pdflib";

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (e: IDBVersionChangeEvent) => {
            const db = (e.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_PDFS)) {
                db.createObjectStore(STORE_PDFS);
            }
            if (!db.objectStoreNames.contains(STORE_LIB)) {
                db.createObjectStore(STORE_LIB);
            }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// ── PDF document cache ─────────────────────────────────────────────────────

export interface CachedPdfEntry {
    data: ArrayBuffer;
    cachedAt: number;
    fileName: string;
}

export async function cachePdf(url: string, data: ArrayBuffer, fileName = "document"): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_PDFS, "readwrite");
        const entry: CachedPdfEntry = { data, cachedAt: Date.now(), fileName };
        tx.objectStore(STORE_PDFS).put(entry, url);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function getCachedPdf(url: string): Promise<CachedPdfEntry | null> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_PDFS, "readonly");
        const req = tx.objectStore(STORE_PDFS).get(url);
        req.onsuccess = () => resolve((req.result as CachedPdfEntry) ?? null);
        req.onerror = () => reject(req.error);
    });
}

export async function hasCachedPdf(url: string): Promise<boolean> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_PDFS, "readonly");
        const req = tx.objectStore(STORE_PDFS).count(url);
        req.onsuccess = () => resolve(req.result > 0);
        req.onerror = () => reject(req.error);
    });
}

// ── PDF.js library cache ───────────────────────────────────────────────────

export async function cacheLib(key: string, text: string): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_LIB, "readwrite");
        tx.objectStore(STORE_LIB).put(text, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function getCachedLib(key: string): Promise<string | null> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_LIB, "readonly");
        const req = tx.objectStore(STORE_LIB).get(key);
        req.onsuccess = () => resolve((req.result as string) ?? null);
        req.onerror = () => reject(req.error);
    });
}
