/**
 * PdfViewer.tsx
 *
 * Feature-rich PDF viewer for Mendix pluggable widgets.
 *
 * Performance architecture
 * ────────────────────────
 *  Lazy rendering
 *    An IntersectionObserver watches each page wrapper.  Only pages that
 *    are currently visible (plus a ±1 buffer) receive isVisible=true.
 *    Off-screen pages render a cheap skeleton placeholder; no canvas work
 *    is done.  React.memo on PdfPage ensures only changed pages re-render.
 *
 *  Zoom debounce
 *    `scale`       — updates immediately for the toolbar label / disabled
 *                    state (no visual lag on the UI control)
 *    `renderScale` — debounced 200 ms behind `scale`.  PdfPage uses this
 *                    for actual canvas operations, so rapid wheel/click
 *                    zoom never queues dozens of simultaneous renders.
 *
 *  State isolation
 *    visiblePageNums is updated via a ref inside the observer callback and
 *    committed to state with a 60 ms batch timer, preventing per-pixel
 *    state churn while scrolling.
 *
 * Other features
 * ──────────────
 *  • URL loading with IndexedDB offline cache
 *  • Local file upload + drag-and-drop
 *  • Full-text search with highlights
 *  • Copy all text to clipboard
 *  • Download / Print
 *  • Dark mode
 *  • Offline and "Cached" toolbar badges
 */

import {
    ReactElement,
    useState,
    useCallback,
    useRef,
    useEffect,
    ChangeEvent,
    DragEvent,
    KeyboardEvent
} from "react";
import { loadPdfJs } from "./PdfLoader";
import { cachePdf, getCachedPdf } from "./PdfCache";
import { PdfPage } from "./PdfPage";
import { PdfThumbnail } from "./PdfThumbnail";
import { mxLog } from "./MxLogger";

// ── Props ──────────────────────────────────────────────────────────────────

export interface PdfViewerProps {
    url?: string;
    fileName: string;
    height: string;
    showThumbnails: boolean;
    darkMode: boolean;
    enableSearch: boolean;
    enableDownload: boolean;
    enablePrint: boolean;
    enableUpload: boolean;
    enableCopyText: boolean;
    enableRotate: boolean;
    enableFitToPage: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────

// ── Widget build identity ──────────────────────────────────────────────────
// Change this value every time you rebuild and redeploy the widget.
// It appears in red on the toolbar so you can instantly confirm which
// version of the .mpk is loaded in any Mendix project.
const WIDGET_VERSION = "v1.0.0";
const WIDGET_BUILD   = "2026-04-28";  // update this on every new build

const ZOOM_STEP = 0.25;
const ZOOM_MIN  = 0.5;
const ZOOM_MAX  = 3.0;

/** Pages rendered outside the visible viewport (buffer above + below). */
const RENDER_BUFFER = 1;

/** How long (ms) to wait after the last scale change before re-rendering. */
const ZOOM_DEBOUNCE_MS = 200;

/** How long (ms) to batch visibility updates from IntersectionObserver. */
const VISIBILITY_DEBOUNCE_MS = 60;

type CopyStatus = "idle" | "copying" | "copied" | "error";

// ── Component ──────────────────────────────────────────────────────────────

export function PdfViewer({
    url,
    fileName,
    height,
    showThumbnails,
    darkMode,
    enableSearch,
    enableDownload,
    enablePrint,
    enableUpload,
    enableCopyText,
    enableRotate,
    enableFitToPage
}: PdfViewerProps): ReactElement {

    // ── Library ────────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [pdfjsLib, setPdfjsLib]   = useState<any>(null);
    const [libError, setLibError]   = useState<string | null>(null);

    // ── Document ───────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [pages, setPages]         = useState<any[]>([]);
    const [docError, setDocError]   = useState<string | null>(null);
    const [loading, setLoading]     = useState(false);
    const [isCachedSource, setIsCachedSource] = useState(false);

    // ── Upload / drag ──────────────────────────────────────────────────────
    const [localFile, setLocalFile] = useState<File | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ── Zoom ───────────────────────────────────────────────────────────────
    /** Immediate: drives toolbar label, disabled states */
    const [scale, setScale]               = useState(1.0);
    /** Debounced: drives actual canvas rendering (prevents render storm) */
    const [renderScale, setRenderScale]   = useState(1.0);
    const zoomDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Lazy rendering: which pages are visible ────────────────────────────
    /**
     * The IntersectionObserver updates this ref on every scroll event
     * (very frequent), but we only commit it to React state every
     * VISIBILITY_DEBOUNCE_MS ms to avoid constant re-renders.
     */
    const visiblePageNums_ref  = useRef<Set<number>>(new Set([1, 2]));
    const [visiblePageNums, setVisiblePageNums] = useState<Set<number>>(
        () => new Set([1, 2])
    );
    const visibilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── View ───────────────────────────────────────────────────────────────
    const [rotation, setRotation]       = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageInput, setPageInput]     = useState("1");
    // Sidebar visibility is fixed at design time via showThumbnails prop (no runtime toggle)
    const sidebarOpen = showThumbnails;
    const [searchOpen, setSearchOpen]   = useState(false);
    const [searchText, setSearchText]   = useState("");

    // ── Toolbar ────────────────────────────────────────────────────────────
    const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
    const [isOffline, setIsOffline]   = useState(!navigator.onLine);

    // ── Refs ───────────────────────────────────────────────────────────────
    const contentRef     = useRef<HTMLDivElement>(null);
    const sidebarRef     = useRef<HTMLDivElement>(null);
    const pageWrapRefs   = useRef<Map<number, HTMLDivElement>>(new Map());
    const observerRef    = useRef<IntersectionObserver | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docTaskRef     = useRef<any>(null);

    // Derived
    const displayFileName = localFile
        ? localFile.name.replace(/\.pdf$/i, "")
        : (fileName || "document");

    // ── Zoom debounce ──────────────────────────────────────────────────────
    // `scale` updates immediately (toolbar feedback), `renderScale` follows
    // after ZOOM_DEBOUNCE_MS of inactivity.
    useEffect(() => {
        if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
        zoomDebounceRef.current = setTimeout(() => {
            setRenderScale(scale);
        }, ZOOM_DEBOUNCE_MS);
        return () => {
            if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
        };
    }, [scale]);

    // ── Online / offline detection ─────────────────────────────────────────
    useEffect(() => {
        const onOnline  = () => setIsOffline(false);
        const onOffline = () => setIsOffline(true);
        window.addEventListener("online",  onOnline);
        window.addEventListener("offline", onOffline);
        return () => {
            window.removeEventListener("online",  onOnline);
            window.removeEventListener("offline", onOffline);
        };
    }, []);

    // ── Load PDF.js once ───────────────────────────────────────────────────
    useEffect(() => {
        mxLog.info("PdfViewer", "Initializing PDF.js library...");
        loadPdfJs()
            .then(lib => {
                mxLog.info("PdfViewer", "PDF.js library ready.");
                setPdfjsLib(lib);
            })
            .catch(err => {
                const msg = String(err?.message ?? err);
                mxLog.error("PdfViewer.loadPdfJs", "Failed to load PDF.js library.", err);
                setLibError(msg);
            });
    }, []);

    // ── Reset visible pages when document changes ──────────────────────────
    useEffect(() => {
        visiblePageNums_ref.current = new Set([1, 2]);
        setVisiblePageNums(new Set([1, 2]));
    }, [pages]);

    // ── Auto fit-to-width when a new document finishes loading ────────────
    // Runs once whenever `pages` goes from empty → populated.
    // A small timeout lets the browser complete layout so clientWidth is correct.
    useEffect(() => {
        if (pages.length === 0 || !contentRef.current) return;
        const timer = setTimeout(() => {
            if (!contentRef.current || pages.length === 0) return;
            const vp = pages[0].getViewport({ scale: 1, rotation: 0 });
            const newScale = Math.max(ZOOM_MIN, (contentRef.current.clientWidth - 32) / vp.width);
            setScale(newScale);
        }, 50);
        return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pages]);

    // ── Helpers ────────────────────────────────────────────────────────────

    const resetDocState = useCallback(() => {
        setPages([]);
        setDocError(null);
        setLoading(false);
        setCurrentPage(1);
        setPageInput("1");
        setScale(1.0);
        setRenderScale(1.0);
        setRotation(0);
        setIsCachedSource(false);
    }, []);

    // ── Document loading ───────────────────────────────────────────────────
    useEffect(() => {
        if (!pdfjsLib) return;

        if (docTaskRef.current) {
            docTaskRef.current.destroy?.();
            docTaskRef.current = null;
        }

        // ── Local file ────────────────────────────────────────────────────
        if (localFile) {
            mxLog.info("PdfViewer.loadDocument", `Loading local file: "${localFile.name}" (${Math.round(localFile.size / 1024)} KB)`);
            resetDocState();
            setLoading(true);

            localFile.arrayBuffer()
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .then((buf: ArrayBuffer) => {
                    mxLog.info("PdfViewer.loadDocument", `Local file read into buffer (${Math.round(buf.byteLength / 1024)} KB). Parsing PDF...`);
                    return loadFromBuffer(buf, false);
                })
                .catch((err: any) => {
                    mxLog.error("PdfViewer.loadDocument", `Failed to read local file: "${localFile.name}"`, err);
                    setDocError(err?.message ?? "Failed to read local file.");
                    setLoading(false);
                });
            return;
        }

        // ── URL ───────────────────────────────────────────────────────────
        // Treat empty/whitespace-only string same as no URL
        if (!url || !url.trim()) {
            mxLog.debug("PdfViewer.loadDocument", "No URL or file source provided — viewer is idle.");
            resetDocState();
            return;
        }

        resetDocState();
        setLoading(true);

        // ── Base64 / data-URL handling ─────────────────────────────────────
        // Supports:
        //   • data:application/pdf;base64,JVBERi0x...  (full data URL)
        //   • JVBERi0x...                               (raw base64 string)
        if (url.startsWith("data:") || isBase64Pdf(url)) {
            mxLog.info("PdfViewer.loadDocument", "Detected base64 / data-URL input. Decoding...");
            try {
                const base64 = url.startsWith("data:")
                    ? url.substring(url.indexOf(",") + 1)
                    : url;
                const buf = base64ToArrayBuffer(base64);
                mxLog.info("PdfViewer.loadDocument", `Base64 decoded to ${Math.round(buf.byteLength / 1024)} KB. Parsing PDF...`);
                loadFromBuffer(buf, false);
            } catch (err) {
                mxLog.error("PdfViewer.loadDocument", "Failed to decode base64 PDF string.", err);
                setDocError("Failed to decode base64 PDF string. Make sure it is a valid PDF.");
                setLoading(false);
            }
            return;
        }

        // ── Normal HTTP / HTTPS URL ────────────────────────────────────────
        mxLog.info("PdfViewer.loadDocument", `Fetching PDF from URL: ${url}`);
        fetch(url)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                mxLog.info("PdfViewer.loadDocument", `Fetch succeeded (${res.status}). Reading buffer...`);
                return res.arrayBuffer();
            })
            .then(async (buf: ArrayBuffer) => {
                mxLog.info("PdfViewer.loadDocument", `PDF fetched (${Math.round(buf.byteLength / 1024)} KB). Caching and parsing...`);
                await cachePdf(url, buf, displayFileName).catch(err => {
                    mxLog.warn("PdfViewer.loadDocument", "Failed to cache PDF in IndexedDB — offline access will not work.", err);
                });
                return loadFromBuffer(buf, false);
            })
            .catch(async (fetchErr) => {
                mxLog.warn("PdfViewer.loadDocument", `Fetch failed for URL: ${url}. Checking IndexedDB cache...`, fetchErr);
                const cached = await getCachedPdf(url).catch(cacheErr => {
                    mxLog.error("PdfViewer.loadDocument", "IndexedDB cache read failed.", cacheErr);
                    return null;
                });
                if (!cached) {
                    const msg = isOffline
                        ? "You are offline and this document has not been cached yet. Open it while online once to enable offline access."
                        : "Failed to load the document. Check the URL and connection.";
                    mxLog.error("PdfViewer.loadDocument", msg, { url, isOffline });
                    setDocError(msg);
                    setLoading(false);
                    return;
                }
                mxLog.info("PdfViewer.loadDocument", "Loaded PDF from IndexedDB offline cache.");
                return loadFromBuffer(cached.data, true);
            });

        return () => {
            docTaskRef.current?.destroy?.();
            docTaskRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pdfjsLib, url, localFile]);

    // ── Base64 helpers ─────────────────────────────────────────────────────

    /** Decode a base64 string to an ArrayBuffer. */
    function base64ToArrayBuffer(base64: string): ArrayBuffer {
        // Strip ALL whitespace (spaces, \r, \n, \t) before decoding.
        // Mendix base64 attributes often contain line breaks every 76 chars
        // (standard base64 encoding). atob() throws on any whitespace.
        const cleaned = base64.replace(/\s/g, "");
        const binary  = atob(cleaned);
        const bytes   = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    /**
     * Heuristic: a raw base64 PDF string starts with "JVBERi0"
     * which is the base64 encoding of the PDF magic bytes "%PDF-".
     * We also accept strings that are purely base64 characters
     * (including line breaks added by standard encoders) and long
     * enough to be a real PDF (> 100 chars after stripping whitespace).
     */
    function isBase64Pdf(str: string): boolean {
        const cleaned = str.replace(/\s/g, "");
        if (cleaned.startsWith("JVBERi0")) return true;          // "%PDF-" in base64
        if (cleaned.length < 100) return false;
        return /^[A-Za-z0-9+/]+=*$/.test(cleaned);              // valid base64 chars only
    }

    async function loadFromBuffer(buf: ArrayBuffer, fromCache: boolean): Promise<void> {
        mxLog.info("PdfViewer.parseDocument", `Parsing PDF buffer (${Math.round(buf.byteLength / 1024)} KB, fromCache=${fromCache})...`);
        try {
            const task = pdfjsLib.getDocument({ data: buf });
            docTaskRef.current = task;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const doc: any = await task.promise;
            const numPages: number = doc.numPages;

            mxLog.info("PdfViewer.parseDocument", `PDF parsed successfully — ${numPages} page(s). Loading page proxies...`);

            const loadedPages = await Promise.all(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                Array.from({ length: numPages }, (_: any, i: number) => doc.getPage(i + 1))
            );

            mxLog.info("PdfViewer.parseDocument", `All ${numPages} page proxies ready. Rendering...`);
            setPages(loadedPages);
            setIsCachedSource(fromCache);
            setLoading(false);
        } catch (err: any) {
            if (err?.name === "MissingPDFException") {
                mxLog.error("PdfViewer.parseDocument", "PDF not found at the given URL.", err);
                setDocError("File not found. Please check the PDF URL.");
            } else if (err?.name === "InvalidPDFException") {
                mxLog.error("PdfViewer.parseDocument", "PDF data is invalid or corrupted.", err);
                setDocError("Invalid or corrupted PDF file.");
            } else if (err?.name === "PasswordException") {
                mxLog.warn("PdfViewer.parseDocument", "PDF is password-protected.", err);
                setDocError("This PDF is password-protected and cannot be opened.");
            } else if (err?.name === "AbortException") {
                mxLog.debug("PdfViewer.parseDocument", "PDF parsing was aborted (document changed or unmounted).");
            } else {
                mxLog.error("PdfViewer.parseDocument", "Unexpected error while parsing PDF.", err);
                setDocError(err?.message ?? "Failed to load document.");
            }
            setLoading(false);
        }
    }

    // ── IntersectionObserver: current page + visible-page set ─────────────
    useEffect(() => {
        if (!contentRef.current || pages.length === 0) return;

        observerRef.current?.disconnect();

        const numPages = pages.length;

        observerRef.current = new IntersectionObserver(
            entries => {
                let topPage = currentPage;
                let topRatio = 0;

                entries.forEach(entry => {
                    const n = parseInt(
                        (entry.target as HTMLElement).dataset.pageNumber ?? "0",
                        10
                    );
                    if (n < 1) return;

                    if (entry.isIntersecting) {
                        // Add this page plus its buffer neighbours
                        visiblePageNums_ref.current.add(n);
                        for (let b = 1; b <= RENDER_BUFFER; b++) {
                            if (n - b >= 1)         visiblePageNums_ref.current.add(n - b);
                            if (n + b <= numPages)  visiblePageNums_ref.current.add(n + b);
                        }

                        if (entry.intersectionRatio > topRatio) {
                            topRatio = entry.intersectionRatio;
                            topPage  = n;
                        }
                    } else {
                        // Only remove the exact page (keep buffer pages)
                        visiblePageNums_ref.current.delete(n);
                    }
                });

                // Update current-page indicator immediately (cheap string update)
                if (topRatio > 0) {
                    setCurrentPage(topPage);
                    setPageInput(String(topPage));
                }

                // Batch visible-set commit to avoid per-pixel state churn
                if (visibilityTimerRef.current) clearTimeout(visibilityTimerRef.current);
                visibilityTimerRef.current = setTimeout(() => {
                    setVisiblePageNums(new Set(visiblePageNums_ref.current));
                }, VISIBILITY_DEBOUNCE_MS);
            },
            { root: contentRef.current, threshold: [0, 0.1, 0.4, 1.0], rootMargin: "200px 0px" }
        );

        pageWrapRefs.current.forEach(el => observerRef.current!.observe(el));
        return () => {
            observerRef.current?.disconnect();
            if (visibilityTimerRef.current) clearTimeout(visibilityTimerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pages]);

    // ── Scroll helpers ─────────────────────────────────────────────────────
    const scrollToPage = useCallback((n: number) => {
        const el = pageWrapRefs.current.get(n);
        if (el && contentRef.current) {
            contentRef.current.scrollTo({ top: el.offsetTop - 8, behavior: "smooth" });
        }
        if (sidebarRef.current) {
            const thumb = sidebarRef.current.querySelector(`[data-thumb="${n}"]`) as HTMLElement | null;
            thumb?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    }, []);

    const goToPage = useCallback(
        (n: number) => {
            const clamped = Math.max(1, Math.min(n, pages.length));
            setCurrentPage(clamped);
            setPageInput(String(clamped));
            scrollToPage(clamped);
        },
        [pages.length, scrollToPage]
    );

    const handlePageInputBlur = () => {
        const p = parseInt(pageInput, 10);
        if (!isNaN(p)) goToPage(p);
        else setPageInput(String(currentPage));
    };

    const handlePageInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter")  handlePageInputBlur();
        if (e.key === "Escape") setPageInput(String(currentPage));
    };

    // ── Zoom helpers ───────────────────────────────────────────────────────
    const fitToWidth = useCallback(() => {
        if (!contentRef.current || pages.length === 0) return;
        const vp = pages[0].getViewport({ scale: 1, rotation: 0 });
        setScale(Math.max(ZOOM_MIN, (contentRef.current.clientWidth - 32) / vp.width));
    }, [pages]);

    const fitToPage = useCallback(() => {
        if (!contentRef.current || pages.length === 0) return;
        const vp = pages[0].getViewport({ scale: 1, rotation: 0 });
        const w = contentRef.current.clientWidth  - 32;
        const h = contentRef.current.clientHeight - 32;
        setScale(Math.min(w / vp.width, h / vp.height));
    }, [pages]);

    // ── Copy all text ──────────────────────────────────────────────────────
    const handleCopyText = useCallback(async () => {
        if (!pages.length) return;
        mxLog.info("PdfViewer.copyText", `Extracting text from ${pages.length} page(s)...`);
        setCopyStatus("copying");
        try {
            const chunks = await Promise.all(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                pages.map(async (page: any) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const tc = await page.getTextContent({ normalizeWhitespace: true });
                    // Group items by approximate Y position to preserve line breaks
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const lines: Map<number, string[]> = new Map();
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    tc.items.forEach((item: any) => {
                        if (!("str" in item)) return;
                        // Round Y to nearest 2px to group items on the same line
                        const y = Math.round((item.transform?.[5] ?? 0) / 2) * 2;
                        if (!lines.has(y)) lines.set(y, []);
                        lines.get(y)!.push(item.str);
                    });
                    // Sort descending by Y (PDF coordinate origin is bottom-left)
                    return Array.from(lines.entries())
                        .sort((a, b) => b[0] - a[0])
                        .map(([, words]) => words.join(""))
                        .join("\n");
                })
            );

            const fullText = chunks.join("\n\n");

            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(fullText);
            } else {
                // Fallback for non-HTTPS or older browsers
                const ta = document.createElement("textarea");
                ta.value = fullText;
                ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
            }

            mxLog.info("PdfViewer.copyText", `Text extracted and copied to clipboard (${fullText.length} chars).`);
            setCopyStatus("copied");
            setTimeout(() => setCopyStatus("idle"), 2500);
        } catch (err) {
            mxLog.error("PdfViewer.copyText", "Failed to copy text to clipboard.", err);
            setCopyStatus("error");
            setTimeout(() => setCopyStatus("idle"), 2500);
        }
    }, [pages]);

    // ── Download ───────────────────────────────────────────────────────────
    const handleDownload = () => {
        if (localFile) {
            mxLog.info("PdfViewer.download", `Downloading local file: "${localFile.name}"`);
            try {
                const objUrl = URL.createObjectURL(localFile);
                triggerDownload(objUrl, `${displayFileName}.pdf`);
                URL.revokeObjectURL(objUrl);
            } catch (err) {
                mxLog.error("PdfViewer.download", "Failed to create object URL for local file download.", err);
            }
        } else if (url) {
            mxLog.info("PdfViewer.download", `Downloading PDF from URL: ${url}`);
            try {
                triggerDownload(url, `${displayFileName}.pdf`);
            } catch (err) {
                mxLog.error("PdfViewer.download", "Failed to trigger download from URL.", err);
            }
        } else {
            mxLog.warn("PdfViewer.download", "Download triggered but no URL or file is available.");
        }
    };

    function triggerDownload(href: string, name: string): void {
        const a = document.createElement("a");
        a.href = href; a.download = name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }

    // ── Print ──────────────────────────────────────────────────────────────
    const handlePrint = () => {
        if (localFile) {
            mxLog.info("PdfViewer.print", `Printing local file: "${localFile.name}"`);
            try {
                const objUrl = URL.createObjectURL(localFile);
                const w = window.open(objUrl, "_blank");
                if (w) {
                    w.onload = () => { w.print(); URL.revokeObjectURL(objUrl); };
                } else {
                    mxLog.warn("PdfViewer.print", "Print window was blocked by the browser pop-up blocker.");
                    URL.revokeObjectURL(objUrl);
                }
            } catch (err) {
                mxLog.error("PdfViewer.print", "Failed to open print window for local file.", err);
            }
        } else if (url) {
            mxLog.info("PdfViewer.print", `Printing PDF from URL: ${url}`);
            try {
                const w = window.open(url, "_blank");
                if (w) {
                    w.onload = () => w.print();
                } else {
                    mxLog.warn("PdfViewer.print", "Print window was blocked by the browser pop-up blocker.");
                }
            } catch (err) {
                mxLog.error("PdfViewer.print", "Failed to open print window.", err);
            }
        } else {
            mxLog.warn("PdfViewer.print", "Print triggered but no URL or file is available.");
        }
    };

    // ── File upload ────────────────────────────────────────────────────────
    const acceptFile = useCallback((file: File) => {
        if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
            mxLog.info("PdfViewer.upload", `Accepted local file: "${file.name}" (${Math.round(file.size / 1024)} KB)`);
            setLocalFile(file);
        } else {
            mxLog.warn("PdfViewer.upload", `Rejected file "${file.name}" — not a PDF (type: "${file.type}")`);
        }
    }, []);

    const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) acceptFile(file);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
        if (!enableUpload) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setIsDragOver(true);
    };

    const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
        }
    };

    const handleDrop = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragOver(false);
        if (!enableUpload) return;
        const file = e.dataTransfer.files?.[0];
        if (file) acceptFile(file);
    };

    // ── Page ref registration ──────────────────────────────────────────────
    const registerPageRef = useCallback((el: HTMLDivElement | null, n: number) => {
        if (el) {
            pageWrapRefs.current.set(n, el);
            observerRef.current?.observe(el);
        } else {
            const old = pageWrapRefs.current.get(n);
            if (old) observerRef.current?.unobserve(old);
            pageWrapRefs.current.delete(n);
        }
    }, []);

    // ── Derived ────────────────────────────────────────────────────────────
    const numPages   = pages.length;
    const hasSource  = !!url || !!localFile;

    // ── Render: library error ──────────────────────────────────────────────
    if (libError) {
        return (
            <div className="pdf-viewer" style={{ height }}>
                <div className="pdf-error">
                    <ErrorIcon />
                    <p className="pdf-error-title">PDF.js could not be loaded</p>
                    <p className="pdf-error-detail">{libError}</p>
                    <p className="pdf-error-hint">Connect to the internet once to enable offline PDF viewing.</p>
                </div>
            </div>
        );
    }

    // ── Render: no source ──────────────────────────────────────────────────
    if (!hasSource) {
        return (
            <div
                className={`pdf-empty${isDragOver ? " pdf-drop-active" : ""}`}
                style={{ minHeight: height }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <DocumentIcon />
                <p className="pdf-empty-title">No document loaded</p>
                <p className="pdf-empty-sub">
                    {enableUpload
                        ? "Bind a FileDocument data source, configure the PDF URL, or upload a local file."
                        : "Bind a FileDocument data source or configure the PDF URL property."}
                </p>
                {enableUpload && (
                    <>
                        <button
                            type="button"
                            className="pdf-tb-btn pdf-upload-btn-large"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <UploadIcon /> Open PDF file
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="application/pdf"
                            style={{ display: "none" }}
                            onChange={handleFileInput}
                        />
                    </>
                )}
                {isDragOver && <div className="pdf-drop-hint">Drop PDF here</div>}
            </div>
        );
    }

    // ── Render: main viewer ────────────────────────────────────────────────
    return (
        <div
            className={`pdf-viewer${darkMode ? " pdf-dark" : ""}${isDragOver ? " pdf-drop-active" : ""}`}
            style={{ height }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {enableUpload && (
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    style={{ display: "none" }}
                    onChange={handleFileInput}
                />
            )}

            {/* ── Toolbar ──────────────────────────────────────────────── */}
            <div className="pdf-toolbar">

                {/* Version stamp — confirms correct .mpk is deployed */}
                <span className="pdf-version-stamp" title={`Build: ${WIDGET_BUILD}`}>
                    {WIDGET_VERSION}
                </span>

                {/* Left: upload + search */}
                <div className="pdf-tb-group">
                    {enableUpload && (
                        <button
                            type="button"
                            className="pdf-tb-btn"
                            onClick={() => fileInputRef.current?.click()}
                            title="Open local PDF file"
                        ><UploadIcon /></button>
                    )}

                    {enableSearch && (
                        <button
                            type="button"
                            className={`pdf-tb-btn${searchOpen ? " active" : ""}`}
                            onClick={() => setSearchOpen(v => !v)}
                            title="Search in document"
                        ><SearchIcon /></button>
                    )}
                </div>

                {/* Centre: page navigation */}
                <div className="pdf-tb-group pdf-tb-nav">
                    <button
                        type="button"
                        className="pdf-tb-btn"
                        onClick={() => goToPage(currentPage - 1)}
                        disabled={currentPage <= 1 || numPages === 0}
                        title="Previous page"
                    >‹</button>
                    <div className="pdf-page-nav">
                        <input
                            type="text"
                            className="pdf-page-input"
                            value={pageInput}
                            onChange={e => setPageInput(e.target.value)}
                            onBlur={handlePageInputBlur}
                            onKeyDown={handlePageInputKey}
                            aria-label="Current page"
                        />
                        <span className="pdf-page-sep">/</span>
                        <span className="pdf-page-total">{numPages || "—"}</span>
                    </div>
                    <button
                        type="button"
                        className="pdf-tb-btn"
                        onClick={() => goToPage(currentPage + 1)}
                        disabled={currentPage >= numPages}
                        title="Next page"
                    >›</button>
                </div>

                {/* Zoom */}
                <div className="pdf-tb-group pdf-tb-zoom">
                    <button
                        type="button" className="pdf-tb-btn"
                        onClick={() => setScale(s => Math.max(ZOOM_MIN, +(s - ZOOM_STEP).toFixed(2)))}
                        disabled={scale <= ZOOM_MIN}
                        title="Zoom out"
                    >−</button>
                    <span className="pdf-zoom-label">{Math.round(scale * 100)}%</span>
                    <button
                        type="button" className="pdf-tb-btn"
                        onClick={() => setScale(s => Math.min(ZOOM_MAX, +(s + ZOOM_STEP).toFixed(2)))}
                        disabled={scale >= ZOOM_MAX}
                        title="Zoom in"
                    >+</button>
                    <button type="button" className="pdf-tb-btn pdf-tb-sm" onClick={fitToWidth}          title="Fit to width">⊡</button>
                    {enableFitToPage && (
                        <button type="button" className="pdf-tb-btn pdf-tb-sm" onClick={fitToPage} title="Fit to page">⊞</button>
                    )}
                    <button type="button" className="pdf-tb-btn pdf-tb-sm" onClick={() => setScale(1.0)} title="Actual size">1:1</button>
                </div>

                {/* Right: rotate + copy + download + print */}
                <div className="pdf-tb-group">
                    {enableRotate && (
                        <button
                            type="button" className="pdf-tb-btn"
                            onClick={() => setRotation(r => (r + 90) % 360)}
                            title="Rotate 90°"
                        >↻</button>
                    )}

                    {enableCopyText && (
                        <button
                            type="button"
                            className={`pdf-tb-btn pdf-copy-btn${copyStatus === "copied" ? " copied" : copyStatus === "error" ? " copy-error" : ""}`}
                            onClick={handleCopyText}
                            disabled={copyStatus === "copying" || numPages === 0}
                            title="Copy all text to clipboard"
                        >
                            {copyStatus === "copied"
                                ? <CheckIcon />
                                : copyStatus === "error"
                                    ? <ErrorSmallIcon />
                                    : <CopyIcon />
                            }
                        </button>
                    )}

                    {enableDownload && (
                        <button
                            type="button" className="pdf-tb-btn"
                            onClick={handleDownload}
                            disabled={!url && !localFile}
                            title="Download PDF"
                        ><DownloadIcon /></button>
                    )}

                    {enablePrint && (
                        <button
                            type="button" className="pdf-tb-btn"
                            onClick={handlePrint}
                            disabled={!url && !localFile}
                            title="Print PDF"
                        ><PrintIcon /></button>
                    )}
                </div>

                {/* Status badges */}
                <div className="pdf-tb-badges">
                    {localFile && (
                        <span className="pdf-badge pdf-badge-local" title={localFile.name}>
                            {localFile.name.length > 18
                                ? localFile.name.slice(0, 16) + "…"
                                : localFile.name}
                            <button
                                type="button"
                                className="pdf-badge-close"
                                onClick={() => setLocalFile(null)}
                                title="Close local file"
                            >✕</button>
                        </span>
                    )}
                    {isCachedSource && !localFile && (
                        <span className="pdf-badge pdf-badge-cached" title="Loaded from offline cache">
                            <CacheIcon /> Cached
                        </span>
                    )}
                    {isOffline && (
                        <span className="pdf-badge pdf-badge-offline" title="No internet connection">
                            Offline
                        </span>
                    )}
                </div>
            </div>

            {/* ── Search bar ───────────────────────────────────────────── */}
            {searchOpen && enableSearch && (
                <div className="pdf-search-bar">
                    <SearchIcon />
                    <input
                        className="pdf-search-input"
                        type="text"
                        placeholder="Search in document…"
                        value={searchText}
                        onChange={e => setSearchText(e.target.value)}
                        autoFocus
                    />
                    {searchText && (
                        <button type="button" className="pdf-search-clear"
                            onClick={() => setSearchText("")}>✕</button>
                    )}
                </div>
            )}

            {/* ── Copy toast ───────────────────────────────────────────── */}
            {copyStatus !== "idle" && (
                <div className={`pdf-toast${copyStatus === "copied" ? " pdf-toast-success" : copyStatus === "error" ? " pdf-toast-error" : ""}`}>
                    {copyStatus === "copying" && "Copying text…"}
                    {copyStatus === "copied"  && "Text copied to clipboard!"}
                    {copyStatus === "error"   && "Copy failed. Select text manually and press Ctrl+C."}
                </div>
            )}

            {/* ── Body: sidebar + content ──────────────────────────────── */}
            <div className="pdf-body">

                {/* Thumbnail sidebar */}
                {sidebarOpen && (
                    <div className="pdf-sidebar" ref={sidebarRef}>
                        {pages.map((page, i) => (
                            <PdfThumbnail
                                key={i + 1}
                                pdfPage={page}
                                pageNum={i + 1}
                                isActive={i + 1 === currentPage}
                                onClick={() => goToPage(i + 1)}
                            />
                        ))}
                    </div>
                )}

                {/* Main scroll area */}
                <div className="pdf-content" ref={contentRef}>
                    {loading && (
                        <div className="pdf-loading">
                            <div className="pdf-spinner" />
                            <span>Loading document…</span>
                        </div>
                    )}

                    {!loading && docError && (
                        <div className="pdf-error">
                            <ErrorIcon />
                            <p className="pdf-error-title">Unable to open document</p>
                            <p className="pdf-error-detail">{docError}</p>
                        </div>
                    )}

                    {!loading && !docError && pages.map((page, i) => {
                        const n = i + 1;
                        return (
                            <div
                                key={n}
                                ref={el => registerPageRef(el, n)}
                                data-page-number={n}
                                className="pdf-page-wrap"
                            >
                                <PdfPage
                                    pdfjsLib={pdfjsLib}
                                    pdfPage={page}
                                    scale={renderScale}   // debounced — no render storm
                                    rotation={rotation}
                                    searchText={searchText}
                                    pageNum={n}
                                    isVisible={visiblePageNums.has(n)}  // lazy render
                                />
                                <div className="pdf-page-badge">{n}</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ── Drag overlay ─────────────────────────────────────────── */}
            {isDragOver && enableUpload && (
                <div className="pdf-drop-overlay">
                    <UploadIcon />
                    <span>Drop PDF to open</span>
                </div>
            )}
        </div>
    );
}

// ── Inline SVG icons ──────────────────────────────────────────────────────

function SearchIcon(): ReactElement {
    return (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}
function UploadIcon(): ReactElement {
    return (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M7.5 1v9M4 4.5L7.5 1 11 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 11v2a1 1 0 001 1h9a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}
function DownloadIcon(): ReactElement {
    return (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M7.5 1v9M4 7l3.5 3.5L11 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 13h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}
function PrintIcon(): ReactElement {
    return (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <rect x="3" y="9" width="9" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
            <path d="M3 9V4h9v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M5 4V2h5v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="11" cy="6.5" r="0.75" fill="currentColor" />
        </svg>
    );
}
function CopyIcon(): ReactElement {
    return (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <rect x="5" y="1" width="9" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M3 5H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}
function CheckIcon(): ReactElement {
    return (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M2 8l4 4 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
function ErrorSmallIcon(): ReactElement {
    return (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M7.5 4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="7.5" cy="10.5" r="0.75" fill="currentColor" />
        </svg>
    );
}
function CacheIcon(): ReactElement {
    return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <ellipse cx="6" cy="3" rx="4.5" ry="1.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M1.5 3v2c0 .83 2.015 1.5 4.5 1.5S10.5 5.83 10.5 5V3" stroke="currentColor" strokeWidth="1.2" />
            <path d="M1.5 5v2c0 .83 2.015 1.5 4.5 1.5S10.5 7.83 10.5 7V5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
    );
}
function ErrorIcon(): ReactElement {
    return (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="2.5" />
            <path d="M24 14v14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <circle cx="24" cy="33" r="1.5" fill="currentColor" />
        </svg>
    );
}
function DocumentIcon(): ReactElement {
    return (
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
            <rect x="8" y="4" width="30" height="44" rx="3" stroke="currentColor" strokeWidth="2.5" />
            <path d="M30 4v16h8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <rect x="16" y="28" width="18" height="2.5" rx="1.25" fill="currentColor" />
            <rect x="16" y="34" width="12" height="2.5" rx="1.25" fill="currentColor" />
        </svg>
    );
}
