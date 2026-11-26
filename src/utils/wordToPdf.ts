import { renderAsync } from 'docx-preview';
import html2canvas from 'html2canvas-pro';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as CFB from 'cfb';

function isZipHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function isOleHeader(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  );
}

function isRtfHeader(bytes: Uint8Array): boolean {
  const head = new TextDecoder('ascii', { fatal: false }).decode(bytes.subarray(0, 16));
  return head.trimStart().startsWith('{\\rtf');
}

function isHtmlContent(bytes: Uint8Array): boolean {
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, 256))
    .trimStart()
    .toLowerCase();
  return (
    head.startsWith('<!doctype') ||
    head.startsWith('<html') ||
    head.startsWith('<meta') ||
    (head.startsWith('<?xml') && head.includes('<html'))
  );
}

function sanitizeForPdfFont(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '--')
    .replace(/\u2022/g, '*')
    .replace(/\u2610/g, '[ ]')
    .replace(/\u2611|\u2612/g, '[x]')
    .replace(/\t/g, '    ')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, ' ');
}

function wrapTextLines(
  text: string,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  fontSize: number,
  maxWidth: number
): string[] {
  const paragraphs = sanitizeForPdfFont(text).split(/\r?\n/);
  const result: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trimEnd();
    if (!trimmed) {
      result.push('');
      continue;
    }

    const words = trimmed.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        currentLine = candidate;
      } else {
        if (currentLine) {
          result.push(currentLine);
          currentLine = '';
        }
        // Handle single very long words
        if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
          let chunk = '';
          for (const ch of word) {
            if (font.widthOfTextAtSize(chunk + ch, fontSize) <= maxWidth) {
              chunk += ch;
            } else {
              if (chunk) result.push(chunk);
              chunk = ch;
            }
          }
          currentLine = chunk;
        } else {
          currentLine = word;
        }
      }
    }
    if (currentLine) {
      result.push(currentLine);
    }
  }

  return result;
}

async function renderTextToPdf(text: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pageWidth = 595.28; // A4
  const pageHeight = 841.89;
  const marginX = 48;
  const marginY = 52;
  const fontSize = 11.5;
  const lineHeight = 16.5;
  const maxWidth = pageWidth - marginX * 2;

  const lines = wrapTextLines(text, font, fontSize, maxWidth);
  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - marginY;

  for (const line of lines) {
    if (y < marginY + lineHeight) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - marginY;
    }
    if (line.length > 0) {
      page.drawText(line, {
        x: marginX,
        y,
        size: fontSize,
        font,
        color: rgb(0.08, 0.12, 0.2),
      });
    }
    y -= lineHeight;
  }

  return pdfDoc.save();
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to render page image'));
        return;
      }
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
    }, 'image/png');
  });
}

async function waitForImages(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll('img'));
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        })
    )
  );
}

async function renderHtmlContainerToPdf(
  container: HTMLElement,
  sections: HTMLElement[]
): Promise<Uint8Array> {
  await waitForImages(container);
  const pdfDoc = await PDFDocument.create();

  for (const section of sections) {
    const rect = section.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) continue;

    const canvas = await html2canvas(section, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    });

    const pngBytes = await canvasToPngBytes(canvas);
    const pngImage = await pdfDoc.embedPng(pngBytes);

    const pageWidthPt = 595.28; // A4 width
    const pageHeightPt = Math.max(200, pageWidthPt * (canvas.height / canvas.width));
    const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);

    page.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: pageWidthPt,
      height: pageHeightPt,
    });
  }

  if (pdfDoc.getPageCount() === 0) {
    throw new Error('No pages rendered from Word document');
  }

  return pdfDoc.save();
}

async function renderCleanHtmlToPdf(html: string): Promise<Uint8Array> {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-12000px';
  host.style.top = '0';
  host.style.width = '794px';
  host.style.backgroundColor = '#ffffff';
  host.style.color = '#0f172a';
  host.style.fontFamily = 'Arial, Helvetica, sans-serif';
  host.style.fontSize = '14px';
  host.style.lineHeight = '1.5';
  host.style.padding = '48px';
  host.style.boxSizing = 'border-box';
  host.style.pointerEvents = 'none';

  // Build isolated styled content
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .word-fallback-root h1 { font-size: 22px; font-weight: 700; margin: 0 0 12px 0; color: #0f172a; }
    .word-fallback-root h2 { font-size: 18px; font-weight: 700; margin: 16px 0 8px 0; color: #0f172a; }
    .word-fallback-root h3 { font-size: 15px; font-weight: 700; margin: 12px 0 6px 0; color: #0f172a; }
    .word-fallback-root p { margin: 0 0 10px 0; }
    .word-fallback-root table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    .word-fallback-root td, .word-fallback-root th { border: 1px solid #94a3b8; padding: 6px 8px; text-align: left; vertical-align: top; }
    .word-fallback-root ul, .word-fallback-root ol { margin: 0 0 10px 20px; }
    .word-fallback-root img { max-width: 100%; height: auto; }
  `;

  const content = document.createElement('div');
  content.className = 'word-fallback-root';
  content.innerHTML = html;

  host.appendChild(styleEl);
  host.appendChild(content);
  document.body.appendChild(host);

  try {
    await waitForImages(host);
    const canvas = await html2canvas(host, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    });

    const pdfDoc = await PDFDocument.create();
    const a4WidthPt = 595.28;
    const a4HeightPt = 841.89;
    const sliceHeightPx = Math.floor(canvas.width * (a4HeightPt / a4WidthPt));

    let offsetY = 0;
    while (offsetY < canvas.height) {
      const currentSliceH = Math.min(sliceHeightPx, canvas.height - offsetY);
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = sliceHeightPx;
      const ctx = sliceCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(
          canvas,
          0,
          offsetY,
          canvas.width,
          currentSliceH,
          0,
          0,
          canvas.width,
          currentSliceH
        );
      }

      const pngBytes = await canvasToPngBytes(sliceCanvas);
      const pngImage = await pdfDoc.embedPng(pngBytes);
      const page = pdfDoc.addPage([a4WidthPt, a4HeightPt]);
      page.drawImage(pngImage, {
        x: 0,
        y: 0,
        width: a4WidthPt,
        height: a4HeightPt,
      });

      offsetY += sliceHeightPx;
    }

    return pdfDoc.save();
  } finally {
    document.body.removeChild(host);
  }
}

async function convertDocxToPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const arrayBuffer = bytes.slice().buffer;
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-12000px';
  host.style.top = '0';
  host.style.width = '900px';
  host.style.backgroundColor = '#ffffff';
  host.style.pointerEvents = 'none';
  document.body.appendChild(host);

  try {
    await renderAsync(arrayBuffer, host, undefined, {
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      breakPages: true,
      ignoreLastRenderedPageBreak: false,
      useBase64URL: true,
    });

    const sections = Array.from(host.querySelectorAll('section.docx')) as HTMLElement[];
    if (sections.length > 0) {
      return await renderHtmlContainerToPdf(host, sections);
    }
  } catch {
    // Fall back cleanly to mammoth if docx-preview fails on a non-standard docx
  } finally {
    document.body.removeChild(host);
  }

  // Fallback: mammoth HTML -> paginated PDF
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes.slice().buffer });
  if (result.value && result.value.trim().length > 0) {
    return renderCleanHtmlToPdf(result.value);
  }

  const rawText = await mammoth.extractRawText({ arrayBuffer: bytes.slice().buffer });
  return renderTextToPdf(rawText.value || 'Empty Word document');
}

function extractReadableRunsFromLegacyDoc(wordBytes: Uint8Array): string {
  // Check MS-DOC FIB fcMin / fcMac at offsets 24 and 28 when Word signature 0xA5EC matches
  let slice = wordBytes;
  if (wordBytes.length > 64) {
    const view = new DataView(wordBytes.buffer, wordBytes.byteOffset, wordBytes.byteLength);
    const wIdent = view.getUint16(0, true);
    if (wIdent === 0xa5ec) {
      const fcMin = view.getUint32(24, true);
      const fcMac = view.getUint32(28, true);
      if (fcMin > 0 && fcMac > fcMin && fcMac <= wordBytes.length) {
        slice = wordBytes.subarray(fcMin, fcMac);
      }
    }
  }

  // Try extracting UTF-16LE runs and ASCII/Windows-1252 runs
  const chunks: string[] = [];

  // Heuristic: check if UTF-16LE dominates (every second byte is 0x00 for Latin text)
  let zeroHighBytes = 0;
  const sampleLen = Math.min(slice.length, 400);
  for (let i = 1; i < sampleLen; i += 2) {
    if (slice[i] === 0) zeroHighBytes++;
  }

  if (zeroHighBytes > sampleLen * 0.25) {
    const decoded = new TextDecoder('utf-16le', { fatal: false }).decode(slice);
    const cleaned = decoded
      .replace(/\r/g, '\n')
      .replace(/\x07/g, '  ')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');
    chunks.push(cleaned);
  } else {
    let current = '';
    for (let i = 0; i < slice.length; i++) {
      const b = slice[i];
      if (b === 0x0d || b === 0x0a) {
        if (current.trim().length >= 2) {
          chunks.push(current.trim());
        }
        current = '';
      } else if (b === 0x07 || b === 0x09) {
        current += '  ';
      } else if (b >= 0x20 && b <= 0x7e) {
        current += String.fromCharCode(b);
      } else if (b >= 0xa0) {
        current += String.fromCharCode(b);
      } else if (current.length > 0) {
        if (current.trim().length >= 4) {
          chunks.push(current.trim());
        }
        current = '';
      }
    }
    if (current.trim().length >= 2) {
      chunks.push(current.trim());
    }
  }

  const combined = chunks
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return combined;
}

function stripRtfToText(rtf: string): string {
  return rtf
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\tab/g, '    ')
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\{\\\*[^}]*\}/g, '')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function convertLegacyDocToPdf(bytes: Uint8Array): Promise<Uint8Array> {
  if (isHtmlContent(bytes)) {
    const htmlStr = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const parser = new DOMParser();
    const parsed = parser.parseFromString(htmlStr, 'text/html');
    const bodyHtml = parsed.body?.innerHTML?.trim() || htmlStr;
    return renderCleanHtmlToPdf(bodyHtml);
  }

  if (isRtfHeader(bytes)) {
    const rtfText = new TextDecoder('latin1', { fatal: false }).decode(bytes);
    const plain = stripRtfToText(rtfText);
    return renderTextToPdf(plain || 'Empty Word document');
  }

  if (isOleHeader(bytes)) {
    const container = CFB.read(bytes, { type: 'array' });
    const wordEntry = CFB.find(container, 'WordDocument');
    if (wordEntry && wordEntry.content) {
      const streamBytes =
        wordEntry.content instanceof Uint8Array
          ? wordEntry.content
          : new Uint8Array(wordEntry.content);
      const extracted = extractReadableRunsFromLegacyDoc(streamBytes);
      if (extracted.length > 0) {
        return renderTextToPdf(extracted);
      }
    }
  }

  // Plain-text .doc fallback
  const fallbackText = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
    .trim();
  if (fallbackText.length > 0) {
    return renderTextToPdf(fallbackText);
  }

  throw new Error('Could not read this .doc file. Please save it as .docx or .pdf and try again.');
}

export async function convertWordBytesToPdf(
  bytes: Uint8Array
): Promise<Uint8Array> {
  if (isZipHeader(bytes)) {
    return convertDocxToPdf(bytes);
  }
  return convertLegacyDocToPdf(bytes);
}

/**
 * Creates a real, valid .docx Word form in memory so users can test
 * opening a Word document (W icon) and converting it to PDF inside the app.
 */
export async function createSampleWordDocx(): Promise<Uint8Array> {
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );

  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:spacing w:after="160"/></w:pPr>
      <w:r>
        <w:rPr><w:b/><w:color w:val="1D4ED8"/><w:sz w:val="36"/></w:rPr>
        <w:t>WORD REGISTRATION FORM</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:pPr><w:spacing w:after="240"/></w:pPr>
      <w:r>
        <w:rPr><w:color w:val="475569"/><w:sz w:val="22"/></w:rPr>
        <w:t>Tap on any blank box below to type, add checkmarks, and sign.</w:t>
      </w:r>
    </w:p>
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="9000" w:type="dxa"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="6" w:color="93C5FD"/>
          <w:left w:val="single" w:sz="6" w:color="93C5FD"/>
          <w:bottom w:val="single" w:sz="6" w:color="93C5FD"/>
          <w:right w:val="single" w:sz="6" w:color="93C5FD"/>
          <w:insideH w:val="single" w:sz="6" w:color="93C5FD"/>
          <w:insideV w:val="single" w:sz="6" w:color="93C5FD"/>
        </w:tblBorders>
      </w:tblPr>
      <w:tr>
        <w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Full Name</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>                                        </w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Phone Number</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>                                        </w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Email Address</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>                                        </w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Date</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>                                        </w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:p><w:pPr><w:spacing w:before="280" w:after="120"/></w:pPr>
      <w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>Confirmation Checkboxes</w:t></w:r>
    </w:p>
    <w:p><w:pPr><w:spacing w:after="120"/></w:pPr>
      <w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>[  ]  I confirm my contact details are correct.</w:t></w:r>
    </w:p>
    <w:p><w:pPr><w:spacing w:after="280"/></w:pPr>
      <w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>[  ]  I agree to receive updates about this form.</w:t></w:r>
    </w:p>
    <w:p><w:pPr><w:spacing w:before="240" w:after="100"/></w:pPr>
      <w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>Signature:</w:t></w:r>
    </w:p>
    <w:p><w:pPr><w:spacing w:after="120"/></w:pPr>
      <w:r><w:rPr><w:color w:val="94A3B8"/></w:rPr><w:t>____________________________________________</w:t></w:r>
    </w:p>
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/>
    </w:sectPr>
  </w:body>
</w:document>`
  );

  return zip.generateAsync({ type: 'uint8array' });
}
