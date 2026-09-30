/**
 * Recibo en PDF en el navegador: se descarga con el token en la cabecera y se entrega como archivo
 * (el enlace directo no sirve porque la API exige `Authorization`).
 */
import { ApiError } from '../api/client.ts';
import { type DownloadReceipt, receiptFilename } from './receipt-file.types.ts';

export const downloadReceipt: DownloadReceipt = async ({ api, sessionId, number }) => {
  const response = await fetch(api.url(`/sessions/${sessionId}/receipt?format=pdf`), {
    headers: { ...(await api.authHeaders()), accept: 'application/pdf' },
  });
  if (!response.ok) throw new ApiError(response.status, `HTTP_${response.status}`, 'receipt');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = receiptFilename(number);
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
};
