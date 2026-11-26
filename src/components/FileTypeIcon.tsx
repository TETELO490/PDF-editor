import React from 'react';
import type { DocumentKind } from '../utils/recentFilesDb';

interface FileTypeIconProps {
  kind: DocumentKind;
}

export const FileTypeIcon: React.FC<FileTypeIconProps> = ({ kind }) => {
  if (kind === 'word') {
    return (
      <div
        className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex flex-col items-center justify-center shrink-0 shadow-sm border border-blue-700"
        aria-label="Word document"
      >
        <span className="text-xl font-extrabold leading-none tracking-tight">W</span>
      </div>
    );
  }

  return (
    <div
      className="w-12 h-12 rounded-2xl bg-white text-blue-700 flex flex-col items-center justify-center shrink-0 border-2 border-blue-600 shadow-sm"
      aria-label="PDF document"
    >
      <span className="text-sm font-extrabold leading-none tracking-tight">PDF</span>
    </div>
  );
};
