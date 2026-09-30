/**
 * Recibo en PDF en iOS y Android: se descarga a la caché con el token y se abre la hoja de
 * compartir del sistema (guardar en Archivos, enviar por correo o WhatsApp). expo-sharing es un
 * módulo nativo: hace falta una compilación de EAS posterior al 30-09-2026 (en Expo Go ya está).
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { type DownloadReceipt, receiptFilename } from './receipt-file.types.ts';

export const downloadReceipt: DownloadReceipt = async ({ api, sessionId, number, title }) => {
  const destination = new File(Paths.cache, receiptFilename(number));
  const file = await File.downloadFileAsync(
    api.url(`/sessions/${sessionId}/receipt?format=pdf`),
    destination,
    { headers: { ...(await api.authHeaders()), accept: 'application/pdf' }, idempotent: true },
  );
  if (!(await Sharing.isAvailableAsync())) throw new Error('sharing unavailable');
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: title,
  });
  return 'shared';
};
