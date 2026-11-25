import React from 'react';
import { Check, Minus, Plus, Trash2 } from 'lucide-react';
import type { InkColor, PdfAnnotation } from '../types/pdf';

interface AnnotationControlsBarProps {
  annotation: PdfAnnotation;
  onChangeSize: (delta: number) => void;
  onToggleColor: (color: InkColor) => void;
  onDelete: () => void;
  onDone: () => void;
}

export const AnnotationControlsBar: React.FC<AnnotationControlsBarProps> = ({
  annotation,
  onChangeSize,
  onToggleColor,
  onDelete,
  onDone,
}) => {
  const sizeLabel =
    annotation.type === 'text'
      ? `${annotation.fontSize} pt`
      : annotation.type === 'tick'
        ? `${annotation.size} pt`
        : `${Math.round(annotation.widthPct * 100)}%`;

  return (
    <div className="flex items-center justify-between gap-2 w-full max-w-3xl mx-auto">
      {/* Size controls */}
      <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-2xl p-1 shrink-0">
        <button
          type="button"
          onClick={() => onChangeSize(-1)}
          className="min-h-[48px] min-w-[48px] px-3 rounded-xl bg-white text-blue-900 font-bold text-lg flex items-center justify-center border border-blue-100 hover:bg-blue-100 active:scale-95 transition-transform"
          aria-label="Make smaller"
        >
          <Minus className="w-5 h-5" />
        </button>

        <span className="px-2 text-base font-bold text-blue-950 tabular-nums whitespace-nowrap">
          {sizeLabel}
        </span>

        <button
          type="button"
          onClick={() => onChangeSize(1)}
          className="min-h-[48px] min-w-[48px] px-3 rounded-xl bg-white text-blue-900 font-bold text-lg flex items-center justify-center border border-blue-100 hover:bg-blue-100 active:scale-95 transition-transform"
          aria-label="Make larger"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {/* Color switch for text & ticks */}
      {(annotation.type === 'text' || annotation.type === 'tick') && (
        <button
          type="button"
          onClick={() => onToggleColor(annotation.color === 'black' ? 'blue' : 'black')}
          className="min-h-[50px] px-3.5 rounded-2xl bg-blue-50 border border-blue-200 text-base font-bold text-blue-950 flex items-center gap-2 hover:bg-blue-100 active:scale-95 transition-transform whitespace-nowrap shrink-0"
          aria-label="Switch ink color"
        >
          <span
            className={`w-4 h-4 rounded-full border border-blue-200 ${
              annotation.color === 'blue' ? 'bg-blue-700' : 'bg-slate-900'
            }`}
          />
          <span className="hidden sm:inline">
            {annotation.color === 'blue' ? 'Blue' : 'Black'}
          </span>
        </button>
      )}

      {/* Delete & Done */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onDelete}
          className="min-h-[50px] min-w-[50px] px-3.5 rounded-2xl bg-white border-2 border-blue-200 text-blue-900 font-bold text-base flex items-center justify-center gap-1.5 hover:bg-blue-50 active:scale-95 transition-transform whitespace-nowrap"
          aria-label="Delete selected item"
        >
          <Trash2 className="w-5 h-5 text-blue-700" />
          <span className="hidden sm:inline">Delete</span>
        </button>

        <button
          type="button"
          onClick={onDone}
          className="min-h-[50px] px-5 rounded-2xl bg-blue-600 text-white font-bold text-base flex items-center justify-center gap-1.5 shadow-md shadow-blue-600/20 hover:bg-blue-700 active:scale-95 transition-transform whitespace-nowrap"
        >
          <Check className="w-5 h-5" />
          Done
        </button>
      </div>
    </div>
  );
};
