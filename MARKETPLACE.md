# Viewer PDF

A feature-rich, fully client-side PDF viewer for Mendix web apps. Display any PDF from a base64 string, data URL, or HTTP(S) URL — with thumbnails, full-text search, zoom, rotate, print, download, upload, copy-text, dark mode, and offline caching. Built on PDF.js, with **zero external network requests** and full Mendix CSP compatibility.

---

## Overview / Description

**Viewer PDF** lets you embed a professional PDF reading experience directly inside your Mendix pages. Bind it to a string attribute or expression that resolves to a PDF (base64, `data:` URL, or a normal `https://` link) and the widget renders the document inline — no plugins, no pop-ups, no third-party services.

The viewer is **100% client-side**: the PDF.js engine is bundled into the widget JavaScript at build time and injected as an inline script, so it works offline from the first page load and never makes a network call to a CDN. This keeps it compatible with strict Mendix Content Security Policy (CSP) settings.

### Features

- **Flexible input** – Accepts a raw base64 string, a `data:application/pdf;base64,...` data URL, or a standard HTTP/HTTPS URL.
- **Smooth performance** – Lazy page rendering via `IntersectionObserver` (only visible pages, ±1 buffer, are drawn to canvas), debounced zoom, and batched scroll state so large documents stay responsive.
- **Thumbnail sidebar** – Optional left-hand thumbnail panel for fast page navigation.
- **Full-text search** – Search within the document with highlighted matches.
- **Zoom controls** – Zoom in/out, Fit to Width (always available), and optional Fit to Page.
- **Rotate** – Rotate pages 90° at a time.
- **Download & Print** – Optional toolbar buttons; the download file name is configurable.
- **Import (Upload)** – Let users load a PDF from their local device, including drag-and-drop.
- **Copy all text** – Copy the entire document's text content to the clipboard.
- **Dark mode** – Built-in dark theme.
- **Offline caching** – URL-loaded PDFs are cached in IndexedDB and shown with "Offline" / "Cached" toolbar badges.
- **CSP-safe & offline-first** – PDF.js is bundled inline (no `blob:` script URLs, no CDN), so it runs on any network and under strict CSP.
- **Multiple instances** – PDF.js loads once per page and is reused across widget instances.

### Typical use cases

- Displaying generated documents (invoices, contracts, reports) stored as base64 in a System.FileDocument or string attribute.
- Showing PDFs served from a REST endpoint or document URL.
- Letting end users upload and preview a PDF before submitting.

### Compatibility

- **Mendix Studio Pro:** Pluggable widget (built with Pluggable Widgets Tools 11.x).
- **Platform:** Web (responsive).
- **Offline-capable:** Yes.
- **Context:** No entity context required — drop it anywhere.

---

## Documentation

### Installation

1. Download **Viewer PDF** from the Mendix Marketplace and import it into your app, **or** place the `.mpk` file in your project's `widgets` folder.
2. In Studio Pro, drag the **Viewer Pdf** widget onto a page.
3. Configure the properties below.

### Configuration

#### Data Source

| Property | Type | Required | Description |
|---|---|---|---|
| **PDF String** (`pdfUrl`) | Expression (String) | No | The PDF content. Accepts a raw base64 string, a `data:application/pdf;base64,...` data URL, or a standard HTTP/HTTPS URL. |
| **Download File Name** (`fileName`) | Expression (String) | No | Name for the downloaded file (without the `.pdf` extension). Defaults to `document`. |

#### Appearance

| Property | Type | Default | Description |
|---|---|---|---|
| **Height** (`height`) | String | `600px` | Height of the viewer container (e.g. `600px`, `80vh`, `100%`). |
| **Dark Mode** (`darkMode`) | Boolean | `false` | Enable the dark theme for the viewer. |

#### Behavior

| Property | Type | Default | Description |
|---|---|---|---|
| **Show Thumbnail Sidebar** (`showThumbnailSidebar`) | Boolean | `false` | Show the thumbnail panel on the left for page navigation. |
| **Enable Search** (`showSearchButton`) | Boolean | `false` | Show the search button for full-text search within the document. |
| **Enable Download** (`showDownloadButton`) | Boolean | `false` | Show a download button in the toolbar. |
| **Enable Print** (`showPrintButton`) | Boolean | `false` | Show a print button in the toolbar. |
| **Enable Import (Upload)** (`showUploadButton`) | Boolean | `false` | Show an import/upload button so users can load a PDF from their device (also enables drag-and-drop). |
| **Enable Copy All Text** (`showCopyTextButton`) | Boolean | `false` | Show a button that copies all document text to the clipboard. |
| **Enable Rotate** (`showRotateButton`) | Boolean | `false` | Show a rotate button to rotate pages 90° at a time. |
| **Enable Fit to Page** (`showFitToPageButton`) | Boolean | `false` | Show a fit-to-page button (scales to fit both width and height). Fit to Width is always available. |

### How to use

**1. Display a base64 PDF (e.g. from a generated document)**

Set **PDF String** to an expression that returns your base64 content, such as a string attribute holding the document, then enable the toolbar buttons you want (Download, Print, Search, etc.).

**2. Display a PDF from a URL**

Set **PDF String** to an `https://...` URL. The widget fetches and renders it, and caches it in IndexedDB so it remains available offline (an "Offline" or "Cached" badge appears in the toolbar).

**3. Let users upload a PDF**

Enable **Import (Upload)**. End users can click the import button or drag-and-drop a PDF file from their device into the viewer.

### Notes & limitations

- The widget is **client-side only** — the PDF is rendered in the browser; no server-side processing is performed.
- PDF.js is bundled inline at build time, so there are **no external network calls** for the rendering engine. This keeps the widget compatible with strict CSP configurations (it uses `unsafe-inline` for the library script and `worker-src blob:` for the worker, both of which Mendix permits).
- Only the **Web** platform is supported.

### Issues, suggestions and feature requests

Please report issues and feature requests on the GitHub repository:
https://github.com/felixrajavictor/PDFViewer/issues

### License

Apache-2.0.

### Credits

PDF rendering powered by [PDF.js](https://mozilla.github.io/pdf.js/) by Mozilla.
