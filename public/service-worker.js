// Minimal service worker — required for PWA installability on Android Chrome.
// This doesn't cache anything; it just satisfies Chrome's requirement so the
// app opens in standalone mode (no browser bar) when launched from home screen.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
