// Page rendering for the Phase 2 enrichment pass. Turns a source document into
// the handful of base64 images the Claude call reads, at a fixed resolution so
// token cost is uniform and predictable (see PLAN.md / the enrichment plan).
//
// The whole cost lever of the enrichment pass lives here: we render only the
// first min(maxPages, pageCount) pages of a PDF to images rather than sending
// the PDF as a document block (which would bill every page). Native images are
// downscaled to the same long-edge cap so a photo costs the same as a page.
//
// Side effects (spawning pdfinfo/pdftoppm/magick, scratch files) are isolated to
// this module; fail loud and name the file, per CLAUDE.md.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

export type ImageMediaType = "image/png" | "image/jpeg";

export interface RenderedImage {
  data: string; // base64
  mediaType: ImageMediaType;
}

export interface RenderResult {
  images: RenderedImage[];
  pagesSent: number; // = min(maxPages, pageCount)
  pageCount: number; // total pages in the source (1 for a native image)
}

export interface RenderOptions {
  renderPx?: number; // long-edge pixel cap; default 1568 (~2.5k image tokens/page, measured)
  maxPages?: number; // most pages to render from a PDF; default 3
  jpegQuality?: number; // default 88 (enrichment); the web asset pass uses less
}

const DEFAULT_RENDER_PX = 1568;
const DEFAULT_MAX_PAGES = 3;
// Encode rendered pages as high-quality JPEG rather than lossless PNG. Image token
// cost is set by pixel dimensions, not file format, so this is cost-neutral — but
// it shrinks the base64 payload ~10x (lossless PNG of a 1568px scan is multiple MB),
// which keeps a full-corpus batch under the Message Batches API's 256MB request cap.
// q88 preserves text legibility and redaction bars for the read-the-document fields.
const JPEG_QUALITY = 88;

const IMAGE_EXTS: Record<string, ImageMediaType> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

// Total page count of a document. PDFs are read via `pdfinfo` (fast, local,
// free); native images are a single "page". Fails loud if the file is missing
// or pdfinfo can't report a page count.
export function pageCount(mediaPath: string): number {
  if (!existsSync(mediaPath)) {
    throw new Error(`ingest/render: source file not found: ${mediaPath}`);
  }
  if (extname(mediaPath).toLowerCase() !== ".pdf") return 1;
  const out = execFileSync("pdfinfo", [mediaPath], { encoding: "utf8" });
  const m = /^Pages:\s+(\d+)/m.exec(out);
  if (!m) {
    throw new Error(`ingest/render: pdfinfo reported no page count for ${mediaPath}`);
  }
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`ingest/render: implausible page count ${m[1]} for ${mediaPath}`);
  }
  return n;
}

// Render the first min(maxPages, pageCount) pages of a document to base64 image
// blocks. PDFs go through pdftoppm at a fixed long-edge resolution; native
// images are downscaled (shrink-only) to the same cap so their token cost lines
// up with a rendered page. Never upscales. Scratch files are cleaned up.
export function renderDocToImages(mediaPath: string, opts: RenderOptions = {}): RenderResult {
  const renderPx = opts.renderPx ?? DEFAULT_RENDER_PX;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const jpegQuality = opts.jpegQuality ?? JPEG_QUALITY;
  const ext = extname(mediaPath).toLowerCase();

  if (ext === ".pdf") {
    const total = pageCount(mediaPath);
    const pagesSent = Math.min(maxPages, total);
    const scratch = mkdtempSync(join(tmpdir(), "uap-render-"));
    try {
      execFileSync("pdftoppm", [
        "-jpeg",
        "-jpegopt",
        `quality=${jpegQuality}`,
        "-f",
        "1",
        "-l",
        String(pagesSent),
        "-scale-to",
        String(renderPx),
        mediaPath,
        join(scratch, "page"),
      ]);
      // pdftoppm names outputs page-<n>.jpg; sort by that trailing page number
      // rather than lexically (page-10 must not sort before page-2).
      const jpgs = readdirSync(scratch)
        .map((name) => ({ name, page: Number(/-(\d+)\.jpg$/.exec(name)?.[1] ?? NaN) }))
        .filter((f) => Number.isInteger(f.page))
        .sort((a, b) => a.page - b.page);
      if (jpgs.length === 0) {
        throw new Error(`ingest/render: pdftoppm produced no pages for ${mediaPath}`);
      }
      const images: RenderedImage[] = jpgs.map((f) => ({
        data: readFileSync(join(scratch, f.name)).toString("base64"),
        mediaType: "image/jpeg",
      }));
      return { images, pagesSent: images.length, pageCount: total };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  const mediaType = IMAGE_EXTS[ext];
  if (!mediaType) {
    throw new Error(`ingest/render: unsupported media type ${ext} for ${basename(mediaPath)}`);
  }
  if (!existsSync(mediaPath)) {
    throw new Error(`ingest/render: source file not found: ${mediaPath}`);
  }
  // Force the input coder to the extension's real format and feed the bytes on
  // stdin — never hand the path to ImageMagick. This prevents content-sniffing from
  // routing a mislabeled bundle file (e.g. PostScript/SVG bytes named .png) to a
  // scripting/delegate coder (the ImageTragick surface): a non-PNG/JPEG masquerading
  // as one now fails to decode instead of being executed. Shrink-only ('>'); output
  // is re-encoded to JPEG (see JPEG_QUALITY) to keep the payload small and uniform.
  const inputCoder = mediaType === "image/png" ? "png" : "jpg";
  const buf = execFileSync(
    "magick",
    [
      `${inputCoder}:-`,
      "-resize",
      `${renderPx}x${renderPx}>`,
      "-quality",
      String(jpegQuality),
      "jpg:-",
    ],
    { input: readFileSync(mediaPath), maxBuffer: 64 * 1024 * 1024 },
  );
  return {
    images: [{ data: buf.toString("base64"), mediaType: "image/jpeg" }],
    pagesSent: 1,
    pageCount: 1,
  };
}
