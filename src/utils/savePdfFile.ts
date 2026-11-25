import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...chunk));
  }
  return btoa(parts.join(''));
}

/**
 * Saves or shares the filled PDF reliably on both Web browsers and
 * native Android/iOS Capacitor apps.
 */
export async function savePdfToDevice(
  bytes: Uint8Array,
  outputFileName: string
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const base64Data = uint8ArrayToBase64(bytes);
    const saved = await Filesystem.writeFile({
      path: outputFileName,
      data: base64Data,
      directory: Directory.Cache,
    });

    await Share.share({
      title: outputFileName,
      url: saved.uri,
      dialogTitle: 'Save or Share Filled PDF',
    });
    return;
  }

  const blob = new Blob([new Uint8Array(bytes)], {
    type: 'application/pdf',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = outputFileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
