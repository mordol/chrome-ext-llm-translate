// Injected on demand by the popup. Extracts paragraphs, translates the ones that
// come into view in batches, and inserts each translation right after its source.
(() => {
  if (window.__llmt) return;

  const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dd, dt, figcaption';
  const EXCLUDE_SELECTOR = 'pre, code, nav, menu, [role="navigation"], [role="menu"], form, button, select, textarea, input, [contenteditable=""], [contenteditable="true"], script, style, noscript, .llmt-tr';

  const state = {
    settings: null,
    nextId: 1,
    queue: [],          // elements waiting for translation, in visibility order
    busy: false,
    sources: new Map(), // id -> source element
    translated: 0,
    total: 0,
    lastStats: null,
  };

  function isCandidate(el) {
    if (el.closest(EXCLUDE_SELECTOR)) return false;
    // Skip containers whose paragraphs are translated individually (e.g. li > p).
    if (el.querySelector(BLOCK_SELECTOR)) return false;
    if (!el.checkVisibility()) return false;
    return /\p{L}/u.test(el.innerText || '');
  }

  const io = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      io.unobserve(entry.target);
      state.queue.push(entry.target);
    }
    pump();
  }, { rootMargin: '0px 0px 100% 0px' }); // one screen of lookahead

  function scan() {
    for (const el of document.querySelectorAll(BLOCK_SELECTOR)) {
      if (el.dataset.llmtId || !isCandidate(el)) continue;
      const id = String(state.nextId++);
      el.dataset.llmtId = id;
      state.sources.set(id, el);
      state.total++;
      io.observe(el);
    }
    updateBadge();
  }

  function pump() {
    if (state.busy || !state.queue.length) return;
    const batch = state.queue.splice(0, state.settings.batchSize);
    const paragraphs = batch.map(el => ({ id: el.dataset.llmtId, text: el.innerText.trim() }));
    batch.forEach(el => el.classList.add('llmt-pending'));
    state.busy = true;
    updateBadge();
    chrome.runtime.sendMessage({ type: 'llmt-translate', paragraphs, settings: state.settings }, res => {
      if (!res?.job) finishBatch(); // everything came from the cache
    });
  }

  function finishBatch() {
    state.busy = false;
    updateBadge();
    pump();
  }

  function insertTranslation(id, text) {
    const src = state.sources.get(id);
    if (!src) return;
    src.classList.remove('llmt-pending');
    let tr = src.nextElementSibling?.matches(`.llmt-tr[data-llmt-for="${id}"]`) ? src.nextElementSibling : null;
    if (!tr) {
      // Table cells cannot take a sibling without breaking the row, so their translation goes inside.
      const inside = src.matches('td, th');
      tr = document.createElement(inside ? 'div' : src.tagName);
      tr.className = 'llmt-tr';
      tr.dataset.llmtFor = id;
      if (inside) src.append(tr);
      else {
        src.after(tr);
        src.classList.add('llmt-src');
      }
    }
    tr.textContent = text;
    state.translated++;
    updateBadge();
  }

  function setMode(mode) {
    const root = document.documentElement;
    root.classList.remove('llmt-mode-original', 'llmt-mode-both', 'llmt-mode-translation');
    root.classList.add(`llmt-mode-${mode}`);
  }

  let badge;
  function updateBadge() {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'llmt-badge';
      document.body.append(badge);
    }
    const s = state.lastStats;
    const statLine = s
      ? `last batch: ${s.count} paras, ready ${s.readyMs}ms, first ${s.firstParaMs}ms, total ${s.totalMs}ms`
      : '';
    badge.textContent = `${state.translated}/${state.total} translated${state.busy ? ' …' : ''}\n${statLine}`;
  }

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'llmt-start') {
      state.settings = msg.settings;
      setMode(msg.settings.mode);
      scan();
    } else if (msg.type === 'llmt-mode') {
      setMode(msg.mode);
    } else if (msg.type === 'llmt-para') {
      insertTranslation(msg.id, msg.text);
    } else if (msg.type === 'llmt-done') {
      if (msg.stats) {
        state.lastStats = msg.stats;
        console.log('[llmt] batch stats', msg.stats);
      }
      if (msg.error) console.error('[llmt] batch error', msg.error);
      document.querySelectorAll('.llmt-pending').forEach(el => el.classList.remove('llmt-pending'));
      finishBatch();
    }
  });

  window.__llmt = state;
})();
