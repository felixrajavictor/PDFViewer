import { ReactElement } from "react";
import { ViewerPdfContainerProps } from "../typings/ViewerPdfProps";
import { PdfViewer } from "./components/PdfViewer";
import "./ui/ViewerPdf.css";

// ── Widget entry point ─────────────────────────────────────────────────────
//
// Accepts a PDF as a plain string via the `pdfUrl` expression property.
// The string can be any of:
//   • Raw base64 string          e.g. JVBERi0xLjQK...
//   • Data URL                   e.g. data:application/pdf;base64,JVBERi0x...
//   • Standard HTTP/HTTPS URL    e.g. https://example.com/file.pdf
//   • Mendix file URL            e.g. /file?guid=12345678901234567
//
// Decoding and loading is handled inside PdfViewer → no URL resolution
// or entity-object handling is needed here.

export function ViewerPdf({
    pdfUrl,
    fileName,
    height,
    showThumbnailSidebar,
    darkMode,
    showSearchButton,
    showDownloadButton,
    showPrintButton,
    showUploadButton,
    showCopyTextButton,
    showRotateButton,
    showFitToPageButton,
    class: className,
    style
}: ViewerPdfContainerProps): ReactElement {

    // Trim whitespace — Mendix string attributes sometimes include
    // leading/trailing spaces or newlines. Treat blank string as no value.
    const rawUrl      = pdfUrl?.value ?? "";
    const resolvedUrl = rawUrl.trim() || undefined;
    const name        = fileName?.value?.trim() || "document";

    return (
        <div className={`widget-viewer-pdf${className ? ` ${className}` : ""}`} style={style}>
            <PdfViewer
                url={resolvedUrl}
                fileName={name}
                height={height || "600px"}
                showThumbnails={showThumbnailSidebar}
                darkMode={darkMode}
                enableSearch={showSearchButton}
                enableDownload={showDownloadButton}
                enablePrint={showPrintButton}
                enableUpload={showUploadButton}
                enableCopyText={showCopyTextButton}
                enableRotate={showRotateButton}
                enableFitToPage={showFitToPageButton}
            />
        </div>
    );
}
