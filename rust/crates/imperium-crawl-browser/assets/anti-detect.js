// Anti-detection overrides injected on every new document via
// Page.addScriptToEvaluateOnNewDocument (CDP).
// Mirrors the minimal stealth shims used by the TS port at
// ../../src/stealth/browser.ts. Kept intentionally small — heavier
// fingerprint patching is handled by L2 (TLS) and L4 (CamoFox).
(() => {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  } catch (e) { /* defineProperty may throw on locked builds */ }
  try {
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  } catch (e) { /* noop */ }
  try {
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  } catch (e) { /* noop */ }
  // Chrome runtime stub — many bot detectors check window.chrome
  try {
    if (!window.chrome) {
      window.chrome = { runtime: {} };
    }
  } catch (e) { /* noop */ }
  // permissions.query stub — some detectors invoke this with 'notifications'
  try {
    const originalQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) =>
        parameters && parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
    }
  } catch (e) { /* noop */ }
})();
