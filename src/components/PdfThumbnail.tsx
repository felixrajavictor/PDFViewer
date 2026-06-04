/**
 * PdfThumbnail.tsx
 * Renders a small canvas thumbnail for the sidebar.
 */

import { ReactElement, useRef, useEffect } from "react";

interface PdfThumbnailProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pdfPage: any; // PDFPageProxy
    pageNum: number;
    isActive: boolean;
    onClick: () => void;
}

const THUMB_WIDTH = 100; // px

export function PdfThumbnail({ pdfPage, pageNum, isActive, onClick }: PdfThumbnailProps): ReactElement {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const taskRef = useRef<any>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !pdfPage) return;

        const naturalViewport = pdfPage.getViewport({ scale: 1, rotation: 0 });
        const scale = THUMB_WIDTH / naturalViewport.width;
        const viewport = pdfPage.getViewport({ scale, rotation: 0 });

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        if (taskRef.current) taskRef.current.cancel();

        const task = pdfPage.render({ canvasContext: ctx, viewport });
        taskRef.current = task;

        task.promise.catch(() => {/* cancelled */});

        return () => {
            task.cancel();
        };
    }, [pdfPage]);

    return (
        <button
            type="button"
            className={`pdf-thumb${isActive ? " pdf-thumb-active" : ""}`}
            onClick={onClick}
            title={`Go to page ${pageNum}`}
            data-thumb={pageNum}
        >
            <canvas ref={canvasRef} />
            <span className="pdf-thumb-num">{pageNum}</span>
        </button>
    );
}
