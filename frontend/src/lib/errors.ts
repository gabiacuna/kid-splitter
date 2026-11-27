import axios from 'axios';
import { translate } from '../i18n';

/** Helpers for reading axios errors without `as` casts at every call site. */

export function httpStatus(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined;
}

/** The request was cancelled on purpose (AbortController). */
export function isCancelled(err: unknown): boolean {
  return axios.isCancel(err) || (axios.isAxiosError(err) && err.code === 'ERR_CANCELED');
}

/** Timed out (our own axios timeout). */
export function isTimeout(err: unknown): boolean {
  return axios.isAxiosError(err) && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT');
}

/** No response at all: offline, server down, DNS, CORS, timeout. Not a cancellation. */
export function isNetworkError(err: unknown): boolean {
  return axios.isAxiosError(err) && !err.response && !isCancelled(err);
}

/** FastAPI `detail`: a string, or `{code, message}` for errors the UI maps itself. */
export function errorDetail(err: unknown): unknown {
  return axios.isAxiosError(err) ? (err.response?.data as { detail?: unknown } | undefined)?.detail : undefined;
}

export function errorCode(err: unknown): string | undefined {
  const d = errorDetail(err);
  return d && typeof d === 'object' && 'code' in d ? String((d as { code: unknown }).code) : undefined;
}

/** One plain sentence for a failed load: connection problem vs anything else. */
export function loadErrorMessage(err: unknown, fallback = 'We couldn’t load this.'): string {
  if (isNetworkError(err)) return translate('We can’t reach the server. Check your connection.');
  return translate(fallback);
}
