import { LineCapStyle, PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { InkColor, PdfAnnotation } from '../types/pdf';

function getInkRgb(color: InkColor) {
  if (color === 'blue') {
    return rgb(0.114, 0.306, 0.847); // #1D4ED8
  }
  return rgb(0.06, 0.09, 0.16); // Crisp deep ink
}

/**
 * WinAnsi encoding used by StandardFonts.Helvetica supports Latin-1 / Windows-1252.
 * Replace unsupported Unicode characters (like emojis) so PDF export never crashes.
 */
function sanitizeWinAnsiText(input: string): string {
  return input
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '--')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, ' ');
}

/**
 * Generates a real, clean 1-page sample PDF form in memory so users can test
 * typing, ticks, signatures, and downloading immediately.
 */
export async function createSamplePdf(): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // US Letter
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const blue = rgb(0.114, 0.306, 0.847);
  const lightBlue = rgb(0.93, 0.96, 1);
  const borderBlue = rgb(0.75, 0.85, 0.98);
  const darkText = rgb(0.08, 0.12, 0.22);
  const mutedText = rgb(0.35, 0.42, 0.55);

  // Header banner
  page.drawRectangle({
    x: 42,
    y: 696,
    width: 528,
    height: 58,
    color: lightBlue,
    borderColor: borderBlue,
    borderWidth: 1,
  });

  page.drawText('SIMPLE APPLICATION FORM', {
    x: 60,
    y: 726,
    size: 18,
    font: fontBold,
    color: blue,
  });

  page.drawText('Tap any line below to type, add checkmarks, and sign at the bottom.', {
    x: 60,
    y: 707,
    size: 10.5,
    font: fontRegular,
    color: mutedText,
  });

  // Form fields
  const drawField = (label: string, yTop: number, width = 528, xLeft = 42) => {
    page.drawText(label, {
      x: xLeft,
      y: yTop,
      size: 11,
      font: fontBold,
      color: darkText,
    });
    page.drawRectangle({
      x: xLeft,
      y: yTop - 38,
      width,
      height: 30,
      borderColor: borderBlue,
      borderWidth: 1.2,
      color: rgb(1, 1, 1),
    });
  };

  drawField('Full Name', 652);
  drawField('Email Address', 582, 310, 42);
  drawField('Phone Number', 582, 200, 370);
  drawField('Street Address', 512);
  drawField('City & Postal Code', 442, 310, 42);
  drawField('Date', 442, 200, 370);

  // Checkboxes section
  page.drawText('Select Options (use Tick button)', {
    x: 42,
    y: 368,
    size: 11,
    font: fontBold,
    color: darkText,
  });

  const drawCheckbox = (label: string, y: number) => {
    page.drawRectangle({
      x: 42,
      y: y - 4,
      width: 20,
      height: 20,
      borderColor: blue,
      borderWidth: 1.5,
      color: rgb(1, 1, 1),
    });
    page.drawText(label, {
      x: 74,
      y: y + 1,
      size: 11.5,
      font: fontRegular,
      color: darkText,
    });
  };

  drawCheckbox('I confirm that all information provided above is accurate.', 332);
  drawCheckbox('Send me a copy of this completed form by email.', 296);
  drawCheckbox('I agree to the standard terms and privacy notice.', 260);

  // Notes box
  page.drawText('Additional Notes', {
    x: 42,
    y: 214,
    size: 11,
    font: fontBold,
    color: darkText,
  });
  page.drawRectangle({
    x: 42,
    y: 136,
    width: 528,
    height: 70,
    borderColor: borderBlue,
    borderWidth: 1.2,
    color: rgb(1, 1, 1),
  });

  // Signature area
  page.drawText('Signature (use Sign button)', {
    x: 42,
    y: 102,
    size: 11,
    font: fontBold,
    color: darkText,
  });
  page.drawRectangle({
    x: 42,
    y: 40,
    width: 340,
    height: 54,
    borderColor: borderBlue,
    borderWidth: 1.2,
    color: lightBlue,
  });
  page.drawLine({
    start: { x: 56, y: 54 },
    end: { x: 368, y: 54 },
    thickness: 1,
    color: borderBlue,
  });

  page.drawText('Date Signed', {
    x: 400,
    y: 102,
    size: 11,
    font: fontBold,
    color: darkText,
  });
  page.drawRectangle({
    x: 400,
    y: 40,
    width: 170,
    height: 54,
    borderColor: borderBlue,
    borderWidth: 1.2,
    color: rgb(1, 1, 1),
  });

  return pdfDoc.save();
}

export async function exportFilledPdf(
  originalBytes: Uint8Array,
  annotations: PdfAnnotation[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalBytes, {
    ignoreEncryption: true,
  });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  // Cache embedded PNGs if the same signature is placed multiple times
  const pngCache = new Map<string, Awaited<ReturnType<typeof pdfDoc.embedPng>>>();

  for (const ann of annotations) {
    const page = pages[ann.pageIndex];
    if (!page) continue;

    const { width: pageWidth, height: pageHeight } = page.getSize();

    if (ann.type === 'text') {
      const clean = sanitizeWinAnsiText(ann.text).trimEnd();
      if (!clean) continue;

      const lines = clean.split('\n');
      const lineHeight = ann.fontSize * 1.25;
      const startX = ann.xPct * pageWidth;
      // Top-left Y converted to PDF bottom-left baseline
      const topYFromBottom = pageHeight * (1 - ann.yPct);

      lines.forEach((line, idx) => {
        if (!line) return;
        const baselineY = topYFromBottom - ann.fontSize * 0.88 - idx * lineHeight;
        page.drawText(line, {
          x: Math.max(4, Math.min(pageWidth - 10, startX)),
          y: Math.max(4, Math.min(pageHeight - ann.fontSize, baselineY)),
          size: ann.fontSize,
          font,
          color: getInkRgb(ann.color),
        });
      });
    } else if (ann.type === 'tick') {
      const cx = ann.xPct * pageWidth;
      const cy = pageHeight * (1 - ann.yPct);
      const half = ann.size * 0.42;
      const strokeColor = getInkRgb(ann.color);
      const thickness = Math.max(1.8, ann.size * 0.13);

      // Left downward stroke of checkmark
      page.drawLine({
        start: { x: cx - half * 0.85, y: cy + half * 0.02 },
        end: { x: cx - half * 0.18, y: cy - half * 0.65 },
        thickness,
        color: strokeColor,
        lineCap: LineCapStyle.Round,
      });

      // Right upward stroke of checkmark
      page.drawLine({
        start: { x: cx - half * 0.18, y: cy - half * 0.65 },
        end: { x: cx + half * 0.9, y: cy + half * 0.72 },
        thickness,
        color: strokeColor,
        lineCap: LineCapStyle.Round,
      });
    } else if (ann.type === 'signature') {
      let pngImage = pngCache.get(ann.dataUrl);
      if (!pngImage) {
        const res = await fetch(ann.dataUrl);
        const arrayBuf = await res.arrayBuffer();
        pngImage = await pdfDoc.embedPng(arrayBuf);
        pngCache.set(ann.dataUrl, pngImage);
      }

      const sigWidth = ann.widthPct * pageWidth;
      const sigHeight = sigWidth * ann.aspectRatio;
      const x = ann.xPct * pageWidth - sigWidth / 2;
      const y = pageHeight * (1 - ann.yPct) - sigHeight / 2;

      page.drawImage(pngImage, {
        x,
        y,
        width: sigWidth,
        height: sigHeight,
      });
    }
  }

  return pdfDoc.save();
}
