import {
  type RoomHistoryDetailResponse,
  roomSummaryCsv,
  roomSummaryFileName,
  roomSummaryMarkdown,
} from '@planning-poker/shared';

/**
 * Handing a room's summary to the person looking at it.
 *
 * The file is built in the browser from the payload `GET /rooms/:code/rounds` already returned,
 * using the shared formatters — so the export cannot show a number the server did not send, and
 * there is no second endpoint whose authorisation could drift from the history one. Everything
 * that decides *content* lives in `packages/shared`; everything here is the browser plumbing
 * around it, split out from the component so the download's name, type and payload can be
 * asserted without rendering anything.
 */

export type ExportFormat = 'csv' | 'md';

export interface ExportFile {
  fileName: string;
  /** What the Blob is labelled as; `charset=utf-8` matters for the Vietnamese headers. */
  mimeType: string;
  content: string;
}

const MIME_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
};

/** The exported file, ready to be saved or copied. Pure: no DOM, no clipboard. */
export function roomSummaryFile(
  detail: RoomHistoryDetailResponse,
  format: ExportFormat,
): ExportFile {
  return {
    fileName: roomSummaryFileName(detail.room, format),
    mimeType: MIME_TYPES[format],
    content: format === 'csv' ? roomSummaryCsv(detail) : roomSummaryMarkdown(detail),
  };
}

/**
 * Saves a generated file, the only way a page can without a server round trip.
 *
 * The object URL is revoked on the next frame rather than immediately: Safari reads the blob
 * after the click handler returns, and revoking synchronously gives it an empty download.
 */
export function downloadFile(file: ExportFile): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Puts the Markdown summary on the clipboard, for pasting into a ticket.
 *
 * `navigator.clipboard` is unavailable over plain HTTP on a non-localhost host, which is exactly
 * how this app is reached on a LAN — so a failure here is expected rather than exceptional, and
 * the caller is told so it can offer the download instead of showing nothing.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
