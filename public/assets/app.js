(() => {
  'use strict';

  const DB_NAME = 'kaila-local-v1';
  const DB_VERSION = 1;
  const KV_STORE = 'kv';
  const WARDROBE_STORE = 'wardrobe';
  const DEFAULT_PROFILE = {
    displayName: '', market: 'CA', total_budget: 180, per_item_budget: 60, audience: 'all', fit: 'balanced',
    showNotes: '', screenStyles: [], aesthetics: ['Minimal and modern', 'Classic and polished'],
    occasions: ['Everyday'], colours: ['Black', 'Cream', 'Navy'], colour_notes: '', scentFamilies: ['Fresh', 'Woody'],
    hasCompletedQuiz: false, selectedStyleId: ''
  };
  const TITLES = {
    discover: ['Discover', 'Find the feeling behind the look.'], ensemble: ['Ensemble', 'Make inspiration wearable.'],
    'try-on': ['Virtual try-on', 'Preview a style reference on your photo.'], skin: ['Skin analysis', 'Understand visible skin signals.'],
    'colour-tone': ['Colour tone', 'Use detected colours as optional styling guidance.'], wardrobe: ['My wardrobe', 'Make your existing pieces part of the plan.'],
    saved: ['Saved styles', 'Keep the references and looks you want to revisit.'], quiz: ['Style quiz', 'Build the profile that guides your recommendations.'],
    settings: ['Settings', 'Adjust your display and manage local data.']
  };
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const state = {
    db: null, profile: { ...DEFAULT_PROFILE }, catalog: { items: [], screen_styles: [], style_options: [], occasions: [], colours: [], scent_families: [] },
    currentView: 'discover', currentRecommendations: [], savedStyleIds: [], savedItemIds: [], savedLooks: [], wardrobeItems: [],
    cachedPhotos: { tryOn: null, skin: null, colorTone: null }, selectedTryOnItem: null, tryOnResultUrl: '', requestId: 0, recommendationsLoading: false
  };

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('This browser does not support local profile storage.'));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(WARDROBE_STORE)) db.createObjectStore(WARDROBE_STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Local profile storage could not be opened.'));
    });
  }
  function dbRequest(storeName, method, value) {
    return new Promise((resolve, reject) => {
      if (!state.db) return reject(new Error('Local profile storage is not ready.'));
      const transaction = state.db.transaction(storeName, method === 'get' || method === 'getAll' ? 'readonly' : 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = method === 'getAll' ? store.getAll() : method === 'clear' ? store.clear() : method === 'delete' ? store.delete(value) : method === 'get' ? store.get(value) : store.put(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not update local storage.'));
    });
  }
  async function getKV(key, fallback = null) { const row = await dbRequest(KV_STORE, 'get', key); return row ? row.value : fallback; }
  async function putKV(key, value) { return dbRequest(KV_STORE, 'put', { key, value }); }
  async function saveProfile() { await putKV('profile', state.profile); }
  async function loadLocalState() {
    state.db = await openDatabase();
    state.profile = { ...DEFAULT_PROFILE, ...(await getKV('profile', {})) };
    state.savedStyleIds = await getKV('savedStyleIds', []);
    state.savedItemIds = await getKV('savedItemIds', []);
    state.savedLooks = await getKV('savedLooks', []);
    state.cachedPhotos = { ...state.cachedPhotos, ...(await getKV('cachedPhotos', {})) };
    state.wardrobeItems = await dbRequest(WARDROBE_STORE, 'getAll');
    state.wardrobeItems.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  }
  async function safeLocalSave(action) {
    try { await action(); } catch (error) { showAlert(error?.message || 'Could not save this change in your browser.', 'error'); }
  }
  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  }
  function showAlert(message, type = 'info') {
    const target = $('#app-alert');
    if (!target) return;
    target.textContent = message;
    target.className = `app-alert${type === 'error' ? ' is-error' : type === 'success' ? ' is-success' : ''}`;
    target.hidden = false;
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function hideAlert() { const target = $('#app-alert'); if (target) target.hidden = true; }
  function setStatus(selector, message, type = '') {
    const target = $(selector);
    if (!target) return;
    target.textContent = message || '';
    target.className = `feature-status${type ? ` is-${type}` : ''}`;
  }
  function csrfToken() { return $('meta[name="csrf-token"]')?.content || ''; }
  async function apiFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('X-CSRF-Token', csrfToken());
    const response = await fetch(url, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || 'The request could not be completed. Try again.');
    return body;
  }
  async function loadCatalog() {
    const response = await fetch('/api/catalog', { cache: 'no-store' });
    if (!response.ok) throw new Error('Style references could not be loaded. Refresh the page to retry.');
    state.catalog = await response.json();
    return state.catalog;
  }
  function marketLabel() { return state.profile.market === 'US' ? 'United States · USD' : 'Canada · CAD'; }
  function moneyCode() { return state.profile.market === 'US' ? 'USD' : 'CAD'; }
  function numberOrNull(value) { if (value === '' || value === undefined || value === null) return null; const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; }
  function updateIdentityAndMarket() {
    const label = state.profile.displayName?.trim() || 'Your style profile';
    const name = $('#sidebar-profile-name'); if (name) name.textContent = label;
    const pill = $('#market-pill'); if (pill) pill.textContent = marketLabel();
    const total = $('#ensemble-total-budget');
    if (total) total.textContent = state.profile.total_budget != null && state.profile.total_budget !== '' ? `${moneyCode()} ${Number(state.profile.total_budget).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'Not set';
    const market = $('#ensemble-market-summary'); if (market) market.textContent = marketLabel();
  }
  function updateCounts() {
    const wardrobeCount = $('#wardrobe-count'); if (wardrobeCount) wardrobeCount.textContent = String(state.wardrobeItems.length);
    const savedCount = $('#saved-count'); if (savedCount) savedCount.textContent = String(new Set([...state.savedStyleIds, ...state.savedItemIds]).size + state.savedLooks.length);
  }
  function switchView(view, options = {}) {
    if (!TITLES[view]) view = 'discover';
    state.currentView = view;
    hideAlert();
    $$('[data-view-panel]').forEach(panel => { panel.hidden = panel.dataset.viewPanel !== view; panel.classList.toggle('is-active', panel.dataset.viewPanel === view); });
    $$('[data-view]').forEach(button => { button.classList.toggle('is-active', button.dataset.view === view); if (button.closest('.mobile-nav')) button.setAttribute('aria-current', button.dataset.view === view ? 'page' : 'false'); });
    const [title] = TITLES[view];
    const titleEl = $('#page-title'); if (titleEl) titleEl.textContent = title;
    document.title = `Kaila — ${title}`;
    if (view === 'ensemble' && !options.skipLoad) loadRecommendations();
    if (view === 'wardrobe') renderWardrobe();
    if (view === 'saved') renderSaved();
    if (view === 'discover') renderFragrancePreview();
    if (view === 'settings') renderSettingsStatus();
    if (options.scroll !== false) window.scrollTo({ top: 0, behavior: 'auto' });
    syncTryOnSelection();
  }
  function itemImageFallback(img) {
    const media = img.closest('.screen-card-media, .catalog-media, .wardrobe-item-media, .tryon-reference-preview');
    if (media) {
      img.remove();
      media.classList.add('image-fallback');
      const copy = media.dataset.fallback || media.querySelector('[data-fallback-copy]')?.textContent || 'Style inspiration';
      if (!media.querySelector('.image-fallback-label')) {
        const label = document.createElement('span'); label.className = 'image-fallback-label'; label.textContent = copy; media.appendChild(label);
      }
    } else img.remove();
  }
  function safeImage(url, alt, lazy = true) {
    const img = document.createElement('img');
    img.src = url; img.alt = alt; img.loading = lazy ? 'lazy' : 'eager'; img.decoding = 'async';
    img.addEventListener('error', () => itemImageFallback(img), { once: true });
    return img;
  }
  function styleCard(style, saved = false) {
    const article = document.createElement('article'); article.className = 'screen-card';
    const media = document.createElement('div'); media.className = `screen-card-media art-${style.art_direction || 'stone'}`; media.dataset.fallback = style.title;
    media.appendChild(safeImage(style.image_url, `Fashion inspiration for ${style.title}`));
    const copy = document.createElement('div'); copy.className = 'screen-card-copy';
    const kind = document.createElement('p'); kind.className = 'card-kind'; kind.textContent = style.kind || 'Style inspiration';
    const title = document.createElement('h3'); title.textContent = style.title;
    const description = document.createElement('p'); description.textContent = style.description;
    const actions = document.createElement('div'); actions.className = 'card-actions';
    const use = document.createElement('button'); use.type = 'button'; use.className = 'button button-primary'; use.dataset.useStyle = style.id; use.textContent = 'Make it mine';
    const save = document.createElement('button'); save.type = 'button'; save.className = 'icon-button'; save.dataset.saveStyle = style.id; save.setAttribute('aria-label', saved ? `Remove ${style.title} from saved styles` : `Save ${style.title}`); save.setAttribute('aria-pressed', String(saved)); save.textContent = saved ? '♥' : '♡';
    actions.append(use, save);
    const source = document.createElement('a'); source.className = 'card-link'; source.href = style.source_url; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = 'Style references ↗';
    copy.append(kind, title, description, actions, source); article.append(media, copy); return article;
  }
  function renderDiscover() {
    const grid = $('#screen-style-grid'); if (!grid) return;
    grid.replaceChildren();
    state.catalog.screen_styles.forEach(style => grid.appendChild(styleCard(style, state.savedStyleIds.includes(style.id))));
    const sources = $('#style-source-links');
    if (sources) {
      sources.replaceChildren();
      (state.catalog.style_sources || []).forEach(source => {
        const card = document.createElement('article'); card.className = 'source-link-card';
        const name = document.createElement('h3'); name.textContent = source.name;
        const description = document.createElement('p'); description.textContent = source.description;
        const link = document.createElement('a'); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open source ↗';
        card.append(name, description, link); sources.appendChild(card);
      });
    }
    const showChoices = $('#quiz-show-choices');
    if (showChoices) {
      showChoices.replaceChildren();
      state.catalog.screen_styles.forEach(style => {
        const label = document.createElement('label'); label.className = 'choice-card';
        const input = document.createElement('input'); input.type = 'checkbox'; input.name = 'quiz-screen-style'; input.value = style.id; input.checked = (state.profile.screenStyles || []).includes(style.id);
        const span = document.createElement('span'); span.textContent = style.title;
        label.append(input, span); showChoices.appendChild(label);
      });
    }
    const select = $('#ensemble-style'); const tryonSelect = $('#tryon-style-select');
    if (select) {
      const current = select.value || state.profile.selectedStyleId || state.profile.screenStyles?.[0] || '';
      select.replaceChildren(new Option('No selected reference', ''));
      state.catalog.screen_styles.forEach(style => select.add(new Option(style.title, style.id)));
      select.value = state.catalog.screen_styles.some(s => s.id === current) ? current : '';
    }
    if (tryonSelect) {
      const current = tryonSelect.value || state.profile.selectedStyleId || state.profile.screenStyles?.[0] || state.catalog.screen_styles[0]?.id || '';
      tryonSelect.replaceChildren();
      const references = document.createElement('optgroup'); references.label = 'Screen-style references';
      state.catalog.screen_styles.forEach(style => references.appendChild(new Option(style.title, style.id)));
      const garments = document.createElement('optgroup'); garments.label = 'Individual style pieces';
      state.catalog.items.forEach(item => garments.appendChild(new Option(item.name, `item:${item.id}`)));
      tryonSelect.append(references, garments);
      tryonSelect.value = current;
      if (!tryonSelect.value) tryonSelect.value = state.catalog.screen_styles[0]?.id || '';
    }
    renderQuizChoices(); syncTryOnSelection();
  }
  function renderQuizChoices() {
    const configs = [
      ['#quiz-aesthetics', 'aesthetics', state.catalog.style_options || []],
      ['#quiz-occasions', 'occasions', state.catalog.occasions || []],
      ['#quiz-colours', 'colours', state.catalog.colours || []],
      ['#quiz-scents', 'scentFamilies', state.catalog.scent_families || []]
    ];
    configs.forEach(([selector, key, values]) => {
      const target = $(selector); if (!target) return; target.replaceChildren();
      const current = state.profile[key] || [];
      values.forEach(value => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'choice-pill'; button.dataset.choiceKey = key; button.dataset.choiceValue = value;
        button.setAttribute('aria-pressed', String(current.includes(value))); button.textContent = value;
        button.addEventListener('click', () => { button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true')); });
        target.appendChild(button);
      });
    });
    setFormValue('#profile-name', state.profile.displayName);
    setFormValue('#profile-market', state.profile.market || 'CA');
    setFormValue('#profile-total-budget', state.profile.total_budget);
    setFormValue('#profile-item-budget', state.profile.per_item_budget);
    setFormValue('#profile-audience', state.profile.audience || 'all');
    setFormValue('#profile-fit', state.profile.fit || 'balanced');
    setFormValue('#profile-show-notes', state.profile.showNotes);
    setFormValue('#profile-colour-notes', state.profile.colour_notes);
    $('#quiz-show-choices')?.querySelectorAll('input').forEach(input => { input.checked = (state.profile.screenStyles || []).includes(input.value); });
  }
  function setFormValue(selector, value) { const el = $(selector); if (el && value !== undefined && value !== null) el.value = String(value); }
  function getSelectedPills(key) { return $$(`[data-choice-key="${key}"][aria-pressed="true"]`).map(button => button.dataset.choiceValue); }
  function bindQuiz() {
    const form = $('#quiz-form'); if (!form) return;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      state.profile = {
        ...state.profile,
        displayName: $('#profile-name')?.value.trim() || '',
        market: $('#profile-market')?.value === 'US' ? 'US' : 'CA',
        total_budget: numberOrNull($('#profile-total-budget')?.value),
        per_item_budget: numberOrNull($('#profile-item-budget')?.value),
        audience: $('#profile-audience')?.value || 'all', fit: $('#profile-fit')?.value || 'balanced',
        showNotes: $('#profile-show-notes')?.value.trim() || '',
        colour_notes: $('#profile-colour-notes')?.value.trim() || '',
        screenStyles: $$('input[name="quiz-screen-style"]:checked').map(input => input.value),
        aesthetics: getSelectedPills('aesthetics'), occasions: getSelectedPills('occasions'), colours: getSelectedPills('colours'), scentFamilies: getSelectedPills('scentFamilies'),
        hasCompletedQuiz: true
      };
      if (!state.profile.aesthetics.length) state.profile.aesthetics = ['Minimal and modern'];
      if (!state.profile.occasions.length) state.profile.occasions = ['Everyday'];
      updateIdentityAndMarket();
      try {
        await saveProfile();
        const status = $('#quiz-status'); if (status) status.textContent = 'Preferences saved in this browser.';
        switchView('ensemble');
      } catch (error) { const status = $('#quiz-status'); if (status) status.textContent = error.message || 'Could not save profile.'; }
    });
  }
  async function useScreenStyle(id) {
    const style = state.catalog.screen_styles.find(s => s.id === id); if (!style) return;
    state.profile.selectedStyleId = id;
    state.profile.screenStyles = [...new Set([...(state.profile.screenStyles || []), id])];
    await safeLocalSave(saveProfile);
    setFormValue('#ensemble-style', id);
    setFormValue('#tryon-style-select', id);
    switchView('ensemble');
    setTimeout(() => { const field = $('#ensemble-style'); if (field) field.value = id; }, 0);
  }
  async function toggleSavedStyle(id) {
    state.savedStyleIds = state.savedStyleIds.includes(id) ? state.savedStyleIds.filter(item => item !== id) : [...state.savedStyleIds, id];
    await safeLocalSave(() => putKV('savedStyleIds', state.savedStyleIds));
    updateCounts(); renderDiscover();
    if (state.currentView === 'saved') renderSaved();
  }
  async function toggleSavedItem(id) {
    state.savedItemIds = state.savedItemIds.includes(id) ? state.savedItemIds.filter(item => item !== id) : [...state.savedItemIds, id];
    await safeLocalSave(() => putKV('savedItemIds', state.savedItemIds)); updateCounts(); renderRecommendations(state.currentRecommendations);
    if (state.currentView === 'saved') renderSaved();
  }
  async function loadRecommendations() {
    if (state.recommendationsLoading) return;
    state.recommendationsLoading = true;
    const grid = $('#ensemble-grid'); if (grid) grid.innerHTML = '<div class="loading-state">Finding relevant style matches…</div>';
    $('#ensemble-empty').hidden = true;
    const explicitQuery = $('#ensemble-query')?.value.trim() || '';
    const selectedShowStyleNames = state.catalog.screen_styles.filter(item => (state.profile.screenStyles || []).includes(item.id)).map(item => item.title);
    const query = [explicitQuery, state.profile.showNotes || '', ...selectedShowStyleNames].filter(Boolean).join(' ').slice(0, 240);
    const styleId = $('#ensemble-style')?.value || state.profile.selectedStyleId || state.profile.screenStyles?.[0] || '';
    const rawBudget = $('#ensemble-per-item')?.value;
    if (rawBudget !== undefined && rawBudget !== '') state.profile.per_item_budget = numberOrNull(rawBudget);
    updateIdentityAndMarket();
    const currentRequest = ++state.requestId;
    try {
      const result = await apiFetch('/api/recommendations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: state.profile, query, screen_style_id: styleId, limit: 9 })
      });
      if (currentRequest !== state.requestId) return;
      state.currentRecommendations = result.recommendations || [];
      renderRecommendations(state.currentRecommendations);
      const note = $('#ensemble-results-note');
      if (note) note.textContent = result.style_interpretation?.summary || result.explanation || 'Matches selected from Kaila’s curated inspiration catalogue.';
      const title = $('#ensemble-results-title'); if (title) title.textContent = result.selected_style ? `Looks inspired by ${result.selected_style.title}` : 'Style matches';
      if (rawBudget !== undefined && rawBudget !== '') await safeLocalSave(saveProfile);
    } catch (error) {
      if (grid) grid.innerHTML = `<div class="empty-state"><h3>We couldn't load matches.</h3><p>${escapeHTML(error.message)}</p><p>Try again or browse screen-style references in Discover.</p></div>`;
    } finally { state.recommendationsLoading = false; }
  }
  function itemReasonText(item) {
    const reasons = item.match_reasons || [];
    return reasons.length ? reasons.slice(0, 2).join(' · ') : 'Versatile match for your profile';
  }
  function catalogCard(item) {
    const article = document.createElement('article'); article.className = 'catalog-card';
    const media = document.createElement('div'); media.className = 'catalog-media'; media.dataset.fallback = item.name;
    const badge = document.createElement('span'); badge.className = 'catalog-media-badge'; badge.textContent = 'Style inspiration'; media.appendChild(badge);
    media.appendChild(safeImage(item.image_url, item.image_alt || `${item.name} inspiration`));
    const copy = document.createElement('div'); copy.className = 'catalog-copy';
    const kind = document.createElement('p'); kind.className = 'card-kind'; kind.textContent = item.category;
    const title = document.createElement('h3'); title.textContent = item.name;
    const detail = document.createElement('p'); detail.textContent = itemReasonText(item);
    const reasons = document.createElement('div'); reasons.className = 'reason-list';
    (item.colours || []).slice(0, 3).forEach(colour => { const chip = document.createElement('span'); chip.className = 'reason-chip'; chip.textContent = colour; reasons.appendChild(chip); });
    const guide = document.createElement('p'); guide.style.marginTop = '.15rem'; guide.textContent = item.target_guidance || 'Search current listings and confirm seller prices.';
    const actions = document.createElement('div'); actions.className = 'card-actions';
    const shop = document.createElement('a'); shop.className = 'button button-primary'; shop.href = item.retailer_search?.[0]?.url || '#'; shop.target = '_blank'; shop.rel = 'noopener noreferrer'; shop.textContent = 'Search retailers ↗'; shop.setAttribute('aria-label', `Search current retailer listings for ${item.name}`);
    const saved = state.savedItemIds.includes(item.id);
    const save = document.createElement('button'); save.className = 'icon-button'; save.type = 'button'; save.dataset.saveItem = item.id; save.setAttribute('aria-pressed', String(saved)); save.setAttribute('aria-label', saved ? `Remove ${item.name} from saved styles` : `Save ${item.name}`); save.textContent = saved ? '♥' : '♡';
    const tryOn = document.createElement('button'); tryOn.className = 'button button-secondary'; tryOn.type = 'button'; tryOn.dataset.tryItem = item.id; tryOn.textContent = 'Try on';
    actions.append(shop, save, tryOn);
    const extraLinks = document.createElement('div'); extraLinks.className = 'retailer-list';
    (item.retailer_search || []).slice(1).forEach(link => { const a = document.createElement('a'); a.href = link.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = link.label + ' ↗'; extraLinks.appendChild(a); });
    copy.append(kind, title, detail, reasons, guide, actions, extraLinks); article.append(media, copy); return article;
  }
  function renderOwnedMatches() {
    const old = $('#owned-match-banner');
    if (old) old.remove();
    const root = $('#ensemble-grid'); if (!root || !state.wardrobeItems.length || !state.currentRecommendations.length) return;
    const terms = value => new Set(String(value || '').toLowerCase().match(/[a-z0-9]+/g) || []);
    const matches = state.wardrobeItems.filter(owned => state.currentRecommendations.some(candidate => {
      const ownTerms = new Set([...terms(owned.name), ...terms(owned.category), ...terms(owned.colours)]);
      const candidateTerms = new Set([...terms(candidate.name), ...terms(candidate.category), ...terms((candidate.colours || []).join(' ')), ...terms(candidate.query)]);
      let common = 0; ownTerms.forEach(term => { if (candidateTerms.has(term) && term.length > 2) common += 1; });
      return common > 0;
    })).slice(0, 4);
    if (!matches.length) return;
    const wrap = document.createElement('section'); wrap.id = 'owned-match-banner'; wrap.className = 'discovery-callout';
    const mark = document.createElement('div'); mark.className = 'callout-mark'; mark.textContent = '↗';
    const copy = document.createElement('div'); const heading = document.createElement('h3'); heading.textContent = 'Pieces you may already own'; const p = document.createElement('p'); p.textContent = `${matches.map(item => item.name).join(', ')} share category or colour terms with these style matches. Check your saved pieces before buying something new.`; copy.append(heading, p);
    const button = document.createElement('button'); button.className = 'button button-outline'; button.type = 'button'; button.dataset.view = 'wardrobe'; button.textContent = 'Open wardrobe';
    wrap.append(mark, copy, button); root.parentElement.insertBefore(wrap, root);
  }
  function renderRecommendations(items) {
    const grid = $('#ensemble-grid'); if (!grid) return;
    grid.replaceChildren();
    if (!items?.length) { $('#ensemble-empty').hidden = false; $('#ensemble-count').textContent = '0 matches'; return; }
    $('#ensemble-empty').hidden = true;
    items.forEach(item => grid.appendChild(catalogCard(item)));
    $('#ensemble-count').textContent = `${items.length} ${items.length === 1 ? 'match' : 'matches'}`;
    renderOwnedMatches();
  }
  function bindEnsemble() {
    $('#ensemble-form')?.addEventListener('submit', async event => { event.preventDefault(); await loadRecommendations(); });
  }
  function syncTryOnSelection() {
    const select = $('#tryon-style-select'); const preview = $('#tryon-reference-preview'); if (!select || !preview || !state.catalog.screen_styles.length) return;
    let reference = state.catalog.screen_styles.find(item => item.id === select.value);
    if (!reference && select.value.startsWith('item:')) reference = state.catalog.items.find(item => `item:${item.id}` === select.value);
    if (!reference) reference = state.catalog.screen_styles[0];
    state.selectedTryOnItem = reference;
    if (state.catalog.screen_styles.some(item => item.id === reference.id)) state.profile.selectedStyleId = reference.id;
    preview.replaceChildren(); preview.dataset.fallback = reference.title || reference.name;
    preview.appendChild(safeImage(reference.image_url, `Style reference: ${reference.title || reference.name}`, false));
    const note = document.createElement('p'); note.textContent = `${reference.title || reference.name} · ${reference.description || `Search for similar ${reference.category?.toLowerCase() || 'style'} pieces.`}`; note.style.cssText = 'padding:.65rem .8rem;margin:0;font-size:.76rem;color:var(--ink-soft);'; preview.appendChild(note);
  }
  function fileAsBlobRecord(file) { return file ? { blob: file, name: file.name, type: file.type, savedAt: Date.now() } : null; }
  async function savePhoto(key, file) {
    if (!file) return;
    const record = fileAsBlobRecord(file); state.cachedPhotos[key] = record;
    await putKV('cachedPhotos', state.cachedPhotos);
    renderPhotoMemory(key);
  }
  function cachedPhotoFor(key, inputSelector) {
    const file = $(inputSelector)?.files?.[0]; if (file) return file;
    const row = state.cachedPhotos[key];
    if (row?.blob) return new File([row.blob], row.name || 'saved-photo.jpg', { type: row.type || row.blob.type || 'image/jpeg' });
    return null;
  }
  function renderPhotoMemory(key) {
    const map = { tryOn: '#tryon-photo-memory', skin: '#skin-photo-memory', colorTone: '#tone-photo-memory' };
    const target = $(map[key]); if (!target) return;
    target.replaceChildren(); const stored = state.cachedPhotos[key];
    if (!stored?.blob) return;
    const row = document.createElement('div'); row.className = 'stored-photo-line';
    const copy = document.createElement('span'); copy.textContent = `Saved in this browser: ${stored.name || 'photo'} (will only be sent after consent and action)`;
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'text-link'; clear.textContent = 'Remove'; clear.addEventListener('click', async () => { state.cachedPhotos[key] = null; await putKV('cachedPhotos', state.cachedPhotos); renderPhotoMemory(key); });
    row.append(copy, clear); target.appendChild(row);
  }
  function bindPhotoInputs() {
    [['#tryon-photo', 'tryOn'], ['#skin-photo', 'skin'], ['#tone-photo', 'colorTone']].forEach(([selector, key]) => {
      $(selector)?.addEventListener('change', event => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!['image/jpeg', 'image/png', 'image/jpg'].includes(file.type) || file.size > 9_500_000) {
          event.target.value = ''; showAlert('Choose a JPG, JPEG or PNG image under 9.5 MB.', 'error'); return;
        }
        safeLocalSave(() => savePhoto(key, file));
      });
    });
  }
  async function pollTask(feature, taskId, onUpdate) {
    const maxAttempts = 18;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 1200 : 3500));
      const result = await apiFetch(`/api/tasks/${feature}/${encodeURIComponent(taskId)}`);
      if (result.status === 'success' || result.status === 'error') return result;
      onUpdate?.(`Processing image… (${attempt + 1}/${maxAttempts})`);
    }
    throw new Error('This image request is taking longer than expected. Try again later.');
  }
  async function startTryOn() {
    const file = cachedPhotoFor('tryOn', '#tryon-photo');
    if (!file) { setStatus('#tryon-status', 'Choose a full-body photo first.', 'error'); $('#tryon-photo')?.focus(); return; }
    if (!$('#tryon-consent')?.checked) { setStatus('#tryon-status', 'Please confirm consent before sending your photos.', 'error'); $('#tryon-consent')?.focus(); return; }
    const selection = $('#tryon-style-select')?.value || '';
    const style = state.catalog.screen_styles.find(item => item.id === selection)
      || state.catalog.items.find(item => `item:${item.id}` === selection)
      || state.catalog.screen_styles[0];
    if (!style) { setStatus('#tryon-status', 'Choose a style reference first.', 'error'); return; }
    const button = $('#run-tryon'); button.disabled = true; setStatus('#tryon-status', 'Uploading the selected photos and starting virtual try-on…');
    $('#tryon-result').innerHTML = '<div class="result-placeholder"><span class="result-placeholder-mark">K</span><p>Waiting for the generated image…</p></div>'; $('#save-tryon-result').hidden = true;
    try {
      const form = new FormData(); form.append('photo', file, file.name || 'my-photo.jpg'); form.append('consent', 'true'); form.append('item_image_url', style.image_url); form.append('garment_category', 'auto');
      const started = await apiFetch('/api/try-on', { method: 'POST', body: form });
      const result = await pollTask('try-on', started.task_id, message => setStatus('#tryon-status', message));
      if (result.status !== 'success' || !result.image_url) throw new Error(result.message || 'No usable result image was returned.');
      state.tryOnResultUrl = result.image_url;
      const container = $('#tryon-result'); container.replaceChildren();
      const img = safeImage(result.image_url, `Virtual try-on result based on ${style.title || style.name}`, false); img.loading = 'eager'; container.appendChild(img);
      img.addEventListener('error', () => { container.innerHTML = '<div class="result-placeholder"><span class="result-placeholder-mark">K</span><p>The generated image could not be displayed. Try again with another photo.</p></div>'; $('#save-tryon-result').hidden = true; });
      $('#save-tryon-result').hidden = false; setStatus('#tryon-status', 'Your virtual try-on is ready. The result link may expire according to the image service’s retention policy.', 'success');
    } catch (error) { setStatus('#tryon-status', error.message || 'Virtual try-on could not be completed.', 'error'); $('#tryon-result').innerHTML = `<div class="result-placeholder"><span class="result-placeholder-mark">!</span><p>${escapeHTML(error.message || 'Virtual try-on could not be completed.')}</p></div>`; }
    finally { button.disabled = false; }
  }
  function bindTryOn() {
    $('#tryon-style-select')?.addEventListener('change', syncTryOnSelection);
    $('#run-tryon')?.addEventListener('click', startTryOn);
    $('#save-tryon-result')?.addEventListener('click', async () => {
      const style = state.selectedTryOnItem;
      if (!state.tryOnResultUrl || !style) return;
      const styleName = style.title || style.name || 'Selected style';
      const record = { id: `tryon-${Date.now()}`, title: `${styleName} try-on`, description: `Virtual try-on result from ${styleName}. The image service may expire result links.`, image_url: state.tryOnResultUrl, source_url: style.source_url || style.retailer_search?.[0]?.url, kind: 'Virtual try-on result' };
      state.savedLooks = [record, ...state.savedLooks.filter(item => item.id !== record.id)];
      await safeLocalSave(() => putKV('savedLooks', state.savedLooks)); updateCounts(); setStatus('#tryon-status', 'Result saved to Saved Styles in this browser.', 'success');
    });
  }
  async function runAnalysis(kind) {
    const config = kind === 'skin-analysis' ? { input: '#skin-photo', consent: '#skin-consent', status: '#skin-status', result: '#skin-results', key: 'skin', route: '/api/skin-analysis' } : { input: '#tone-photo', consent: '#tone-consent', status: '#tone-status', result: '#tone-results', key: 'colorTone', route: '/api/color-tone-analysis' };
    const file = cachedPhotoFor(config.key, config.input);
    if (!file) { setStatus(config.status, 'Choose a selfie first.', 'error'); $(config.input)?.focus(); return; }
    if (!$(config.consent)?.checked) { setStatus(config.status, 'Please confirm consent before sending your selfie.', 'error'); $(config.consent)?.focus(); return; }
    const button = kind === 'skin-analysis' ? $('#run-skin') : $('#run-tone');
    button.disabled = true; setStatus(config.status, 'Starting analysis…');
    try {
      const form = new FormData(); form.append('photo', file, file.name || 'selfie.jpg'); form.append('consent', 'true');
      if (kind === 'skin-analysis') form.append('actions', 'hd_redness,hd_oiliness,hd_texture,hd_acne,hd_pore,hd_moisture,hd_skin_type');
      const started = await apiFetch(config.route, { method: 'POST', body: form });
      const result = await pollTask(kind, started.task_id, message => setStatus(config.status, message));
      if (result.status !== 'success') throw new Error(result.message || 'Analysis could not be completed.');
      if (kind === 'skin-analysis') renderSkinResult(result.analysis || []); else renderToneResult(result.colors || {});
      setStatus(config.status, result.message || 'Analysis completed.', 'success');
      await putKV(kind, { result: kind === 'skin-analysis' ? result.analysis : result.colors, createdAt: Date.now() });
      if (kind === 'skin-analysis') renderSkincareLinks(result.analysis || []);
    } catch (error) {
      setStatus(config.status, error.message || 'Analysis could not be completed.', 'error');
      $(config.result).innerHTML = `<div class="result-placeholder"><span class="result-placeholder-mark">!</span><p>${escapeHTML(error.message || 'Analysis could not be completed.')}</p></div>`;
    } finally { button.disabled = false; }
  }
  function renderSkinResult(metrics) {
    const target = $('#skin-results'); if (!target) return; target.replaceChildren();
    if (!Array.isArray(metrics) || !metrics.length) {
      target.innerHTML = '<div class="result-placeholder"><span class="result-placeholder-mark">✳</span><p>The analysis completed, but no structured measures were returned for display.</p></div>'; return;
    }
    metrics.forEach(metric => {
      const card = document.createElement('div'); card.className = 'analysis-metric';
      const label = document.createElement('b'); label.textContent = metric.label || metric.key || 'Measure';
      const value = document.createElement('span'); value.textContent = `Reported value: ${metric.value}`;
      const note = document.createElement('small'); note.textContent = 'Photo-based cosmetic signal, not a diagnosis.';
      card.append(label, value, note); target.appendChild(card);
    });
    const disclaimer = document.createElement('p'); disclaimer.style.cssText = 'grid-column:1/-1;color:var(--ink-muted);font-size:.73rem;margin:.3rem 0 0;'; disclaimer.textContent = 'Values are shown as returned by YouCam. Their interpretation and scale may differ by measure; do not read these values as a medical assessment.'; target.appendChild(disclaimer);
  }
  const STYLE_COLOUR_REFERENCE = [
    ['Black', '#202124'], ['White', '#f8f7f2'], ['Cream', '#ede0ca'], ['Camel', '#ba8b61'], ['Brown', '#754c35'],
    ['Grey', '#949494'], ['Navy', '#202c44'], ['Blue', '#416c9f'], ['Green', '#477653'], ['Olive', '#77784c'],
    ['Red', '#bf3f47'], ['Pink', '#de9eaf'], ['Blush', '#e6c3c3'], ['Burgundy', '#6e243a'], ['Cobalt', '#2c55c7']
  ];
  function nearestStyleColour(hex) {
    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
    const rgb = value => [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16));
    const source = rgb(hex);
    let best = null; let distance = Infinity;
    STYLE_COLOUR_REFERENCE.forEach(([name, value]) => {
      const target = rgb(value);
      const current = (source[0] - target[0]) ** 2 + (source[1] - target[1]) ** 2 + (source[2] - target[2]) ** 2;
      if (current < distance) { distance = current; best = name; }
    });
    return best;
  }
  function renderToneResult(colors) {
    const target = $('#tone-results'); if (!target) return; target.replaceChildren();
    const apply = $('#tone-use-palette'); if (apply) apply.hidden = true;
    const aliases = { skin_color: 'Skin', hair_color: 'Hair', eye_color: 'Eyes', eyebrow_color: 'Eyebrows', lip_color: 'Lips' };
    let found = 0;
    Object.entries(aliases).forEach(([key, label]) => {
      const color = colors?.[key]; if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return;
      found += 1; const item = document.createElement('div'); item.className = 'tone-swatch';
      const swatch = document.createElement('span'); swatch.className = 'tone-swatch-chip'; swatch.style.backgroundColor = color;
      const copy = document.createElement('div'); const b = document.createElement('b'); b.textContent = label; const small = document.createElement('small'); small.textContent = color.toUpperCase(); copy.append(b, small); item.append(swatch, copy); target.appendChild(item);
    });
    if (!found) target.innerHTML = '<div class="result-placeholder"><span class="result-placeholder-mark">◐</span><p>The analysis completed, but no recognizable colour values were returned.</p></div>';
    else if (apply) apply.hidden = false;
  }
  function retailerLinksFor(query, market = state.profile.market) {
    const q = encodeURIComponent(query);
    // Search URLs are used where the retailer exposes a stable search path. Others link to
    // the official skincare storefront/category rather than constructing an unverified route.
    const links = market === 'US' ? [
      ['Sephora US', `https://www.sephora.com/search?keyword=${q}`],
      ['Kiehl’s US', `https://www.kiehls.com/search?q=${q}`],
      ['Origins US', 'https://www.origins.com/skincare-all'],
      ['Clinique US', 'https://www.clinique.com/skincare'],
      ['Lancôme US', 'https://www.lancome-usa.com/'],
      ['Amazon US', `https://www.amazon.com/s?k=${q}`]
    ] : [
      ['Sephora Canada', `https://www.sephora.com/ca/en/search?keyword=${q}`],
      ['Kiehl’s Canada', `https://www.kiehls.ca/en/search?q=${q}`],
      ['Origins Canada', 'https://www.origins.ca/skincare-all'],
      ['Mary Kay Canada', 'https://www.marykay.ca/en/skincare'],
      ['Rocky Mountain Soap', 'https://www.rockymountainsoap.com/'],
      ['Lancôme Canada', 'https://www.lancome.ca/en_CA/'],
      ['Clinique Canada', 'https://www.clinique.ca/'],
      ['Amazon Canada', `https://www.amazon.ca/s?k=${q}`]
    ];
    return links;
  }
  function renderSkincareLinks(metrics = []) {
    const target = $('#skincare-links'); if (!target) return;
    target.replaceChildren(); target.hidden = false;
    const signalText = (Array.isArray(metrics) ? metrics : []).map(metric => `${metric.key || ''} ${metric.label || ''}`.toLowerCase()).join(' ');
    const topics = [];
    if (/acne|blemish/.test(signalText)) topics.push('blemish-prone skin');
    if (/redness/.test(signalText)) topics.push('visible redness');
    if (/oiliness|pore/.test(signalText)) topics.push('oil and pore care');
    if (/texture|wrinkle|firmness/.test(signalText)) topics.push('skin texture');
    if (/moisture|dryness/.test(signalText)) topics.push('hydration');
    const uniqueTopics = [...new Set(topics)].slice(0, 4);
    const query = uniqueTopics.length ? `cosmetic skincare for ${uniqueTopics.join(', ')}` : 'gentle skincare products';
    const budget = state.profile.per_item_budget ? ` under ${Math.round(state.profile.per_item_budget)}` : '';
    const guidance = document.createElement('p'); guidance.className = 'retailer-guidance';
    guidance.textContent = uniqueTopics.length
      ? `Browse cosmetic products marketed for these reported signals: ${uniqueTopics.join(', ')}. This is product discovery, not a treatment recommendation.`
      : 'Explore general skincare categories. These links are product discovery, not diagnosis or treatment advice.';
    target.appendChild(guidance);
    retailerLinksFor(`${query}${budget}`).forEach(([label, url]) => {
      const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = label + ' ↗'; target.appendChild(a);
    });
  }
  function bindAnalysis() {
    $('#run-skin')?.addEventListener('click', () => runAnalysis('skin-analysis'));
    $('#run-tone')?.addEventListener('click', () => runAnalysis('color-tone'));
    $('#tone-use-palette')?.addEventListener('click', async () => {
      const saved = await getKV('color-tone'); const colors = saved?.result || {};
      const selected = ['skin_color', 'hair_color', 'eye_color', 'eyebrow_color', 'lip_color']
        .map(key => nearestStyleColour(colors[key])).filter(Boolean);
      const unique = [...new Set(selected)].slice(0, 5);
      if (!unique.length) { setStatus('#tone-status', 'Run colour-tone analysis first to see usable colour cues.', 'error'); return; }
      state.profile.colours = unique;
      await safeLocalSave(saveProfile);
      renderQuizChoices();
      showAlert(`Detected colour references added to Ensemble: ${unique.join(', ')}. Change them in the style quiz at any time.`, 'success');
      switchView('ensemble');
    });
    const categories = [
      ['Gentle cleanser', 'Search for non-stripping cleansers'], ['Moisturizer', 'Explore everyday hydration'], ['Sunscreen', 'Browse broad-spectrum sunscreen'], ['Texture and pores', 'Explore cosmetic products marketed for texture and pores']
    ];
    const grid = $('#skincare-category-grid'); if (!grid) return;
    categories.forEach(([title, description]) => {
      const card = document.createElement('article'); card.className = 'beauty-category';
      const h = document.createElement('h3'); h.textContent = title; const p = document.createElement('p'); p.textContent = description;
      const link = document.createElement('a'); link.href = retailerLinksFor(title.toLowerCase())[0][1]; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Browse category ↗';
      card.append(h, p, link); grid.appendChild(card);
    });
  }
  function renderFragrancePreview() {
    let target = $('#fragrance-preview');
    if (!target) {
      target = document.createElement('section'); target.id = 'fragrance-preview'; target.className = 'fragrance-preview';
      const view = $('#view-discover'); const callout = view?.querySelector('.discovery-callout');
      if (callout) callout.insertAdjacentElement('afterend', target); else view?.appendChild(target);
    }
    target.replaceChildren();
    const scents = state.profile.scentFamilies || [];
    const heading = document.createElement('h3'); heading.textContent = scents.length ? `Fragrance direction: ${scents.join(', ')}` : 'Explore fragrance by scent family';
    const p = document.createElement('p'); p.textContent = 'Fragrance suggestions are based on scent preferences you selected, not on a photo or skin-analysis result.';
    const links = document.createElement('div'); links.className = 'retailer-list';
    if (scents.length) retailerLinksFor(`${scents.join(' ')} fragrance`).forEach(([label, url]) => { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = label + ' ↗'; links.appendChild(a); });
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-outline'; button.dataset.view = 'quiz'; button.textContent = 'Edit scent preferences';
    target.append(heading, p, links, button);
  }
  async function renderWardrobe() {
    const grid = $('#wardrobe-grid'); if (!grid) return;
    grid.replaceChildren();
    const filter = $('#wardrobe-filter')?.value || 'all';
    const items = state.wardrobeItems.filter(item => filter === 'all' || (filter === 'purchased' ? item.purchased : (item.itemType === filter)));
    const summary = $('#wardrobe-summary'); if (summary) summary.textContent = `${state.wardrobeItems.length} ${state.wardrobeItems.length === 1 ? 'piece' : 'pieces'} saved in this browser.`;
    $('#wardrobe-empty').hidden = items.length > 0;
    items.forEach(item => grid.appendChild(wardrobeCard(item)));
    updateCounts();
  }
  function wardrobeCard(item) {
    const article = document.createElement('article'); article.className = 'wardrobe-item';
    const media = document.createElement('div'); media.className = 'wardrobe-item-media'; media.dataset.fallback = item.name;
    if (item.imageBlob) {
      const img = document.createElement('img'); const url = URL.createObjectURL(item.imageBlob); img.src = url; img.alt = `Your photo of ${item.name}`; img.loading = 'lazy'; img.addEventListener('error', () => itemImageFallback(img), { once: true }); img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true }); media.appendChild(img);
    } else {
      media.classList.add('image-fallback'); const label = document.createElement('span'); label.className = 'image-fallback-label'; label.textContent = item.category || 'Wardrobe item'; media.appendChild(label);
    }
    const copy = document.createElement('div'); copy.className = 'wardrobe-item-copy';
    if (item.purchased) { const purchase = document.createElement('span'); purchase.className = 'purchase-tag'; purchase.textContent = 'Marked purchased'; copy.appendChild(purchase); }
    const title = document.createElement('h4'); title.textContent = item.name;
    const meta = document.createElement('p'); meta.textContent = [item.category, item.colours, item.season && item.season !== 'all' ? item.season : ''].filter(Boolean).join(' · ');
    const actions = document.createElement('div'); actions.className = 'wardrobe-item-actions';
    const edit = document.createElement('button'); edit.type = 'button'; edit.dataset.editWardrobe = item.id; edit.textContent = 'Edit';
    const purchased = document.createElement('button'); purchased.type = 'button'; purchased.dataset.togglePurchased = item.id; purchased.textContent = item.purchased ? 'Undo purchase' : 'Mark purchased';
    const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.deleteWardrobe = item.id; remove.textContent = 'Delete';
    actions.append(edit, purchased, remove); copy.append(title, meta, actions); article.append(media, copy); return article;
  }
  let editingWardrobeId = null;
  function bindWardrobe() {
    $('#wardrobe-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const name = $('#wardrobe-name')?.value.trim(); if (!name) return;
      const category = $('#wardrobe-category')?.value || 'Other accessories';
      const file = $('#wardrobe-photo')?.files?.[0];
      let imageBlob = file || null;
      const existing = editingWardrobeId ? state.wardrobeItems.find(item => item.id === editingWardrobeId) : null;
      if (!imageBlob && existing?.imageBlob) imageBlob = existing.imageBlob;
      const isAccessory = ['Shoes','Bags','Scarves','Jewellery','Other accessories'].includes(category);
      const item = {
        ...(existing || {}), id: editingWardrobeId || `wardrobe-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
        name, category, itemType: isAccessory ? 'accessory' : 'clothing', colours: $('#wardrobe-colours')?.value.trim() || '', season: $('#wardrobe-season')?.value || 'all',
        cost: numberOrNull($('#wardrobe-cost')?.value), notes: $('#wardrobe-notes')?.value.trim() || '', purchased: Boolean($('#wardrobe-purchased')?.checked),
        imageBlob, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      try {
        await dbRequest(WARDROBE_STORE, 'put', item);
        const idx = state.wardrobeItems.findIndex(entry => entry.id === item.id);
        if (idx >= 0) state.wardrobeItems[idx] = item; else state.wardrobeItems.unshift(item);
        state.wardrobeItems.sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        $('#wardrobe-form').reset(); editingWardrobeId = null;
        const button = $('#wardrobe-form button[type="submit"]'); if (button) button.textContent = 'Add to My Wardrobe';
        renderWardrobe(); showAlert(existing ? 'Wardrobe item updated.' : 'Piece added to My Wardrobe.', 'success');
      } catch (error) { showAlert(error.message || 'Could not save this wardrobe item.', 'error'); }
    });
    $('#wardrobe-filter')?.addEventListener('change', renderWardrobe);
  }
  async function editWardrobe(id) {
    const item = state.wardrobeItems.find(entry => entry.id === id); if (!item) return;
    editingWardrobeId = id; $('#wardrobe-name').value = item.name; $('#wardrobe-category').value = item.category;
    $('#wardrobe-colours').value = item.colours || ''; $('#wardrobe-season').value = item.season || 'all'; $('#wardrobe-cost').value = item.cost ?? '';
    $('#wardrobe-notes').value = item.notes || ''; $('#wardrobe-purchased').checked = Boolean(item.purchased); $('#wardrobe-photo').value = '';
    const button = $('#wardrobe-form button[type="submit"]'); if (button) button.textContent = 'Save item changes';
    $('#wardrobe-form').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#wardrobe-name').focus({ preventScroll: true });
  }
  async function togglePurchased(id) {
    const item = state.wardrobeItems.find(entry => entry.id === id); if (!item) return;
    item.purchased = !item.purchased; item.updatedAt = new Date().toISOString();
    await safeLocalSave(() => dbRequest(WARDROBE_STORE, 'put', item)); renderWardrobe();
  }
  async function deleteWardrobe(id) {
    const item = state.wardrobeItems.find(entry => entry.id === id); if (!item) return;
    if (!window.confirm(`Delete “${item.name}” from My Wardrobe?`)) return;
    await safeLocalSave(() => dbRequest(WARDROBE_STORE, 'delete', id));
    state.wardrobeItems = state.wardrobeItems.filter(entry => entry.id !== id); renderWardrobe();
  }
  function styleGridItem(item) {
    const card = document.createElement('article'); card.className = 'screen-card';
    const media = document.createElement('div'); media.className = 'screen-card-media'; media.dataset.fallback = item.title || item.name;
    if (item.image_url) media.appendChild(safeImage(item.image_url, item.title || item.name)); else { media.classList.add('image-fallback'); const label = document.createElement('span'); label.className = 'image-fallback-label'; label.textContent = item.title || item.name; media.appendChild(label); }
    const copy = document.createElement('div'); copy.className = 'screen-card-copy';
    const kind = document.createElement('p'); kind.className = 'card-kind'; kind.textContent = item.kind || 'Style inspiration';
    const heading = document.createElement('h3'); heading.textContent = item.title || item.name;
    const description = document.createElement('p'); description.textContent = item.description || 'Saved style inspiration.';
    const actions = document.createElement('div'); actions.className = 'card-actions';
    if (item.source_url) { const link = document.createElement('a'); link.className = 'card-link'; link.href = item.source_url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open reference ↗'; actions.appendChild(link); }
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button button-outline'; remove.dataset.unsaveAny = item.id; remove.textContent = 'Remove'; actions.appendChild(remove);
    copy.append(kind, heading, description, actions); card.append(media, copy); return card;
  }
  function renderSaved() {
    const grid = $('#saved-grid'); if (!grid) return; grid.replaceChildren();
    const savedRefs = state.catalog.screen_styles.filter(item => state.savedStyleIds.includes(item.id)).map(item => ({ ...item, id: item.id }));
    const savedItems = state.catalog.items.filter(item => state.savedItemIds.includes(item.id)).map(item => ({ ...item, title: item.name, kind: 'Wardrobe inspiration', description: item.query, image_url: item.image_url, source_url: item.retailer_search?.[0]?.url }));
    const savedLooks = state.savedLooks || [];
    [...savedRefs, ...savedItems, ...savedLooks].forEach(item => grid.appendChild(styleGridItem(item)));
    $('#saved-empty').hidden = savedRefs.length + savedItems.length + savedLooks.length > 0;
  }
  async function removeSavedAny(id) {
    state.savedStyleIds = state.savedStyleIds.filter(item => item !== id);
    state.savedItemIds = state.savedItemIds.filter(item => item !== id);
    state.savedLooks = state.savedLooks.filter(item => item.id !== id);
    await safeLocalSave(async () => { await putKV('savedStyleIds', state.savedStyleIds); await putKV('savedItemIds', state.savedItemIds); await putKV('savedLooks', state.savedLooks); });
    updateCounts(); renderSaved(); renderDiscover();
  }
  function renderSettingsStatus() {
    const target = $('#settings-status'); if (target) target.textContent = `Your profile and wardrobe contain ${state.wardrobeItems.length} saved wardrobe ${state.wardrobeItems.length === 1 ? 'item' : 'items'}.`;
  }
  async function clearPhotos() {
    if (!window.confirm('Clear stored selfie and try-on photos from this browser?')) return;
    state.cachedPhotos = { tryOn: null, skin: null, colorTone: null };
    await safeLocalSave(async () => { await putKV('cachedPhotos', state.cachedPhotos); });
    renderPhotoMemory('tryOn'); renderPhotoMemory('skin'); renderPhotoMemory('colorTone');
    ['#tryon-photo', '#skin-photo', '#tone-photo'].forEach(selector => { if ($(selector)) $(selector).value = ''; });
    const status = $('#settings-status'); if (status) status.textContent = 'Stored photos cleared.';
  }
  async function resetLocalData() {
    if (!window.confirm('Delete your Kaila profile, saved styles, photos and wardrobe from this browser? This cannot be undone.')) return;
    await safeLocalSave(async () => {
      await dbRequest(KV_STORE, 'clear'); await dbRequest(WARDROBE_STORE, 'clear');
      state.profile = { ...DEFAULT_PROFILE }; state.savedStyleIds = []; state.savedItemIds = []; state.savedLooks = []; state.cachedPhotos = { tryOn: null, skin: null, colorTone: null }; state.wardrobeItems = [];
      renderQuizChoices(); renderDiscover(); updateIdentityAndMarket(); updateCounts(); renderWardrobe(); renderSaved();
      const status = $('#settings-status'); if (status) status.textContent = 'All Kaila data in this browser has been deleted.';
      switchView('quiz');
    });
  }
  function bindSettings() {
    $('#clear-photos')?.addEventListener('click', clearPhotos);
    $('#reset-local-data')?.addEventListener('click', resetLocalData);
  }
  function bindWalkthrough() {
    const steps = [
      ['Choose a direction', 'Start with a screen-inspired reference or search for a specific aesthetic.'],
      ['Set your budget', 'The country and spending targets guide shopping-search links. Current prices are always confirmed with the retailer.'],
      ['Try on a look', 'Select a full-body photo, review the consent, and start the YouCam flow. Selecting a photo alone never sends it.'],
      ['Keep your style close', 'Save references, add the clothes you own and choose whether you want optional skin or colour-tone analysis.']
    ];
    let index = 0; const dialog = $('#walkthrough-dialog'); if (!dialog) return;
    const render = () => { $('#walkthrough-step-count').textContent = `${index + 1} of ${steps.length}`; $('#walkthrough-title').textContent = steps[index][0]; $('#walkthrough-copy').textContent = steps[index][1]; $('#walkthrough-back').disabled = index === 0; $('#walkthrough-next').textContent = index === steps.length - 1 ? 'Finish' : 'Next'; };
    $('#walkthrough-open')?.addEventListener('click', () => { index = 0; render(); dialog.showModal(); });
    $('#walkthrough-close')?.addEventListener('click', () => dialog.close()); $('#walkthrough-skip')?.addEventListener('click', () => dialog.close());
    $('#walkthrough-back')?.addEventListener('click', () => { index = Math.max(0, index - 1); render(); });
    $('#walkthrough-next')?.addEventListener('click', () => { if (index >= steps.length - 1) dialog.close(); else { index += 1; render(); } });
    render();
  }
  function bindClickDelegation() {
    document.addEventListener('click', async event => {
      const viewButton = event.target.closest('[data-view]');
      if (viewButton) { event.preventDefault(); switchView(viewButton.dataset.view); return; }
      const use = event.target.closest('[data-use-style]'); if (use) { await useScreenStyle(use.dataset.useStyle); return; }
      const saveStyle = event.target.closest('[data-save-style]'); if (saveStyle) { await toggleSavedStyle(saveStyle.dataset.saveStyle); return; }
      const saveItem = event.target.closest('[data-save-item]'); if (saveItem) { await toggleSavedItem(saveItem.dataset.saveItem); return; }
      const tryItem = event.target.closest('[data-try-item]'); if (tryItem) { const item = state.catalog.items.find(i => i.id === tryItem.dataset.tryItem); if (item) { switchView('try-on'); setTimeout(() => { const select = $('#tryon-style-select'); if (select) select.value = `item:${item.id}`; syncTryOnSelection(); }, 0); } return; }
      const edit = event.target.closest('[data-edit-wardrobe]'); if (edit) { await editWardrobe(edit.dataset.editWardrobe); return; }
      const purchased = event.target.closest('[data-toggle-purchased]'); if (purchased) { await togglePurchased(purchased.dataset.togglePurchased); return; }
      const remove = event.target.closest('[data-delete-wardrobe]'); if (remove) { await deleteWardrobe(remove.dataset.deleteWardrobe); return; }
      const unsave = event.target.closest('[data-unsave-any]'); if (unsave) { await removeSavedAny(unsave.dataset.unsaveAny); }
    });
  }
  async function restoreAnalysisResults() {
    try {
      const skin = await getKV('skin-analysis'); if (skin?.result) { renderSkinResult(skin.result); renderSkincareLinks(skin.result); }
      const tone = await getKV('color-tone'); if (tone?.result) renderToneResult(tone.result);
    } catch (_) {}
  }
  async function init() {
    bindClickDelegation(); bindQuiz(); bindEnsemble(); bindPhotoInputs(); bindTryOn(); bindAnalysis(); bindWardrobe(); bindSettings(); bindWalkthrough();
    try {
      await loadLocalState(); await loadCatalog();
      renderDiscover(); updateIdentityAndMarket(); updateCounts();
      ['tryOn', 'skin', 'colorTone'].forEach(renderPhotoMemory);
      $('#ensemble-per-item').value = state.profile.per_item_budget ?? '';
      await restoreAnalysisResults(); renderWardrobe(); renderSaved(); renderFragrancePreview();
      if (!state.profile.hasCompletedQuiz) switchView('quiz');
      else switchView('discover');
    } catch (error) {
      showAlert(error.message || 'Kaila could not start. Refresh the page to retry.', 'error');
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
