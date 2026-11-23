import api from './api';

/** Filename from Content-Disposition, preferring the RFC 5987 form. */
function downloadName(header: string | undefined, fallback: string) {
  const star = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (star) { try { return decodeURIComponent(star); } catch { /* fall through */ } }
  return header?.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}

/** Download a file from the API. Fetched as a blob rather than a bare link so an
 *  expired access token is refreshed by the api client first. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const res = await api.get(path, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName(res.headers['content-disposition'], fallbackName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
