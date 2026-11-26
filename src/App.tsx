import React, { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ArrowLeft,
  Check,
  CheckSquare,
  ChevronRight,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  PenTool,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { AnnotationControlsBar } from './components/AnnotationControlsBar';
import { FileTypeIcon } from './components/FileTypeIcon';
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
import {
  deleteDraft,
  loadDrafts,
  saveDraft,
  type DraftProject,
} from './utils/draftsDb';
import { createSamplePdf, exportFilledPdf } from './utils/pdfEngine';
import {
  detectDocumentKind,
  loadRecentFiles,
  saveRecentFile,
  type DocumentKind,
  type RecentFileEntry,
} from './utils/recentFilesDb';
import { savePdfToDevice } from './utils/savePdfFile';
import { convertWordBytesToPdf, createSampleWordDocx } from './utils/wordToPdf';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatDraftTimestamp(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) return 'Just now';
  if (diffMs < 3_600_000) {
    const mins = Math.max(1, Math.floor(diffMs / 60_000));
    return `${mins}m ago`;
  }
  const date = new Date(timestamp);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const timeStr = date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (isToday) return `Today, ${timeStr}`;

  const dateStr = date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
  return `${dateStr}, ${timeStr}`;
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pageContainerRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [sourceKind, setSourceKind] = useState<DocumentKind>('pdf');
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [isConvertingWord, setIsConvertingWord] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>([]);
  const [drafts, setDrafts] = useState<DraftProject[]>([]);
  const [draftSavedHint, setDraftSavedHint] = useState(false);

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

  // Always holds latest active editing state so exit/background handlers save immediately
  const latestSessionRef = useRef<{
    draftId: string | null;
    pdfBytes: Uint8Array | null;
    fileName: string;
    sourceKind: DocumentKind;
    annotations: PdfAnnotation[];
    hasExistingDraft: boolean;
  }>({
    draftId: null,
    pdfBytes: null,
    fileName: '',
    sourceKind: 'pdf',
    annotations: [],
    hasExistingDraft: false,
  });

  latestSessionRef.current = {
    draftId: activeDraftId,
    pdfBytes,
    fileName,
    sourceKind,
    annotations,
    hasExistingDraft: Boolean(
      activeDraftId && drafts.some((d) => d.id === activeDraftId)
    ),
  };

  useEffect(() => {
    void loadRecentFiles().then(setRecentFiles);
    void loadDrafts().then(setDrafts);
  }, []);

  const persistCurrentDraftNow = useCallback(async () => {
    const snap = latestSessionRef.current;
    if (!snap.draftId || !snap.pdfBytes) return;

    // Auto-save whenever there is at least 1 edit or an existing draft is being updated
    if (snap.annotations.length === 0 && !snap.hasExistingDraft) return;

    const updated = await saveDraft({
      id: snap.draftId,
      name: snap.fileName,
      kind: snap.sourceKind,
      pdfBytes: snap.pdfBytes,
      annotations: snap.annotations,
      updatedAt: Date.now(),
    });
    if (updated.length > 0) {
      setDrafts(updated);
      setDraftSavedHint(true);
    }
  }, []);

  // Automatically save draft whenever annotations change (no Save button needed)
  useEffect(() => {
    if (!activeDraftId || !pdfBytes) return;
    const hasExisting = drafts.some((d) => d.id === activeDraftId);
    if (annotations.length === 0 && !hasExisting) {
      setDraftSavedHint(false);
      return;
    }

    const timer = window.setTimeout(() => {
      void persistCurrentDraftNow();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [annotations, activeDraftId, pdfBytes, drafts, persistCurrentDraftNow]);

  // Flush draft immediately if user closes tab, switches mobile apps, or navigates away
  useEffect(() => {
    const flushOnExit = () => {
      void persistCurrentDraftNow();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushOnExit();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', flushOnExit);
    window.addEventListener('beforeunload', flushOnExit);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', flushOnExit);
      window.removeEventListener('beforeunload', flushOnExit);
    };
  }, [persistCurrentDraftNow]);

  const loadPdfFromBytes = useCallback(
    async (
      bytes: Uint8Array,
      name: string,
      kind: DocumentKind,
      initialAnnotations: PdfAnnotation[] = [],
      existingDraftId?: string
    ) => {
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
        setSourceKind(kind);
        setActiveDraftId(existingDraftId ?? createId());
        setPdfDoc(doc);
        setPages(loadedPages);
        setAnnotations(initialAnnotations);
        setDraftSavedHint(initialAnnotations.length > 0);
        setSelectedId(null);
        setFocusTextId(null);
        setActiveTool('text');
        setZoom(1);
      } catch {
        setErrorMessage('Could not open that file. Please choose a valid PDF or Word document.');
      } finally {
        setIsLoadingPdf(false);
      }
    },
    []
  );

  useEffect(() => {
    return () => {
      void pdfDoc?.cleanup();
    };
  }, [pdfDoc]);

  const openDocumentBytes = useCallback(
    async (rawBytes: Uint8Array, originalName: string, persistRecent = true) => {
      // Save any in-progress draft before switching documents
      await persistCurrentDraftNow();

      const kind = detectDocumentKind(originalName);
      setErrorMessage(null);

      if (kind === 'word') {
        setIsConvertingWord(true);
        try {
          const convertedPdfBytes = await convertWordBytesToPdf(rawBytes);
          if (persistRecent) {
            const updated = await saveRecentFile({
              name: originalName,
              kind: 'word',
              bytes: rawBytes,
            });
            if (updated.length > 0) setRecentFiles(updated);
          }
          await loadPdfFromBytes(convertedPdfBytes, originalName, 'word');
        } catch (err) {
          const msg =
            err instanceof Error && err.message
              ? err.message
              : 'Could not convert this Word file to PDF.';
          setErrorMessage(msg);
        } finally {
          setIsConvertingWord(false);
        }
        return;
      }

      if (persistRecent) {
        const updated = await saveRecentFile({
          name: originalName,
          kind: 'pdf',
          bytes: rawBytes,
        });
        if (updated.length > 0) setRecentFiles(updated);
      }
      await loadPdfFromBytes(rawBytes, originalName, 'pdf');
    },
    [loadPdfFromBytes, persistCurrentDraftNow]
  );

  const handleOpenDraft = async (draft: DraftProject) => {
    await loadPdfFromBytes(
      new Uint8Array(draft.pdfBytes),
      draft.name,
      draft.kind,
      draft.annotations,
      draft.id
    );
  };

  const handleDeleteDraft = async (
    e: React.MouseEvent<HTMLButtonElement>,
    draftId: string
  ) => {
    e.stopPropagation();
    const updated = await deleteDraft(draftId);
    setDrafts(updated);
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const lower = file.name.toLowerCase();
    const isAllowed =
      lower.endsWith('.pdf') || lower.endsWith('.docx') || lower.endsWith('.doc');
    if (!isAllowed) {
      setErrorMessage('Please choose a .pdf, .docx, or .doc file.');
      return;
    }

    const buffer = await file.arrayBuffer();
    await openDocumentBytes(new Uint8Array(buffer), file.name, true);
  };

  const handleOpenRecent = async (entry: RecentFileEntry) => {
    await openDocumentBytes(new Uint8Array(entry.bytes), entry.name, true);
  };

  const handleLoadSamplePdf = async () => {
    setIsLoadingPdf(true);
    setErrorMessage(null);
    try {
      const sampleBytes = await createSamplePdf();
      await openDocumentBytes(sampleBytes, 'Sample_Application_Form.pdf', true);
    } catch {
      setErrorMessage('Could not create sample PDF.');
      setIsLoadingPdf(false);
    }
  };

  const handleLoadSampleWord = async () => {
    setErrorMessage(null);
    try {
      const sampleWordBytes = await createSampleWordDocx();
      await openDocumentBytes(sampleWordBytes, 'Sample_Word_Form.docx', true);
    } catch {
      setErrorMessage('Could not open sample Word document.');
    }
  };

  const triggerOpenFile = () => {
    fileInputRef.current?.click();
  };

  const handleBackToFiles = async () => {
    await persistCurrentDraftNow();
    setPdfDoc(null);
    setPages([]);
    setPdfBytes(null);
    setActiveDraftId(null);
    setSelectedId(null);
    setFocusTextId(null);
    setAnnotations([]);
    setDraftSavedHint(false);
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
      const baseName = fileName.replace(/\.(pdf|docx|doc)$/i, '') || 'document';
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
  const isBusy = isLoadingPdf || isConvertingWord;

  const hasSamplePdfInRecent = recentFiles.some(
    (f) => f.name === 'Sample_Application_Form.pdf' && f.kind === 'pdf'
  );
  const hasSampleWordInRecent = recentFiles.some(
    (f) => f.name === 'Sample_Word_Form.docx' && f.kind === 'word'
  );

  return (
    <div className="min-h-dvh flex flex-col bg-blue-50 text-blue-950">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
        onChange={handleFileSelected}
        className="hidden"
      />

      {/* Non-sticky Clean Top Header */}
      <header className="w-full bg-white border-b border-blue-100 pt-[env(safe-area-inset-top)]">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {pdfDoc ? (
              <button
                type="button"
                onClick={handleBackToFiles}
                className="min-h-[48px] min-w-[48px] rounded-xl bg-blue-50 border border-blue-200 text-blue-900 flex items-center justify-center hover:bg-blue-100 active:scale-95 transition-transform shrink-0"
                aria-label="Back to drafts and files"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            ) : (
              <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5" />
              </div>
            )}
            <span className="text-xl font-extrabold tracking-tight text-blue-950 whitespace-nowrap shrink-0">
              BlueFill PDF
            </span>
          </div>

          {pdfDoc && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={triggerOpenFile}
                disabled={isBusy}
                className="min-h-[48px] px-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-base font-bold flex items-center gap-2 hover:bg-blue-100 active:scale-95 transition-transform whitespace-nowrap shrink-0"
              >
                <FolderOpen className="w-5 h-5 text-blue-700" />
                <span>Open File</span>
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

      {/* Converting Word to PDF Status Banner */}
      {isConvertingWord && (
        <div className="max-w-3xl mx-auto w-full px-4 pt-4">
          <div className="bg-blue-600 text-white rounded-2xl p-4 shadow-md flex items-center justify-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin shrink-0" />
            <span className="text-lg font-bold">Converting Word to PDF...</span>
          </div>
        </div>
      )}

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
        <main className="flex-1 flex items-start md:items-center justify-center px-4 py-6 md:py-10">
          <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Primary Open File Card */}
            <section className="bg-white rounded-3xl border border-blue-200 shadow-sm p-6 sm:p-8 flex flex-col justify-between gap-6">
              <div className="space-y-4">
                <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-blue-950 text-balance">
                  Fill and sign PDF or Word files on your phone
                </h1>
                <p className="text-lg text-blue-900/80 leading-relaxed">
                  Open a PDF or Word document, tap anywhere to type, add ticks, draw your signature, and save as a filled PDF. All your edits save automatically in Drafts.
                </p>
              </div>

              <div className="space-y-4">
                <button
                  type="button"
                  onClick={triggerOpenFile}
                  disabled={isBusy}
                  className="w-full min-h-[64px] px-6 rounded-2xl bg-blue-600 text-white text-xl font-bold flex items-center justify-center gap-3 shadow-lg shadow-blue-600/20 hover:bg-blue-700 active:scale-[0.98] transition-transform disabled:opacity-70"
                >
                  {isConvertingWord ? (
                    <>
                      <Loader2 className="w-7 h-7 animate-spin" />
                      <span>Converting Word to PDF...</span>
                    </>
                  ) : (
                    <>
                      <FolderOpen className="w-7 h-7" />
                      <span>{isLoadingPdf ? 'Opening File...' : 'Open File'}</span>
                    </>
                  )}
                </button>

                <p className="text-center text-base font-semibold text-blue-800">
                  Supports .pdf, .docx, and .doc files
                </p>
              </div>
            </section>

            {/* Right Column: Auto-Saved Drafts + File List */}
            <div className="space-y-6">
              {/* Auto-Saved Drafts Section */}
              <section className="bg-white rounded-3xl border border-blue-200 shadow-sm p-6 flex flex-col gap-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-2xl font-bold text-blue-950">Drafts</h2>
                  <span className="text-base font-semibold text-blue-700">
                    Saved automatically
                  </span>
                </div>

                {drafts.length === 0 ? (
                  <p className="text-base text-blue-900/75 py-2">
                    Any PDF or Word project you start filling is saved here automatically so you can continue anytime.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {drafts.map((draft) => {
                      const editCount = draft.annotations.length;
                      return (
                        <div
                          key={draft.id}
                          onClick={() => !isBusy && void handleOpenDraft(draft)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if ((e.key === 'Enter' || e.key === ' ') && !isBusy) {
                              e.preventDefault();
                              void handleOpenDraft(draft);
                            }
                          }}
                          className="w-full min-h-[72px] p-3 rounded-2xl bg-blue-50 border-2 border-blue-300 hover:bg-blue-100/80 active:scale-[0.99] transition-all flex items-center gap-3.5 text-left cursor-pointer"
                        >
                          <FileTypeIcon kind={draft.kind} />
                          <div className="flex-1 min-w-0">
                            <p className="text-base font-bold text-blue-950 truncate">
                              {draft.name}
                            </p>
                            <p className="text-base text-blue-800">
                              {editCount} {editCount === 1 ? 'item' : 'items'} ·{' '}
                              {formatDraftTimestamp(draft.updatedAt)}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => void handleDeleteDraft(e, draft.id)}
                            className="min-h-[48px] min-w-[48px] rounded-xl bg-white border border-blue-200 text-blue-800 flex items-center justify-center hover:bg-blue-50 active:scale-95 transition-transform shrink-0"
                            aria-label={`Delete draft ${draft.name}`}
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* File List Card (Shows both PDF and W icons, opens all inside app) */}
              <section className="bg-white rounded-3xl border border-blue-200 shadow-sm p-6 flex flex-col gap-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-2xl font-bold text-blue-950">Files</h2>
                  <span className="text-base font-semibold text-blue-700">
                    Tap to open
                  </span>
                </div>

                <div className="space-y-3">
                  {/* Recently opened PDF & Word files */}
                  {recentFiles.map((file) => (
                    <button
                      key={file.id}
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleOpenRecent(file)}
                      className="w-full min-h-[68px] p-3 rounded-2xl bg-blue-50/70 border border-blue-200 hover:bg-blue-100/80 active:scale-[0.99] transition-all flex items-center gap-3.5 text-left"
                    >
                      <FileTypeIcon kind={file.kind} />
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-bold text-blue-950 truncate">
                          {file.name}
                        </p>
                        <p className="text-base text-blue-800">
                          {file.kind === 'word'
                            ? 'Word Document · Opens as PDF'
                            : 'PDF Document'}
                        </p>
                      </div>
                      <ChevronRight className="w-6 h-6 text-blue-600 shrink-0" />
                    </button>
                  ))}

                  {/* Starter Sample PDF (PDF icon) */}
                  {!hasSamplePdfInRecent && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={handleLoadSamplePdf}
                      className="w-full min-h-[68px] p-3 rounded-2xl bg-blue-50/70 border border-blue-200 hover:bg-blue-100/80 active:scale-[0.99] transition-all flex items-center gap-3.5 text-left"
                    >
                      <FileTypeIcon kind="pdf" />
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-bold text-blue-950 truncate">
                          Sample_Application_Form.pdf
                        </p>
                        <p className="text-base text-blue-800">
                          PDF Form · Ready to fill
                        </p>
                      </div>
                      <ChevronRight className="w-6 h-6 text-blue-600 shrink-0" />
                    </button>
                  )}

                  {/* Starter Sample Word Doc (W icon) */}
                  {!hasSampleWordInRecent && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={handleLoadSampleWord}
                      className="w-full min-h-[68px] p-3 rounded-2xl bg-blue-50/70 border border-blue-200 hover:bg-blue-100/80 active:scale-[0.99] transition-all flex items-center gap-3.5 text-left"
                    >
                      <FileTypeIcon kind="word" />
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-bold text-blue-950 truncate">
                          Sample_Word_Form.docx
                        </p>
                        <p className="text-base text-blue-800">
                          Word Document · Converts to PDF
                        </p>
                      </div>
                      <ChevronRight className="w-6 h-6 text-blue-600 shrink-0" />
                    </button>
                  )}
                </div>
              </section>
            </div>
          </div>
        </main>
      ) : (
        <main className="flex-1 pb-28">
          {/* Document Bar (File info + Zoom controls) */}
          <div className="max-w-3xl mx-auto px-4 pt-4 pb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <FileTypeIcon kind={sourceKind} />
              <div className="min-w-0">
                <p className="text-base font-bold text-blue-950 truncate">{fileName}</p>
                <p className="text-base text-blue-800 font-medium">
                  {pages.length} {pages.length === 1 ? 'page' : 'pages'} ·{' '}
                  {activeTool === 'tick'
                    ? 'Tap page to add a tick'
                    : 'Tap page to type text'}
                  {draftSavedHint ? ' · Draft saved' : ''}
                </p>
              </div>
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
