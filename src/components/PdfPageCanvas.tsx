import React, { useEffect, useRef, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import { Move } from 'lucide-react';
import type { PdfAnnotation, ToolMode } from '../types/pdf';

interface PdfPageCanvasProps {
  page: PDFPageProxy;
  pageIndex: number;
  zoom: number;
  activeTool: ToolMode;
  annotations: PdfAnnotation[];
  selectedId: string | null;
  focusTextId: string | null;
  onClearFocusRequest: () => void;
  onTapEmptyPage: (pageIndex: number, xPct: number, yPct: number) => void;
  onSelectAnnotation: (id: string) => void;
  onUpdateAnnotation: (id: string, patch: Partial<PdfAnnotation>) => void;
}

export const PdfPageCanvas: React.FC<PdfPageCanvasProps> = ({
  page,
  pageIndex,
  zoom,
  activeTool,
  annotations,
  selectedId,
  focusTextId,
  onClearFocusRequest,
  onTapEmptyPage,
  onSelectAnnotation,
  onUpdateAnnotation,
}) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textInputRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [renderedSize, setRenderedSize] = useState<{
    width: number;
    height: number;
    pdfWidthPt: number;
  }>({
    width: 0,
    height: 0,
    pdfWidthPt: 612,
  });

  // Track drag state cleanly without triggering tap-to-add
  const dragStateRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    origXPct: number;
    origYPct: number;
    moved: boolean;
  } | null>(null);

  const pageTapStartRef = useRef<{ x: number; y: number } | null>(null);

  // Measure available container width
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const updateWidth = () => {
      setContainerWidth(el.clientWidth);
    };
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Render PDF page onto crisp high-DPI canvas
  useEffect(() => {
    if (!containerWidth || !canvasRef.current) return;

    let cancelled = false;
    const baseViewport = page.getViewport({ scale: 1 });
    const targetCssWidth = containerWidth * zoom;
    const scale = targetCssWidth / baseViewport.width;
    const cssViewport = page.getViewport({ scale });

    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const canvas = canvasRef.current;
    canvas.width = Math.floor(cssViewport.width * dpr);
    canvas.height = Math.floor(cssViewport.height * dpr);
    canvas.style.width = `${cssViewport.width}px`;
    canvas.style.height = `${cssViewport.height}px`;

    setRenderedSize({
      width: cssViewport.width,
      height: cssViewport.height,
      pdfWidthPt: baseViewport.width,
    });

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const renderTask = page.render({
      canvasContext: ctx,
      viewport: cssViewport,
      canvas,
    });

    renderTask.promise.catch(() => {
      // Ignore cancelled renders when resizing/zooming quickly
    });

    return () => {
      cancelled = true;
      renderTask.cancel();
      void cancelled;
    };
  }, [page, containerWidth, zoom]);

  // Clear pending focus flag cleanly after mount
  useEffect(() => {
    if (!focusTextId) return;
    const target = textInputRefs.current[focusTextId];
    if (target) {
      target.focus({ preventScroll: true });
      const len = target.value.length;
      target.setSelectionRange(len, len);
      onClearFocusRequest();
    }
  }, [focusTextId, onClearFocusRequest]);

  // Auto-resize textarea height to fit text
  const syncTextareaHeight = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const pageScale = renderedSize.width > 0 ? renderedSize.width / renderedSize.pdfWidthPt : 1;

  const handlePagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && e.target !== canvasRef.current) return;
    pageTapStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && e.target !== canvasRef.current) return;
    if (!renderedSize.width || !renderedSize.height) return;

    if (pageTapStartRef.current) {
      const dist = Math.hypot(
        e.clientX - pageTapStartRef.current.x,
        e.clientY - pageTapStartRef.current.y
      );
      if (dist > 10) return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = Math.max(0.02, Math.min(0.92, (e.clientX - rect.left) / rect.width));
    const yPct = Math.max(0.02, Math.min(0.95, (e.clientY - rect.top) / rect.height));
    onTapEmptyPage(pageIndex, xPct, yPct);
  };

  const startDrag = (
    e: React.PointerEvent<HTMLElement>,
    ann: PdfAnnotation
  ) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onSelectAnnotation(ann.id);
    dragStateRef.current = {
      id: ann.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origXPct: ann.xPct,
      origYPct: ann.yPct,
      moved: false,
    };
  };

  const moveDrag = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragStateRef.current;
    if (!drag || !renderedSize.width || !renderedSize.height) return;
    e.stopPropagation();

    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dx, dy) > 3) {
      drag.moved = true;
    }
    if (!drag.moved) return;

    const newXPct = Math.max(0.02, Math.min(0.96, drag.origXPct + dx / renderedSize.width));
    const newYPct = Math.max(0.02, Math.min(0.97, drag.origYPct + dy / renderedSize.height));

    onUpdateAnnotation(drag.id, { xPct: newXPct, yPct: newYPct });
  };

  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragStateRef.current) return;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragStateRef.current = null;
  };

  return (
    <div ref={wrapperRef} className="w-full overflow-x-auto pb-2">
      <div
        className={`relative mx-auto bg-white shadow-md border border-blue-200 select-none ${
          activeTool === 'tick' ? 'cursor-crosshair' : 'cursor-text'
        }`}
        style={{
          width: renderedSize.width ? `${renderedSize.width}px` : '100%',
          height: renderedSize.height ? `${renderedSize.height}px` : 'auto',
        }}
        onPointerDown={handlePagePointerDown}
        onClick={handlePageClick}
      >
        <canvas ref={canvasRef} className="block" />

        {/* Annotations Overlay */}
        {renderedSize.width > 0 &&
          annotations.map((ann) => {
            const isSelected = ann.id === selectedId;

            if (ann.type === 'text') {
              const fontPx = Math.max(10, ann.fontSize * pageScale);
              const textColor = ann.color === 'blue' ? '#1D4ED8' : '#0F172A';
              const minBoxWidth = Math.max(120, Math.min(260, renderedSize.width * 0.45));

              return (
                <div
                  key={ann.id}
                  style={{
                    left: `${ann.xPct * 100}%`,
                    top: `${ann.yPct * 100}%`,
                    maxWidth: `${Math.max(120, renderedSize.width * (1 - ann.xPct) - 8)}px`,
                    transform: 'translate(-10px, -6px)',
                  }}
                  className={`absolute z-20 ${isSelected ? 'z-30' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectAnnotation(ann.id);
                    textInputRefs.current[ann.id]?.focus();
                  }}
                >
                  {/* Floating finger-friendly Move handle positioned above without shifting text */}
                  {isSelected && (
                    <div
                      onPointerDown={(e) => startDrag(e, ann)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      className={`touch-none absolute ${
                        ann.yPct < 0.08 ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
                      } ${
                        ann.xPct > 0.65 ? 'right-0' : 'left-0'
                      } inline-flex items-center gap-1.5 px-3 min-h-[38px] rounded-xl bg-blue-600 text-white text-sm font-bold shadow-md cursor-grab active:cursor-grabbing select-none whitespace-nowrap`}
                    >
                      <Move className="w-4 h-4 shrink-0" />
                      Drag to Move
                    </div>
                  )}

                  {isSelected ? (
                    <textarea
                      ref={(el) => {
                        textInputRefs.current[ann.id] = el;
                        syncTextareaHeight(el);
                        if (el && focusTextId === ann.id && document.activeElement !== el) {
                          el.focus({ preventScroll: true });
                        }
                      }}
                      rows={1}
                      value={ann.text}
                      placeholder="Type here..."
                      onChange={(e) => {
                        syncTextareaHeight(e.target);
                        onUpdateAnnotation(ann.id, { text: e.target.value });
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        fontSize: `${fontPx}px`,
                        lineHeight: 1.25,
                        color: textColor,
                        minWidth: `${minBoxWidth}px`,
                      }}
                      className="box-border block w-full bg-blue-50/90 border-2 border-blue-600 rounded-lg px-2 py-1 outline-none resize-none overflow-hidden font-sans placeholder:text-blue-400 shadow-sm"
                    />
                  ) : (
                    <div
                      onPointerDown={(e) => startDrag(e, ann)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      style={{
                        fontSize: `${fontPx}px`,
                        lineHeight: 1.25,
                        color: textColor,
                      }}
                      className="box-border block touch-none whitespace-pre-wrap px-2 py-1 rounded-lg border-2 border-dashed border-blue-400/70 bg-white/50 hover:border-blue-600 font-sans cursor-move"
                    >
                      {ann.text || (
                        <span className="text-blue-400 italic">Tap to type</span>
                      )}
                    </div>
                  )}
                </div>
              );
            }

            if (ann.type === 'tick') {
              const tickPx = Math.max(16, ann.size * pageScale);
              const strokeColor = ann.color === 'blue' ? '#1D4ED8' : '#0F172A';

              return (
                <div
                  key={ann.id}
                  onPointerDown={(e) => startDrag(e, ann)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectAnnotation(ann.id);
                  }}
                  style={{
                    left: `${ann.xPct * 100}%`,
                    top: `${ann.yPct * 100}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  className={`absolute touch-none min-w-[46px] min-h-[46px] flex items-center justify-center rounded-xl cursor-move transition-shadow ${
                    isSelected
                      ? 'z-30 bg-blue-50/80 ring-2 ring-blue-600 shadow-md'
                      : 'z-20 hover:bg-blue-50/40'
                  }`}
                >
                  <svg
                    width={tickPx}
                    height={tickPx}
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-label="Checkmark"
                  >
                    <path
                      d="M4 12.5L9.5 18L20 6"
                      stroke={strokeColor}
                      strokeWidth="3.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              );
            }

            // Signature
            const sigWidthPx = ann.widthPct * renderedSize.width;
            const sigHeightPx = sigWidthPx * ann.aspectRatio;

            return (
              <div
                key={ann.id}
                onPointerDown={(e) => startDrag(e, ann)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectAnnotation(ann.id);
                }}
                style={{
                  left: `${ann.xPct * 100}%`,
                  top: `${ann.yPct * 100}%`,
                  width: `${Math.max(48, sigWidthPx)}px`,
                  height: `${Math.max(40, sigHeightPx)}px`,
                  transform: 'translate(-50%, -50%)',
                }}
                className={`absolute touch-none flex items-center justify-center rounded-xl cursor-move ${
                  isSelected
                    ? 'z-30 bg-blue-50/50 ring-2 ring-blue-600 shadow-md p-1'
                    : 'z-20 hover:ring-1 hover:ring-blue-300'
                }`}
              >
                <img
                  src={ann.dataUrl}
                  alt="Signature"
                  draggable={false}
                  className="w-full h-full object-contain pointer-events-none select-none"
                />
              </div>
            );
          })}
      </div>
    </div>
  );
};
