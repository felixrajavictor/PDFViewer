import { ReactElement } from "react";
import { ViewerPdfPreviewProps } from "../typings/ViewerPdfProps";

export function preview({ height }: ViewerPdfPreviewProps): ReactElement {
    return (
        <div
            style={{
                height: height || "600px",
                background: "#f3f4f6",
                border: "2px dashed #d1d5db",
                borderRadius: "6px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "#6b7280",
                fontFamily: "sans-serif",
                gap: "8px"
            }}
        >
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <rect x="8" y="4" width="28" height="40" rx="3" stroke="#9ca3af" strokeWidth="2.5"/>
                <path d="M28 4v14h8" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round"/>
                <rect x="14" y="26" width="16" height="2.5" rx="1.25" fill="#9ca3af"/>
                <rect x="14" y="32" width="10" height="2.5" rx="1.25" fill="#9ca3af"/>
            </svg>
            <span style={{ fontWeight: 600, fontSize: 14 }}>PDF Viewer</span>
            <span style={{ fontSize: 12 }}>Configure the PDF URL to display a document</span>
        </div>
    );
}

export function getPreviewCss(): string {
    return "";
}
