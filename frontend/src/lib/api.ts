import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_URL || '/api';
/** Default request timeout. Long calls (solve) pass their own `timeout`. */
export const DEFAULT_TIMEOUT_MS = 20_000;
export const SOLVE_TIMEOUT_MS = 60_000;

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  timeout: DEFAULT_TIMEOUT_MS,
});

/** No response at all (offline, server down, timeout): the connection banner listens for this. */
export const NETWORK_ERROR_EVENT = 'api:network-error';
export const NETWORK_OK_EVENT = 'api:network-ok';

let isRefreshing = false;
let failedQueue: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];

function processQueue(error: unknown) {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(null);
  });
  failedQueue = [];
}

api.interceptors.response.use(
  (res) => { window.dispatchEvent(new Event(NETWORK_OK_EVENT)); return res; },
  async (error) => {
    if (!error.response && !axios.isCancel(error) && error.code !== 'ERR_CANCELED') {
      window.dispatchEvent(new Event(NETWORK_ERROR_EVENT));
    } else if (error.response) {
      window.dispatchEvent(new Event(NETWORK_OK_EVENT)); // the server answered, even if with an error
    }
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && original.url !== '/auth/refresh' && original.url !== '/auth/login' && original.url !== '/auth/me') {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(() => api(original)).catch((e) => Promise.reject(e));
      }
      original._retry = true;
      isRefreshing = true;
      try {
        await api.post('/auth/refresh');
        processQueue(null);
        return api(original);
      } catch (refreshError) {
        processQueue(refreshError);
        window.dispatchEvent(new Event('auth:logout'));
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  }
);

export default api;
