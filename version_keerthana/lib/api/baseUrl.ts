/**
 * Backend base URL helpers
 *
 * We standardize on a single public env var contract:
 *   - NEXT_PUBLIC_API_URL: e.g. "http://localhost:3001" or "https://api.example.com"
 *
 * Notes:
 * - This module is safe to import from both server (route handlers) and client code.
 * - We intentionally do NOT bake ports/localhost into callsites; only the fallback remains.
 */

/**
 * PUBLIC_INTERFACE
 * Resolve the backend origin (no trailing slash, no `/api` suffix).
 *
 * @returns Backend origin like "http://localhost:3001"
 */
export function getBackendOrigin(): string {
  // Prefer the single contract env var
  const fromEnv = process.env.NEXT_PUBLIC_API_URL;

  // Keep a local-dev fallback to avoid runtime crashes if env isn't provided.
  // (This does not change UI/UX; it preserves existing behavior.)
  const origin = (fromEnv || 'http://localhost:3001').replace(/\/+$/, '');

  return origin;
}

/**
 * PUBLIC_INTERFACE
 * Resolve the backend API base URL (ensures `/api` suffix).
 *
 * @returns Backend API base URL like "http://localhost:3001/api"
 */
export function getBackendApiBaseUrl(): string {
  const origin = getBackendOrigin();
  return origin.includes('/api') ? origin : `${origin}/api`;
}
