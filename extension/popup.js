const FIELDS = ['cli', 'model', 'targetLang', 'batchSize'];
const DEFAULTS = { cli: 'claude', model: '', targetLang: 'Korean', batchSize: 10, mode: 'both' };

async function loadSettings() {
  const saved = await chrome.storage.local.get(DEFAULTS);
  for (const f of FIELDS) document.getElementById(f).value = saved[f];
  markMode(saved.mode);
  return saved;
}

function readSettings(mode) {
  const s = { mode };
  for (const f of FIELDS) s[f] = document.getElementById(f).value.trim();
  s.batchSize = Math.max(1, parseInt(s.batchSize, 10) || DEFAULTS.batchSize);
  return s;
}

function markMode(mode) {
  document.querySelectorAll('.modes button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab.id;
}

(async () => {
  let { mode } = await loadSettings();

  document.getElementById('translate').addEventListener('click', async () => {
    const settings = readSettings(mode);
    await chrome.storage.local.set(settings);
    const tabId = await activeTabId();
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'llmt-start', settings });
    window.close();
  });

  document.querySelectorAll('.modes button').forEach(btn => btn.addEventListener('click', async () => {
    mode = btn.dataset.mode;
    markMode(mode);
    await chrome.storage.local.set({ mode });
    chrome.tabs.sendMessage(await activeTabId(), { type: 'llmt-mode', mode }).catch(() => {});
  }));
})();
