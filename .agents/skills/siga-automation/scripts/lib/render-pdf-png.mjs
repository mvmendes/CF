import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Canvas } from "@napi-rs/canvas";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, "../..");

const MAX_CANVAS_PIXELS = 100_000_000;

/**
 * Fábrica de canvas compatível com pdf.js (igual em espírito a pdfjs examples para Node).
 */
class NodeCanvasFactory {
  create(width, height) {
    if (!(width > 0 && height > 0)) {
      throw new Error("Largura e altura do canvas devem ser > 0");
    }
    const canvas = new Canvas(width, height);
    return {
      canvas,
      context: canvas.getContext("2d"),
    };
  }
  reset(canvasAndContext, width, height) {
    if (!canvasAndContext.canvas) {
      throw new Error("Canvas obrigatório");
    }
    if (!(width > 0 && height > 0)) {
      throw new Error("Largura e altura do canvas devem ser > 0");
    }
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
    canvasAndContext.context = canvasAndContext.canvas.getContext("2d");
  }
  destroy(canvasAndContext) {
    if (!canvasAndContext.canvas) {
      throw new Error("Canvas obrigatório");
    }
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

/**
 * pdfjs 5 exige cMapUrl e standardFontDataUrl com barra final (carácter /) no URL;
 * em Windows, caminhos de ficheiro com barra invertida falham a validação.
 */
function pdfjsFactoryUrlForDir(absoluteDir) {
  const { href } = pathToFileURL(absoluteDir);
  if (href.endsWith("/")) {
    return href;
  }
  return `${href}/`;
}

/**
 * Gera uma pasta com um PNG por página, só com Node (pdfjs + @napi-rs/canvas; binários
 * pré-compilados para as plataformas comuns, sem Python).
 */
export async function renderPdfToPng(pdfPath, outDir, options = {}) {
  const { viewportScale = 2 } = options;
  const absPdf = path.resolve(pdfPath);
  const buffer = await fs.readFile(absPdf);
  const data = new Uint8Array(buffer);

  const stem = path.basename(absPdf, path.extname(absPdf));
  const out = outDir
    ? path.resolve(outDir)
    : path.join(path.dirname(absPdf), ".pdf-render", stem);
  await fs.mkdir(out, { recursive: true });

  const cmapsDir = path.join(SKILL_ROOT, "node_modules", "pdfjs-dist", "cmaps");
  const stdFontsDir = path.join(SKILL_ROOT, "node_modules", "pdfjs-dist", "standard_fonts");
  const cMapUrl = pdfjsFactoryUrlForDir(cmapsDir);
  const standardFontDataUrl = pdfjsFactoryUrlForDir(stdFontsDir);

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data,
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: true,
  });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const canvasFactory = new NodeCanvasFactory();
  const files = [];

  for (let pageIndex = 1; pageIndex <= numPages; pageIndex++) {
    const page = await pdf.getPage(pageIndex);
    const viewport = page.getViewport({ scale: viewportScale });
    if (viewport.width * viewport.height > MAX_CANVAS_PIXELS) {
      page.cleanup();
      throw new Error(
        `Página ${pageIndex}: ${Math.round(viewport.width)}×${Math.round(viewport.height)} px excede o limite. Reduza viewportScale.`
      );
    }
    const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);
    try {
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      const name = `${stem}_page_${pageIndex}.png`;
      const filePath = path.join(out, name);
      await fs.writeFile(filePath, canvas.toBuffer("image/png"));
      files.push(filePath);
    } finally {
      page.cleanup();
      canvasFactory.destroy({ canvas, context });
    }
  }

  await pdf.destroy();
  return {
    success: true,
    pdfPath: absPdf,
    outputFolder: out,
    pageCount: numPages,
    files,
  };
}
