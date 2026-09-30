import type { ApiClient } from '../api/client.ts';

/** Nombre del archivo del recibo (igual que el `content-disposition` de la API). */
export function receiptFilename(number: string): string {
  return `recibo-${number.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`;
}

export interface DownloadReceiptInput {
  api: ApiClient;
  sessionId: string;
  /** Número del recibo o de la sesión, para el nombre del archivo. */
  number: string;
  /** Título del diálogo de compartir (nativo). */
  title: string;
}

/** `saved`: quedó en las descargas del navegador; `shared`: se abrió la hoja de compartir del sistema. */
export type DownloadReceipt = (input: DownloadReceiptInput) => Promise<'saved' | 'shared'>;
