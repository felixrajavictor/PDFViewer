/**
 * PdfLoader.ts
 *
 * Loads PDF.js from content bundled directly into the widget JS at build time.
 *
 * WHY inline script instead of blob URL:
 *   Mendix CSP blocks `script-src blob:` URLs.
 *   Inline scripts (`script.textContent = ...`) are allowed via `unsafe-inline`
 *   which Mendix already permits. The worker uses a blob URL separately via
 *   `worker-src blob:` which is a different CSP directive and is allowed.
 *
 * Result: zero network requests, works on every network, offline from day 1.
 */

import { mxLog } from "./MxLogger";
import { PDFJS_LIB_CONTENT }    from "./pdfjs-lib-content";
import { PDFJS_WORKER_CONTENT } from "./pdfjs-worker-content";

const FN = "PdfLoader";

declare global {
    interface Window {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pdfjsLib: any;
    }
}

// Keep worker blob URL alive for the page lifetime (revoke = worker dies)
let _workerBlobUrl: string | null = null;

// Singleton — only load once per page
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _loadPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadPdfJs(): Promise<any> {
    if (_loadPromise) return _loadPromise;
    _loadPromise = doLoad();
    return _loadPromise;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function doLoad(): Promise<any> {
    // Already loaded (e.g. second widget instance on the same page)
    if (window.pdfjsLib) {
        mxLog.info(FN, "PDF.js already loaded — reusing existing instance.");
        ensureWorkerSrc();
        return window.pdfjsLib;
    }

    mxLog.info(FN, "Loading PDF.js from bundled inline content (no network required)...");

    try {
        // ── Step 1: Inject main library as INLINE script ───────────────────
        // Uses script.textContent instead of script.src so CSP `unsafe-inline`
        // applies (Mendix allows this). Blob URLs for scripts are CSP-blocked.
        await injectInlineScript(PDFJS_LIB_CONTENT);

        if (!window.pdfjsLib) {
            throw new Error("pdfjsLib not defined on window after inline script injection.");
        }

        mxLog.info(FN, "PDF.js main library injected successfully.");

        // ── Step 2: Create worker from bundled content via Blob URL ────────
        // Worker URLs use `worker-src` CSP (not `script-src`).
        // Mendix allows `worker-src blob:` so this works even when
        // `script-src blob:` is blocked.
        try {
            if (_workerBlobUrl) URL.revokeObjectURL(_workerBlobUrl);
            _workerBlobUrl = URL.createObjectURL(
                new Blob([PDFJS_WORKER_CONTENT], { type: "application/javascript" })
            );
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = _workerBlobUrl;
            mxLog.info(FN, "PDF.js worker initialized from bundled content.");
        } catch (workerErr) {
            // Worker blob failed — try data URL as last resort
            mxLog.warn(FN, "Worker blob URL failed, trying data URL fallback...", workerErr);
            const encoded = encodeURIComponent(PDFJS_WORKER_CONTENT);
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                `data:application/javascript,${encoded}`;
            mxLog.info(FN, "PDF.js worker initialized via data URL fallback.");
        }

        mxLog.info(FN, "PDF.js fully ready — bundled, offline-capable, no CDN used.");
        return window.pdfjsLib;

    } catch (err) {
        mxLog.error(FN, "Failed to initialize PDF.js from bundled content.", err);
        throw new Error(
            "PDF.js could not be initialized. " +
            String(err instanceof Error ? err.message : err)
        );
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Inject PDF.js as an inline script with AMD/CommonJS disabled.
 *
 * WHY the wrapper: Mendix runtime exposes a global AMD `define` function
 * (Dojo module system). PDF.js UMD detects it and calls define([], factory)
 * instead of setting window.pdfjsLib — so pdfjsLib is never on window.
 *
 * By shadowing define/module/exports with undefined inside an IIFE,
 * the UMD wrapper falls through to: root["pdfjsLib"] = factory()
 * where root = self = window. pdfjsLib is now correctly on window.
 */
function injectInlineScript(content: string): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            // Wrap content to disable AMD (define) and CommonJS (module/exports)
            // so PDF.js UMD always sets window.pdfjsLib (the global fallback branch)
            const wrapped = `(function(define, module, exports){\n${content}\n})(undefined, undefined, undefined);`;

            const script = document.createElement("script");
            script.textContent = wrapped;
            document.head.appendChild(script);
            resolve();
        } catch (err) {
            reject(new Error(`Inline script injection failed: ${String(err)}`));
        }
    });
}

function ensureWorkerSrc(): void {
    if (window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc && _workerBlobUrl) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = _workerBlobUrl;
        mxLog.debug(FN, "Worker src restored on existing pdfjsLib instance.");
    }
}
