/**
 * This file was generated from ViewerPdf.xml
 * WARNING: All changes made to this file will be overwritten
 * @author Mendix Widgets Framework Team
 */
import { CSSProperties } from "react";
import { DynamicValue } from "mendix";

export interface ViewerPdfContainerProps {
    name: string;
    class: string;
    style?: CSSProperties;
    tabIndex?: number;
    pdfUrl?: DynamicValue<string>;
    fileName?: DynamicValue<string>;
    height: string;
    darkMode: boolean;
    showThumbnailSidebar: boolean;
    showSearchButton: boolean;
    showDownloadButton: boolean;
    showPrintButton: boolean;
    showUploadButton: boolean;
    showCopyTextButton: boolean;
    showRotateButton: boolean;
    showFitToPageButton: boolean;
}

export interface ViewerPdfPreviewProps {
    /**
     * @deprecated Deprecated since version 9.18.0. Please use class property instead.
     */
    className: string;
    class: string;
    style: string;
    styleObject?: CSSProperties;
    readOnly: boolean;
    renderMode: "design" | "xray" | "structure";
    translate: (text: string) => string;
    pdfUrl: string;
    fileName: string;
    height: string;
    darkMode: boolean;
    showThumbnailSidebar: boolean;
    showSearchButton: boolean;
    showDownloadButton: boolean;
    showPrintButton: boolean;
    showUploadButton: boolean;
    showCopyTextButton: boolean;
    showRotateButton: boolean;
    showFitToPageButton: boolean;
}
