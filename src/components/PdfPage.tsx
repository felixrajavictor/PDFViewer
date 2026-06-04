/**
 * PdfPage.tsx
 *
 * Renders a single PDF page to a <canvas> and overlays a transparent text
 * layer for selection, copy, and search highlights.
 *
 * Performance features
 * ────────────────────
 *  • React.memo   — only re-renders when props actually change
 *  • isVisible    — skeleton placeholder replaces canvas when off-screen;
 *                   no GPU/CPU work wasted on invisible pages
 *  • requestIdleCallback — canvas render is scheduled during browser idle
 *                   time so the UI never freezes, even on 200-page PDFs
 *  • Proper cancel — in-flight renders are cancelled synchronously before
 *                   starting a new one (scale/rotation change, unmount)
 *
 * Bug fixes
 * ─────────
 *  • --scale-factor CSS variable is set on the text layer container BEFORE
 *    pdfjsLib.renderTextLayer() is called (fixes the pdfjs v3.x error)
 *  • Line-by-line text selection works because each text span is laid out
 *    with its own absolute transform; ::selection background is transparent
 *    so the canvas shows through while the highlight is still visible
 */

import { ReactElement, useRef, useEffect, useCallback, memo } from "react";
import { mxLog } from "./MxLogger";

// ── Types ──────────────────────────────────────────────────────────────────

interface PdfPageProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pdfjsLib: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pdfPage: any; // PDFPageProxy
    scale: number;
    rotation: number;
    searchText: string;
    pageNum: number;
    /** When false: render a skeleton placeholder instead of the canvas.
     *  Set by PdfViewer via IntersectionObserver so only visible pages draw. */
    isVisible: boolean;
}

// ── requestIdleCallback polyfill ───────────────────────────────────────────

const scheduleIdle: (fn: () => void) => number =
    typeof requestIdleCallback !== "undefined"
        ? (fn) => requestIdleCallback(fn, { timeout: 3000 })
        : (fn) => window.setTimeout(fn, 16) as unknown as number;

const cancelIdle: (id: number) => void =
    typeof cancelIdleCallback !== "undefined"
        ? cancelIdleCallback
        : window.clearTimeout;

// ── Component ──────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const PdfPage = memo(function PdfPage({
    pdfjsLib,
    pdfPage,
    scale,
    rotation,
    searchText,
    pageNum,
    isVisible
}: PdfPageProps): ReactElement {

    const canvasRef       = useRef<HTMLCanvasElement>(null);
    const textLayerRef    = useRef<HTMLDivElement>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderTaskRef   = useRef<any>(null);
    const idleIdRef       = useRef<number | null>(null);
    const textRenderedRef = useRef(false);

    // ── Touch dead-zone for text selection ─────────────────────────────────
    // On tablets the text layer is extremely sensitive — any small touch
    // immediately starts a text-selection drag. We suppress user-select until
    // the finger has moved at least TOUCH_THRESHOLD px AND the movement is
    // more horizontal than vertical (i.e. it looks like an intentional select,
    // not a scroll). Vertical-dominant movement keeps selection off so normal
    // page scrolling is never disrupted.
    const TOUCH_THRESHOLD = 12; // px — dead zone before selection activates
    const touchOriginRef  = useRef<{ x: number; y: number } | null>(null);

    const setTextSelect = (enabled: boolean) => {
        const el = textLayerRef.current;
        if (!el) return;
        el.style.userSelect         = enabled ? "text" : "none";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (el.style as any).webkitUserSelect = enabled ? "text" : "none";
    };

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        const t = e.touches[0];
        touchOriginRef.current = { x: t.clientX, y: t.clientY };
        // Block selection immediately — only re-enable once the gesture
        // has crossed the threshold in a horizontal direction.
        setTextSelect(false);
    }, []);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (!touchOriginRef.current) return;
        const t  = e.touches[0];
        const dx = Math.abs(t.clientX - touchOriginRef.current.x);
        const dy = Math.abs(t.clientY - touchOriginRef.current.y);
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist >= TOUCH_THRESHOLD) {
            // Vertical-dominant → the user is scrolling, keep selection off.
            // Horizontal-dominant → deliberate text-selection drag, allow it.
            setTextSelect(dx >= dy);
        }
    }, []);

    const handleTouchEnd = useCallback(() => {
        touchOriginRef.current = null;
        // Restore selectability so mouse/stylus users can still select normally.
        setTextSelect(true);
    }, []);

    // Always compute dimensions (cheap — just math, no rendering)
    const viewport = pdfPage.getViewport({ scale, rotation });

    // ── Canvas + text layer render ─────────────────────────────────────────
    useEffect(() => {
        // ── Cancel any pending work from the previous render cycle ─────────
        if (idleIdRef.current !== null) {
            cancelIdle(idleIdRef.current);
            idleIdRef.current = null;
        }
        if (renderTaskRef.current) {
            renderTaskRef.current.cancel();
            renderTaskRef.current = null;
        }

        // Skip rendering entirely when the page is off-screen
        if (!isVisible) return;

        textRenderedRef.current = false;
        let cancelled = false;

        // Schedule via idle callback so we don't block the main thread.
        // Multiple pages becoming visible at the same time are therefore
        // staggered naturally across idle frames.
        idleIdRef.current = scheduleIdle(() => {
            idleIdRef.current = null;
            if (cancelled) return;

            const canvas  = canvasRef.current;
            const textDiv = textLayerRef.current;
            if (!canvas || !textDiv || !pdfPage) return;

            // Re-compute viewport inside the idle callback so we use the
            // scale value that was current when the callback fires
            const vp  = pdfPage.getViewport({ scale, rotation });
            const dpr = window.devicePixelRatio || 1;

            // ── Size canvas for HiDPI (retina) displays ─────────────────
            canvas.width  = Math.round(vp.width  * dpr);
            canvas.height = Math.round(vp.height * dpr);
            canvas.style.width  = `${vp.width}px`;
            canvas.style.height = `${vp.height}px`;

            // ── Size text layer to match logical (CSS) dimensions ────────
            textDiv.style.width  = `${vp.width}px`;
            textDiv.style.height = `${vp.height}px`;
            textDiv.innerHTML    = "";

            // ── KEY FIX: set --scale-factor BEFORE renderTextLayer ───────
            // PDF.js v3.x reads this CSS variable from the container element.
            // If absent it throws:
            //   "The --scale-factor CSS-variable must be set, to the same
            //    value as viewport.scale"
            textDiv.style.setProperty("--scale-factor", String(vp.scale));

            // ── Draw the page onto the canvas ────────────────────────────
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            if (dpr !== 1) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const renderTask = pdfPage.render({ canvasContext: ctx, viewport: vp });
            renderTaskRef.current = renderTask;

            renderTask.promise
                .then(() => {
                    if (cancelled) return;
                    renderTaskRef.current = null;
                    mxLog.debug("PdfPage.render", `Page ${pageNum} canvas rendered at scale ${scale.toFixed(2)}.`);

                    // ── Build text layer for selection + search ───────────
                    return pdfPage.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
                })
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .then((textContent: any) => {
                    if (cancelled || !textContent || !textLayerRef.current) return;

                    const container = textLayerRef.current;
                    container.innerHTML = "";

                    // Re-set scale factor after clearing innerHTML
                    container.style.setProperty("--scale-factor", String(vp.scale));

                    const task = pdfjsLib.renderTextLayer({
                        textContent,
                        container,
                        viewport: vp,
                        textDivs: [],
                    });

                    // PDF.js v3 renderTextLayer: some builds return a RenderTask
                    // with .promise, others return a Promise directly, some void.
                    const p = task?.promise ?? task;
                    return (p instanceof Promise) ? p : Promise.resolve();
                })
                .then(() => {
                    if (cancelled) return;
                    textRenderedRef.current = true;
                    mxLog.debug("PdfPage.textLayer", `Page ${pageNum} text layer rendered.`);
                    applySearch(textLayerRef.current, searchText);
                })
                .catch((err: any) => {
                    if (err?.name === "RenderingCancelledException" || err?.name === "AbortException") {
                        mxLog.debug("PdfPage.render", `Page ${pageNum} render cancelled (page changed or unmounted).`);
                    } else {
                        mxLog.error("PdfPage.render", `Page ${pageNum} failed to render.`, err);
                    }
                });
        });

        // ── Cleanup ───────────────────────────────────────────────────────
        return () => {
            cancelled = true;
            if (idleIdRef.current !== null) {
                cancelIdle(idleIdRef.current);
                idleIdRef.current = null;
            }
            if (renderTaskRef.current) {
                renderTaskRef.current.cancel();
                renderTaskRef.current = null;
            }
        };

        // searchText is intentionally excluded: handled by a separate effect
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pdfPage, scale, rotation, pdfjsLib, isVisible]);

    // ── Re-apply search highlights when query changes ──────────────────────
    useEffect(() => {
        if (textRenderedRef.current) {
            applySearch(textLayerRef.current, searchText);
        }
    }, [searchText]);

    // ── Render ─────────────────────────────────────────────────────────────

    // Off-screen: show a skeleton placeholder at the correct dimensions.
    // The scrollbar position and page layout remain accurate even though
    // no canvas work is done.
    if (!isVisible) {
        return (
            <div
                className="pdf-page-inner"
                style={{ width: viewport.width, height: viewport.height, position: "relative" }}
            >
                <div
                    className="pdf-page-skeleton"
                    style={{ width: "100%", height: "100%", borderRadius: 2 }}
                />
            </div>
        );
    }

    return (
        <div
            className="pdf-page-inner"
            style={{ width: viewport.width, height: viewport.height, position: "relative" }}
        >
            <canvas ref={canvasRef} className="pdf-canvas" />
            <div
                ref={textLayerRef}
                className="pdf-text-layer"
                data-page={pageNum}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
            />
        </div>
    );
});

// ── Search highlight helper ────────────────────────────────────────────────

function applySearch(container: HTMLDivElement | null, searchText: string): void {
    if (!container) return;

    // Remove previous highlights (unwrap <mark> elements)
    container.querySelectorAll("mark.pdf-hl").forEach(mark => {
        mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
    });
    container.normalize();

    if (!searchText.trim()) return;

    const regex = new RegExp(escapeRegex(searchText), "gi");
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];

    let node = walker.nextNode();
    while (node) {
        textNodes.push(node as Text);
        node = walker.nextNode();
    }

    textNodes.forEach(textNode => {
        const text = textNode.nodeValue ?? "";
        regex.lastIndex = 0;
        if (!regex.test(text)) return;
        regex.lastIndex = 0;

        const frag = document.createDocumentFragment();
        let lastIdx = 0;
        let m: RegExpExecArray | null;

        while ((m = regex.exec(text)) !== null) {
            if (m.index > lastIdx) {
                frag.appendChild(document.createTextNode(text.slice(lastIdx, m.index)));
            }
            const mark = document.createElement("mark");
            mark.className = "pdf-hl";
            mark.textContent = m[0];
            frag.appendChild(mark);
            lastIdx = m.index + m[0].length;
        }

        if (lastIdx < text.length) {
            frag.appendChild(document.createTextNode(text.slice(lastIdx)));
        }

        textNode.parentNode?.replaceChild(frag, textNode);
    });
}
