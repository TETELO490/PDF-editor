import { jsPDF } from 'jspdf';

/**
 * Converts YAML file text into a formatted multi-page PDF using jsPDF.
 */
export function convertYamlTextToPdf(yamlText: string, fileName = 'document.yaml'): Uint8Array {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 40;
  const marginTop = 48;
  const marginBottom = 44;
  const usableWidth = pageWidth - marginX * 2;
  const lineHeight = 14.5;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(29, 78, 216); // Blue
  doc.text(fileName, marginX, marginTop);

  doc.setDrawColor(191, 219, 254);
  doc.setLineWidth(1);
  doc.line(marginX, marginTop + 10, pageWidth - marginX, marginTop + 10);

  // Body YAML text in monospace so indentation aligns cleanly
  doc.setFont('courier', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);

  let y = marginTop + 30;
  const normalized = yamlText.replace(/\t/g, '  ').replace(/\r\n/g, '\n');
  const rawLines = normalized.split('\n');

  for (const rawLine of rawLines) {
    if (rawLine.length === 0) {
      y += lineHeight;
      if (y > pageHeight - marginBottom) {
        doc.addPage();
        y = marginTop;
      }
      continue;
    }

    const wrappedLines = doc.splitTextToSize(rawLine, usableWidth) as string[];
    for (const segment of wrappedLines) {
      if (y > pageHeight - marginBottom) {
        doc.addPage();
        y = marginTop;
      }
      doc.text(segment, marginX, y);
      y += lineHeight;
    }
  }

  const buffer = doc.output('arraybuffer');
  return new Uint8Array(buffer);
}
