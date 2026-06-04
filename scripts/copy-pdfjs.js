/**
 * copy-pdfjs.js
 *
 * Injects pdf.min.js and pdf.worker.min.js from the pdfjs-dist package
 * into the compiled .mpk (ZIP) file so they are deployed by Mendix and
 * served at:
 *   /widgets/mxtechies/viewerpdf/pdf.min.js
 *   /widgets/mxtechies/viewerpdf/pdf.worker.min.js
 *
 * This makes the widget fully offline-capable from the very first deployment
 * — no CDN, no internet required.
 *
 * Run automatically via:
 *   npm run build
 *   npm run release
 */

const fs      = require("fs");
const path    = require("path");
const AdmZip  = require("adm-zip");

const ROOT      = path.join(__dirname, "..");
const PDFJS_SRC = path.join(ROOT, "node_modules", "pdfjs-dist", "build");

// The folder path inside the .mpk where Mendix serves widget static files.
// This maps to the URL: /widgets/mxtechies/viewerpdf/
const ZIP_FOLDER = "mxtechies/viewerpdf";

const FILES = ["pdf.min.js", "pdf.worker.min.js"];

function findMpk() {
    // Build output locations used by pluggable-widgets-tools
    const candidates = [
        path.join(ROOT, "dist", "1.0.0"),
        path.join(ROOT, "dist"),
    ];

    for (const dir of candidates) {
        if (!fs.existsSync(dir)) continue;
        const found = fs.readdirSync(dir).find(f => f.endsWith(".mpk"));
        if (found) return path.join(dir, found);
    }
    return null;
}

function run() {
    // ── Verify pdfjs-dist is installed ─────────────────────────────────────
    if (!fs.existsSync(PDFJS_SRC)) {
        console.error(
            "\n[copy-pdfjs] ERROR: pdfjs-dist not found in node_modules.\n" +
            "  Run: npm install\n"
        );
        process.exit(1);
    }

    // ── Find the .mpk file ─────────────────────────────────────────────────
    const mpkPath = findMpk();
    if (!mpkPath) {
        console.error(
            "\n[copy-pdfjs] ERROR: No .mpk file found in dist/.\n" +
            "  Make sure 'pluggable-widgets-tools build:web' ran first.\n"
        );
        process.exit(1);
    }

    console.log(`[copy-pdfjs] Patching: ${path.relative(ROOT, mpkPath)}`);

    // ── Open the .mpk (ZIP) and add PDF.js files ───────────────────────────
    const zip = new AdmZip(mpkPath);

    for (const file of FILES) {
        const src = path.join(PDFJS_SRC, file);

        if (!fs.existsSync(src)) {
            console.error(`[copy-pdfjs] ERROR: source not found: ${src}`);
            process.exit(1);
        }

        const content  = fs.readFileSync(src);
        const zipEntry = `${ZIP_FOLDER}/${file}`;

        // Remove existing entry if present (from a previous run)
        try { zip.deleteFile(zipEntry); } catch { /* not present — that's fine */ }

        zip.addFile(zipEntry, content);

        const kb = Math.round(content.length / 1024);
        console.log(`[copy-pdfjs] ✓  ${file}  (${kb} KB)  →  ${zipEntry}`);
    }

    // ── Save the patched .mpk ──────────────────────────────────────────────
    zip.writeZip(mpkPath);
    console.log(`[copy-pdfjs] .mpk updated successfully.\n`);
}

run();
