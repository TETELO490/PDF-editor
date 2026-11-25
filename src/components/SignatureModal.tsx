import React, { useEffect, useRef, useState } from 'react';
import { Check, Eraser, RotateCcw, X } from 'lucide-react';
import type { InkColor } from '../types/pdf';

interface SignatureModalProps {
  isOpen: boolean;
  savedSignature: { dataUrl: string; aspectRatio: number } | null;
  onClose: () => void;
  onConfirm: (dataUrl: string, aspectRatio: number) => void;
}

interface Point {
  x: number;
  y: number;
}

export const SignatureModal: React.FC<SignatureModalProps> = ({
  isOpen,
  savedSignature,
  onClose,
  onConfirm,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDrawingRef = useRef(false);
  const pointsRef = useRef<Point[]>([]);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [inkColor, setInkColor] = useState<InkColor>('blue');

  const inkHex = inkColor === 'blue' ? '#1D4ED8' : '#0F172A';

  useEffect(() => {
    if (!isOpen) return;
    setHasStrokes(false);
    pointsRef.current = [];

    const setupCanvas = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = inkHex;
      }
    };

    const raf = requestAnimationFrame(setupCanvas);
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.strokeStyle = inkHex;
    }
  }, [inkHex]);

  if (!isOpen) return null;

  const getLocalPoint = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getLocalPoint(e);
    isDrawingRef.current = true;
    pointsRef.current = [pt];
    setHasStrokes(true);

    const ctx = e.currentTarget.getContext('2d');
    if (ctx) {
      ctx.strokeStyle = inkHex;
      ctx.fillStyle = inkHex;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    const pt = getLocalPoint(e);
    const pts = pointsRef.current;
    pts.push(pt);

    const ctx = e.currentTarget.getContext('2d');
    if (!ctx || pts.length < 2) return;

    ctx.strokeStyle = inkHex;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (pts.length === 2) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.stroke();
    } else {
      const last = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      const prev2 = pts[pts.length - 3];
      const mid1 = { x: (prev2.x + prev.x) / 2, y: (prev2.y + prev.y) / 2 };
      const mid2 = { x: (prev.x + last.x) / 2, y: (prev.y + last.y) / 2 };

      ctx.beginPath();
      ctx.moveTo(mid1.x, mid1.y);
      ctx.quadraticCurveTo(prev.x, prev.y, mid2.x, mid2.y);
      ctx.stroke();
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    pointsRef.current = [];
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    setHasStrokes(false);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasStrokes) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    const imgData = ctx.getImageData(0, 0, width, height);
    const pixels = imgData.data;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let found = false;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = pixels[(y * width + x) * 4 + 3];
        if (alpha > 8) {
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (!found) return;

    const pad = 12;
    const cropX = Math.max(0, minX - pad);
    const cropY = Math.max(0, minY - pad);
    const cropW = Math.min(width - cropX, maxX - minX + 1 + pad * 2);
    const cropH = Math.min(height - cropY, maxY - minY + 1 + pad * 2);

    const trimmed = document.createElement('canvas');
    trimmed.width = cropW;
    trimmed.height = cropH;
    const tCtx = trimmed.getContext('2d');
    if (!tCtx) return;

    tCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    const dataUrl = trimmed.toDataURL('image/png');
    const aspectRatio = cropH / cropW;
    onConfirm(dataUrl, aspectRatio);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-blue-950/50 backdrop-blur-xs p-0 md:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signature-modal-title"
    >
      <div className="w-full md:max-w-xl bg-white rounded-t-3xl md:rounded-3xl border-t-2 md:border-2 border-blue-200 shadow-2xl p-5 md:p-6 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <h2 id="signature-modal-title" className="text-xl font-bold text-blue-950">
            Draw Your Signature
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-xl bg-blue-50 text-blue-900 hover:bg-blue-100 active:scale-95 transition-transform"
            aria-label="Close signature pad"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Ink color + Saved signature reuse */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 bg-blue-50 p-1.5 rounded-xl border border-blue-100">
            <button
              type="button"
              onClick={() => setInkColor('blue')}
              className={`min-h-[44px] px-4 rounded-lg text-base font-semibold transition-colors whitespace-nowrap shrink-0 ${
                inkColor === 'blue'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-blue-900 hover:bg-blue-100'
              }`}
            >
              Blue Ink
            </button>
            <button
              type="button"
              onClick={() => setInkColor('black')}
              className={`min-h-[44px] px-4 rounded-lg text-base font-semibold transition-colors whitespace-nowrap shrink-0 ${
                inkColor === 'black'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-blue-900 hover:bg-blue-100'
              }`}
            >
              Black Ink
            </button>
          </div>

          {savedSignature && (
            <button
              type="button"
              onClick={() => onConfirm(savedSignature.dataUrl, savedSignature.aspectRatio)}
              className="min-h-[48px] px-4 rounded-xl bg-blue-50 border-2 border-blue-300 text-blue-800 text-base font-bold hover:bg-blue-100 active:scale-95 transition-transform flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-5 h-5" />
              Reuse Last
            </button>
          )}
        </div>

        {/* Drawing Pad */}
        <div
          ref={containerRef}
          className="relative w-full h-56 md:h-64 bg-white rounded-2xl border-2 border-dashed border-blue-300 overflow-hidden touch-none select-none"
        >
          {!hasStrokes && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-blue-400 px-4 text-center">
              <span className="text-lg font-semibold">Sign here with your finger</span>
            </div>
          )}
          <div className="pointer-events-none absolute left-6 right-6 bottom-8 border-b-2 border-blue-100" />
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="w-full h-full block touch-none cursor-crosshair"
          />
        </div>

        {/* Big Action Buttons */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={handleClear}
            className="min-h-[54px] px-5 rounded-2xl bg-blue-50 border-2 border-blue-200 text-blue-900 text-lg font-bold flex items-center justify-center gap-2 hover:bg-blue-100 active:scale-[0.98] transition-transform whitespace-nowrap"
          >
            <Eraser className="w-5 h-5" />
            Clear
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={!hasStrokes}
            className={`min-h-[54px] px-5 rounded-2xl text-lg font-bold flex items-center justify-center gap-2 transition-all whitespace-nowrap ${
              hasStrokes
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25 hover:bg-blue-700 active:scale-[0.98]'
                : 'bg-blue-200 text-white cursor-not-allowed'
            }`}
          >
            <Check className="w-6 h-6" />
            Add Signature
          </button>
        </div>
      </div>
    </div>
  );
};
