export type ToolMode = 'text' | 'tick';

export type InkColor = 'black' | 'blue';

export interface TextAnnotation {
  id: string;
  type: 'text';
  pageIndex: number;
  /** Horizontal position as fraction (0..1) of page width */
  xPct: number;
  /** Vertical position as fraction (0..1) of page height */
  yPct: number;
  text: string;
  /** Font size in PDF points (1 pt = 1/72 inch) */
  fontSize: number;
  color: InkColor;
}

export interface TickAnnotation {
  id: string;
  type: 'tick';
  pageIndex: number;
  /** Center X as fraction (0..1) of page width */
  xPct: number;
  /** Center Y as fraction (0..1) of page height */
  yPct: number;
  /** Size in PDF points */
  size: number;
  color: InkColor;
}

export interface SignatureAnnotation {
  id: string;
  type: 'signature';
  pageIndex: number;
  /** Center X as fraction (0..1) of page width */
  xPct: number;
  /** Center Y as fraction (0..1) of page height */
  yPct: number;
  /** Width as fraction (0..1) of page width */
  widthPct: number;
  /** Natural image height / width */
  aspectRatio: number;
  dataUrl: string;
}

export type PdfAnnotation = TextAnnotation | TickAnnotation | SignatureAnnotation;
