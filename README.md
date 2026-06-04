## ViewerPdf

A feature-rich, fully client-side PDF viewer for Mendix web apps. Bind it to a string attribute or expression that resolves to a PDF — base64, a `data:` URL, or a normal `https://` link — and the widget renders the document inline with thumbnails, full-text search, zoom, rotate, print, download, upload, copy-text, dark mode, and offline caching.

Built on [PDF.js](https://mozilla.github.io/pdf.js/), bundled inline at build time, so it makes **zero external network requests**, works offline from the first page load, and stays compatible with strict Mendix Content Security Policy (CSP) settings.

## Features

- **Flexible input** – raw base64, a `data:application/pdf;base64,...` data URL, or an HTTP/HTTPS URL.
- **Smooth performance** – lazy page rendering (only visible pages, ±1 buffer, are drawn to canvas), debounced zoom, and batched scroll state for large documents.
- **Thumbnail sidebar** – optional left-hand panel for fast page navigation.
- **Full-text search** – search within the document with highlighted matches.
- **Zoom** – zoom in/out, Fit to Width (always available), and optional Fit to Page.
- **Rotate** – rotate pages 90° at a time.
- **Download & Print** – optional toolbar buttons; configurable download file name.
- **Import (Upload)** – load a PDF from the local device, including drag-and-drop.
- **Copy all text** – copy the entire document's text to the clipboard.
- **Dark mode** – built-in dark theme.
- **Offline caching** – URL-loaded PDFs are cached in IndexedDB, with "Offline" / "Cached" toolbar badges.
- **CSP-safe & offline-first** – PDF.js bundled inline (no CDN, no `blob:` script URLs).
- **Multiple instances** – PDF.js loads once per page and is reused across widget instances.

## Usage

1. Import the widget into your Mendix app (Marketplace) or place the `.mpk` in your project's `widgets` folder.
2. Drag the **Viewer Pdf** widget onto a page.
3. Configure the properties:

   **Data Source**
   - **PDF String** (`pdfUrl`) – the PDF content: raw base64, a `data:application/pdf;base64,...` URL, or an HTTP/HTTPS URL.
   - **Download File Name** (`fileName`) – name for downloads (without `.pdf`); defaults to `document`.

   **Appearance**
   - **Height** – container height (e.g. `600px`, `80vh`, `100%`). Default `600px`.
   - **Dark Mode** – enable the dark theme.

   **Behavior** (all off by default)
   - **Show Thumbnail Sidebar**, **Enable Search**, **Enable Download**, **Enable Print**, **Enable Import (Upload)**, **Enable Copy All Text**, **Enable Rotate**, **Enable Fit to Page**.

Common scenarios:
- **Base64 PDF** – set **PDF String** to an expression returning your base64 content and enable the toolbar buttons you need.
- **URL PDF** – set **PDF String** to an `https://...` link; it is fetched, rendered, and cached for offline use.
- **Upload** – enable **Import (Upload)** so users can pick or drag-and-drop a local PDF.

## Demo project

_Coming soon._

## Issues, suggestions and feature requests

Please report issues and feature requests on GitHub:
https://github.com/felixrajavictor/PDFViewer/issues

## Development and contribution

1. Install NPM package dependencies by using: `npm install`. If you use NPM v7.x.x, which can be checked by executing `npm -v`, execute: `npm install --legacy-peer-deps`.
1. Run `npm start` to watch for code changes. On every change:
    - the widget will be bundled;
    - the bundle will be included in a `dist` folder in the root directory of the project;
    - the bundle will be included in the `deployment` and `widgets` folder of the Mendix test project.

Build a release `.mpk` with `npm run release`. The `prebuild`/`prerelease` steps run `scripts/generate-pdfjs-ts.js`, which inlines the PDF.js library and worker into the widget bundle.

## License

Apache-2.0. PDF rendering powered by [PDF.js](https://mozilla.github.io/pdf.js/) by Mozilla.
