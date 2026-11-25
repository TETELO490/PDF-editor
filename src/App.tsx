import React, { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  Check,
  CheckSquare,
  Download,
  FileText,
  FileUp,
  PenTool,
  Type,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { AnnotationControlsBar } from './components/AnnotationControlsBar';
import { PdfPageCanvas } from './components/PdfPageCanvas';
import { SignatureModal } from './components/SignatureModal';
import type {
  InkColor,
  PdfAnnotation,
  SignatureAnnotation,
  TextAnnotation,
  TickAnnotation,
  ToolMode,
} from './types/pdf';
import { createSamplePdf, exportFilledPdf } from './utils/pdfEngine';
import { savePdfToDevice } from './utils/savePdfFile';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pageContainerRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [activeTool, setActiveTool] = useState<ToolMode>('text');
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusTextId, setFocusTextId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);

  const [isSignatureOpen, setIsSignatureOpen] = useState(false);
  const [savedSignature, setSavedSignature] = useState<{
    dataUrl: string;
    aspectRatio: number;
  } | null>(null);

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const loadPdfFromBytes = useCallback(async (bytes: Uint8Array, name: string) => {
    setIsLoadingPdf(true);
    setErrorMessage(null);
    setDownloadSuccess(false);

    try {
      // Pass a copy to pdf.js because its worker transfers/detaches the underlying ArrayBuffer
      const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
      const doc = await loadingTask.promise;

      const loadedPages: PDFPageProxy[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        loadedPages.push(page);
      }

      setPdfBytes(bytes);
      setFileName(name);
      setPdfDoc(doc);
      setPages(loadedPages);
      setAnnotations([]);
      setSelectedId(null);
      setFocusTextId(null);
      setActiveTool('text');
      setZoom(1);
    } catch {
      setErrorMessage('Could not open that file. Please choose a valid PDF.');
    } finally {
      setIsLoadingPdf(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      void pdfDoc?.cleanup();
    };
  }, [pdfDoc]);

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const buffer = await file.arrayBuffer();
    await loadPdfFromBytes(new Uint8Array(buffer), file.name);
  };

  const handleLoadSample = async () => {
    setIsLoadingPdf(true);
    setErrorMessage(null);
    try {
      const sampleBytes = await createSamplePdf();
      await loadPdfFromBytes(sampleBytes, 'Sample_Application_Form.pdf');
    } catch {
      setErrorMessage('Could not create sample PDF.');
      setIsLoadingPdf(false);
    }
  };

  const triggerUpload = () => {
    fileInputRef.current?.click();
  };

  const getMostVisiblePageIndex = (): number => {
    if (pages.length <= 1) return 0;
    const viewportMid = window.innerHeight * 0.45;
    let bestIdx = 0;
    let bestDist = Infinity;

    pages.forEach((_, idx) => {
      const el = pageContainerRefs.current[idx];
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const dist = Math.abs(center - viewportMid);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    });
    return bestIdx;
  };

  const handleTapEmptyPage = (pageIndex: number, xPct: number, yPct: number) => {
    // If an item is currently selected, first tap outside dismisses selection cleanly
    if (selectedId) {
      const current = annotations.find((a) => a.id === selectedId);
      if (current && current.type === 'text' && current.text.trim() === '') {
        setAnnotations((prev) => prev.filter((a) => a.id !== selectedId));
      }
      setSelectedId(null);
      return;
    }

    if (activeTool === 'text') {
      const id = createId();
      const newBox: TextAnnotation = {
        id,
        type: 'text',
        pageIndex,
        xPct,
        yPct,
        text: '',
        fontSize: 16,
        color: 'black',
      };
      // flushSync ensures textarea mounts inside user tap event so mobile keyboard opens immediately
      flushSync(() => {
        setAnnotations((prev) => [...prev, newBox]);
        setSelectedId(id);
        setFocusTextId(id);
      });
    } else if (activeTool === 'tick') {
      const id = createId();
      const newTick: TickAnnotation = {
        id,
        type: 'tick',
        pageIndex,
        xPct,
        yPct,
        size: 22,
        color: 'blue',
      };
      setAnnotations((prev) => [...prev, newTick]);
      setSelectedId(id);
    }
  };

  const handleUpdateAnnotation = useCallback((id: string, patch: Partial<PdfAnnotation>) => {
    setAnnotations((prev) =>
      prev.map((item) => (item.id === id ? ({ ...item, ...patch } as PdfAnnotation) : item))
    );
  }, []);

  const handleClearFocusRequest = useCallback(() => {
    setFocusTextId(null);
  }, []);

  const handleChangeSelectedSize = (delta: number) => {
    if (!selectedId) return;
    setAnnotations((prev) =>
      prev.map((item) => {
        if (item.id !== selectedId) return item;
        if (item.type === 'text') {
          const next = Math.max(10, Math.min(48, item.fontSize + delta * 2));
          return { ...item, fontSize: next };
        }
        if (item.type === 'tick') {
          const next = Math.max(14, Math.min(56, item.size + delta * 3));
          return { ...item, size: next };
        }
        const nextWidth = Math.max(0.14, Math.min(0.8, item.widthPct + delta * 0.04));
        return { ...item, widthPct: nextWidth };
      })
    );
  };

  const handleToggleSelectedColor = (color: InkColor) => {
    if (!selectedId) return;
    setAnnotations((prev) =>
      prev.map((item) => {
        if (item.id !== selectedId) return item;
        if (item.type === 'text' || item.type === 'tick') {
          return { ...item, color };
        }
        return item;
      })
    );
  };

  const handleDeleteSelected = () => {
    if (!selectedId) return;
    setAnnotations((prev) => prev.filter((item) => item.id !== selectedId));
    setSelectedId(null);
  };

  const handleDoneSelected = () => {
    if (!selectedId) return;
    const current = annotations.find((a) => a.id === selectedId);
    if (current && current.type === 'text' && current.text.trim() === '') {
      setAnnotations((prev) => prev.filter((a) => a.id !== selectedId));
    }
    setSelectedId(null);
  };

  const handleAddSignature = (dataUrl: string, aspectRatio: number) => {
    setSavedSignature({ dataUrl, aspectRatio });
    const pageIndex = getMostVisiblePageIndex();
    const id = createId();
    const newSig: SignatureAnnotation = {
      id,
      type: 'signature',
      pageIndex,
      xPct: 0.5,
      yPct: 0.65,
      widthPct: 0.34,
      aspectRatio,
      dataUrl,
    };
    setAnnotations((prev) => [...prev, newSig]);
    setSelectedId(id);
    setIsSignatureOpen(false);
  };

  const handleDownloadPdf = async () => {
    if (!pdfBytes || isDownloading) return;
    setIsDownloading(true);
    setErrorMessage(null);
    setDownloadSuccess(false);

    try {
      const filledBytes = await exportFilledPdf(pdfBytes, annotations);
      const baseName = fileName.replace(/\.pdf$/i, '') || 'document';
      await savePdfToDevice(filledBytes, `filled_${baseName}.pdf`);
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 3500);
    } catch {
      setErrorMessage('Failed to export PDF. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  const selectedAnnotation = annotations.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="min-h-dvh flex flex-col bg-blue-50 text-blue-950">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        onChange={handleFileSelected}
        className="hidden"
      />

      {/* Non-sticky Clean Top Header */}
      <header className="w-full bg-white border-b border-blue-100 pt-[env(safe-area-inset-top)]">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <span className="text-xl font-extrabold tracking-tight text-blue-950 whitespace-nowrap shrink-0">
              BlueFill PDF
            </span>
          </div>

          {pdfDoc && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={triggerUpload}
                className="min-h-[48px] px-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-base font-bold flex items-center gap-2 hover:bg-blue-100 active:scale-95 transition-transform whitespace-nowrap shrink-0"
              >
                <FileUp className="w-5 h-5 text-blue-700" />
                <span>Upload</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={isDownloading}
                className="hidden sm:flex min-h-[48px] px-5 rounded-xl bg-blue-600 text-white text-base font-bold items-center gap-2 shadow-sm hover:bg-blue-700 active:scale-95 transition-transform whitespace-nowrap shrink-0"
              >
                {downloadSuccess ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <Download className="w-5 h-5" />
                )}
                <span>{downloadSuccess ? 'Saved!' : isDownloading ? 'Saving...' : 'Download'}</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Error Notice */}
      {errorMessage && (
        <div className="max-w-3xl mx-auto w-full px-4 pt-4">
          <div className="bg-white border-2 border-blue-500 rounded-2xl p-4 text-base font-semibold text-blue-950 flex items-center justify-between gap-3">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="min-h-[44px] px-4 rounded-xl bg-blue-600 text-white font-bold text-base shrink-0"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      {!pdfDoc ? (
        <main className="flex-1 flex items-center justify-center px-4 py-8 md:py-12">
          <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
            {/* Primary Upload Card */}
            <section className="bg-white rounded-3xl border border-blue-200 shadow-sm p-6 sm:p-8 flex flex-col justify-between gap-6">
              <div className="space-y-4">
                <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-blue-950 text-balance">
                  Fill and sign any PDF on your phone
                </h1>
                <p className="text-lg text-blue-900/80 leading-relaxed">
                  Upload a form, tap anywhere to type, add checkmarks, draw your signature with your finger, and save your filled PDF.
                </p>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={triggerUpload}
                  disabled={isLoadingPdf}
                  className="w-full min-h-[64px] px-6 rounded-2xl bg-blue-600 text-white text-xl font-bold flex items-center justify-center gap-3 shadow-lg shadow-blue-600/20 hover:bg-blue-700 active:scale-[0.98] transition-transform"
                >
                  <FileUp className="w-7 h-7" />
                  <span>{isLoadingPdf ? 'Opening PDF...' : 'Upload PDF'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleLoadSample}
                  disabled={isLoadingPdf}
                  className="w-full min-h-[54px] px-6 rounded-2xl bg-blue-50 border-2 border-blue-200 text-blue-900 text-lg font-bold flex items-center justify-center gap-2 hover:bg-blue-100 active:scale-[0.98] transition-transform"
                >
                  <FileText className="w-6 h-6 text-blue-700" />
                  <span>Try Sample Form</span>
                </button>
              </div>
            </section>

            {/* Clear Step-by-Step Guide Card */}
            <section className="bg-white rounded-3xl border border-blue-200 shadow-sm p-6 sm:p-8 flex flex-col justify-center gap-6">
              <h2 className="text-2xl font-bold text-blue-950">How it works</h2>

              <div className="space-y-5">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center shrink-0">
                    <Type className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-blue-950">Tap anywhere to type</h3>
                    <p className="text-base text-blue-900/80">
                      Tap a line on your PDF to open the keyboard, drag to move, and resize text.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                    <CheckSquare className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-blue-950">Add ticks and checkboxes</h3>
                    <p className="text-base text-blue-900/80">
                      Tap Tick, then tap any box on your form to place a clean checkmark.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                    <PenTool className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-blue-950">Sign with your finger & save</h3>
                    <p className="text-base text-blue-900/80">
                      Draw your signature smoothly, place it on the page, and download instantly.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </main>
      ) : (
        <main className="flex-1 pb-28">
          {/* Document Bar (File info + Zoom controls) */}
          <div className="max-w-3xl mx-auto px-4 pt-4 pb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-bold text-blue-950 truncate">{fileName}</p>
              <p className="text-base text-blue-800 font-medium">
                {pages.length} {pages.length === 1 ? 'page' : 'pages'} ·{' '}
                {activeTool === 'tick'
                  ? 'Tap PDF to add a tick'
                  : 'Tap PDF to type text'}
              </p>
            </div>

            <div className="flex items-center gap-1.5 bg-white border border-blue-200 rounded-2xl p-1 shrink-0">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.25).toFixed(2))))}
                className="min-h-[44px] min-w-[44px] rounded-xl bg-blue-50 text-blue-900 flex items-center justify-center hover:bg-blue-100 active:scale-95 transition-transform"
                aria-label="Zoom out"
              >
                <ZoomOut className="w-5 h-5" />
              </button>
              <span className="px-2 text-base font-bold text-blue-950 tabular-nums whitespace-nowrap">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(2, Number((z + 0.25).toFixed(2))))}
                className="min-h-[44px] min-w-[44px] rounded-xl bg-blue-50 text-blue-900 flex items-center justify-center hover:bg-blue-100 active:scale-95 transition-transform"
                aria-label="Zoom in"
              >
                <ZoomIn className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* PDF Pages Stream */}
          <div className="max-w-3xl mx-auto px-3 sm:px-4 space-y-5">
            {pages.map((page, index) => (
              <div
                key={index}
                ref={(el) => {
                  pageContainerRefs.current[index] = el;
                }}
                className="space-y-1.5"
              >
                <PdfPageCanvas
                  page={page}
                  pageIndex={index}
                  zoom={zoom}
                  activeTool={activeTool}
                  annotations={annotations.filter((a) => a.pageIndex === index)}
                  selectedId={selectedId}
                  focusTextId={focusTextId}
                  onClearFocusRequest={handleClearFocusRequest}
                  onTapEmptyPage={handleTapEmptyPage}
                  onSelectAnnotation={(id) => setSelectedId(id)}
                  onUpdateAnnotation={handleUpdateAnnotation}
                />
                {pages.length > 1 && (
                  <p className="text-center text-base font-semibold text-blue-800">
                    Page {index + 1} of {pages.length}
                  </p>
                )}
              </div>
            ))}
          </div>
        </main>
      )}

      {/* Fixed Bottom Thumb Toolbar (Single fixed element <= 12% mobile height) */}
      {pdfDoc && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t-2 border-blue-200 shadow-[0_-4px_20px_rgba(37,99,235,0.1)] px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
          {selectedAnnotation ? (
            <AnnotationControlsBar
              annotation={selectedAnnotation}
              onChangeSize={handleChangeSelectedSize}
              onToggleColor={handleToggleSelectedColor}
              onDelete={handleDeleteSelected}
              onDone={handleDoneSelected}
            />
          ) : (
            <div className="grid grid-cols-4 gap-2 max-w-3xl mx-auto">
              <button
                type="button"
                onClick={() => setActiveTool('text')}
                className={`min-h-[54px] px-2 rounded-2xl font-bold text-base flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 transition-colors whitespace-nowrap ${
                  activeTool === 'text'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                    : 'bg-blue-50 text-blue-950 border border-blue-200 hover:bg-blue-100'
                }`}
              >
                <Type className="w-5 h-5 shrink-0" />
                <span>Text</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTool('tick')}
                className={`min-h-[54px] px-2 rounded-2xl font-bold text-base flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 transition-colors whitespace-nowrap ${
                  activeTool === 'tick'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                    : 'bg-blue-50 text-blue-950 border border-blue-200 hover:bg-blue-100'
                }`}
              >
                <CheckSquare className="w-5 h-5 shrink-0" />
                <span>Tick</span>
              </button>

              <button
                type="button"
                onClick={() => setIsSignatureOpen(true)}
                className="min-h-[54px] px-2 rounded-2xl bg-blue-50 text-blue-950 border border-blue-200 font-bold text-base flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 hover:bg-blue-100 active:scale-95 transition-transform whitespace-nowrap"
              >
                <PenTool className="w-5 h-5 text-blue-700 shrink-0" />
                <span>Sign</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={isDownloading}
                className="min-h-[54px] px-2 rounded-2xl bg-blue-700 text-white font-bold text-base flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 shadow-md shadow-blue-700/25 hover:bg-blue-800 active:scale-95 transition-transform whitespace-nowrap"
              >
                {downloadSuccess ? (
                  <Check className="w-5 h-5 shrink-0" />
                ) : (
                  <Download className="w-5 h-5 shrink-0" />
                )}
                <span>{downloadSuccess ? 'Saved' : isDownloading ? '...' : 'Save'}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Signature Drawing Modal */}
      <SignatureModal
        isOpen={isSignatureOpen}
        savedSignature={savedSignature}
        onClose={() => setIsSignatureOpen(false)}
        onConfirm={handleAddSignature}
      />
    </div>
  );
}
