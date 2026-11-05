/**
 * Our catalogue API allows browser CORS. On Android, avoid sending its large
 * index responses through Capacitor's local HTTP proxy: the browser can stream,
 * cancel and cache these immutable requests directly. Provider transport is
 * unchanged, and older Capacitor builds fall back to their normal fetch.
 */
export function fetchWithCatalogueTransport(url, options, { apiBase = '', enabled = true, scope = globalThis } = {}) {
  let request = scope.fetch;
  if (enabled && scope.Capacitor?.isNativePlatform?.() === true && typeof scope.CapacitorWebFetch === 'function') {
    try {
      const target = new URL(url, scope.location?.href);
      const backend = new URL(apiBase || scope.location?.origin);
      const method = String(options?.method || 'GET').toUpperCase();
      if (target.protocol === 'https:' && !target.username && !target.password && target.origin === backend.origin && target.pathname === '/api/catalogue' && ['GET', 'HEAD'].includes(method)) request = scope.CapacitorWebFetch;
    } catch { /* Unknown or relative configuration keeps the existing transport. */ }
  }
  return request.call(scope, url, options);
}
