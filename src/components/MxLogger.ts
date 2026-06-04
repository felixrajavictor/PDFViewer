/**
 * MxLogger.ts
 *
 * Thin wrapper around the Mendix runtime logger (window.mx.logger).
 * All messages appear in:
 *   - Mendix Studio Pro console  (when running locally)
 *   - Browser DevTools console   (always)
 *
 * Usage:
 *   import { mxLog } from "./MxLogger";
 *   mxLog.error("loadPdfJs", "Failed to load library", err);
 *   mxLog.warn ("fetchPdf",  "Falling back to cache");
 *   mxLog.info ("fetchPdf",  "Document loaded", { pages: 12, cached: false });
 */

const WIDGET = "ViewerPdf";

// Mendix runtime exposes window.mx.logger at runtime.
// We type only what we use to avoid a hard dependency.
declare global {
    interface Window {
        mx?: {
            logger?: {
                error: (category: string, msg: string, ...args: unknown[]) => void;
                warn:  (category: string, msg: string, ...args: unknown[]) => void;
                info:  (category: string, msg: string, ...args: unknown[]) => void;
                debug: (category: string, msg: string, ...args: unknown[]) => void;
            };
        };
    }
}

type Level = "error" | "warn" | "info" | "debug";

function log(level: Level, fn: string, msg: string, ...args: unknown[]): void {
    const category = `${WIDGET}.${fn}`;
    const prefix   = `[${WIDGET}][${fn}]`;

    // ── Mendix runtime logger ───────────────────────────────────────────────
    try {
        const mx = window.mx;
        if (mx?.logger?.[level]) {
            mx.logger[level](category, msg, ...args);
        }
    } catch {
        // mx.logger not available (design-time preview or unit tests)
    }

    // ── Browser / DevTools console ──────────────────────────────────────────
    // Always log to the browser console so developers can see errors even
    // when the Mendix runtime logger is not accessible.
    switch (level) {
        case "error": console.error(prefix, msg, ...args); break;
        case "warn":  console.warn (prefix, msg, ...args); break;
        case "info":  console.info (prefix, msg, ...args); break;
        case "debug": console.debug(prefix, msg, ...args); break;
    }
}

export const mxLog = {
    error: (fn: string, msg: string, ...args: unknown[]) => log("error", fn, msg, ...args),
    warn:  (fn: string, msg: string, ...args: unknown[]) => log("warn",  fn, msg, ...args),
    info:  (fn: string, msg: string, ...args: unknown[]) => log("info",  fn, msg, ...args),
    debug: (fn: string, msg: string, ...args: unknown[]) => log("debug", fn, msg, ...args),
};
