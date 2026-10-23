(() => {
  'use strict';
  const KEY = 'kaila-settings';
  const defaults = { theme: 'light', fontSize: 'medium' };
  let settings = { ...defaults };
  try { settings = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (_) {}
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  function apply() {
    document.documentElement.dataset.theme = settings.theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.fontSize = ['small', 'medium', 'large'].includes(settings.fontSize) ? settings.fontSize : 'medium';
    $$('[data-font]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.font === document.documentElement.dataset.fontSize)));
    const dark = document.documentElement.dataset.theme === 'dark';
    $$('.theme-toggle').forEach((toggle) => {
      toggle.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      toggle.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
      const label = $('.theme-label', toggle);
      if (label) label.textContent = dark ? 'Light mode' : 'Dark mode';
    });
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (_) {} }
  $$('[data-font]').forEach((button) => button.addEventListener('click', () => {
    if (!['small', 'medium', 'large'].includes(button.dataset.font)) return;
    settings.fontSize = button.dataset.font; persist(); apply();
  }));
  $$('.theme-toggle').forEach((button) => button.addEventListener('click', () => {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark'; persist(); apply();
  }));
  window.KailaSettings = { get: () => ({ ...settings }), set: (patch) => { settings = { ...settings, ...patch }; persist(); apply(); } };
  apply();
})();
