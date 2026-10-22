// Appearance is an explicit user preference; it never follows the OS or browser.
(() => {
  const normalize = value => value === 'dark' ? 'dark' : 'light';
  let revision = 0;

  function apply(value) {
    const theme = normalize(value);
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeReady = '';
    document.querySelectorAll('input[name="appearanceTheme"]').forEach(input => { input.checked = input.value === theme; });
    return theme;
  }

  const ready = chrome.storage.local.get(['appearanceTheme'])
    .then(settings => { if (revision === 0) apply(settings.appearanceTheme); })
    .catch(() => { if (revision === 0) apply('light'); });

  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes.appearanceTheme) {
      revision++;
      apply(changes.appearanceTheme.newValue);
    }
  });
  document.addEventListener('DOMContentLoaded', () => ready.then(() => apply(document.documentElement.dataset.theme)));

  globalThis.GuideMeTheme = {
    ready,
    getCurrent: () => normalize(document.documentElement.dataset.theme),
    async set(value) {
      const previous = this.getCurrent();
      const version = ++revision;
      const theme = apply(value);
      try { await chrome.storage.local.set({ appearanceTheme: theme }); }
      catch (error) {
        if (revision === version) apply(previous);
        throw error;
      }
    }
  };
})();
