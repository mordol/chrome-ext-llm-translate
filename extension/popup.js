const HOST_NAME = 'com.mordol.llm_translate';
const FIELDS = ['cli', 'targetLang', 'batchSize'];
const DEFAULTS = { cli: 'claude', targetLang: 'Korean', batchSize: 10, mode: 'both', modelByCli: {} };

const $ = id => document.getElementById(id);

async function loadSettings() {
  const saved = await chrome.storage.local.get(DEFAULTS);
  for (const f of FIELDS) $(f).value = saved[f];
  $('model').value = saved.modelByCli[saved.cli] || '';
  markMode(saved.mode);
  return saved;
}

function readSettings(mode) {
  const s = { mode, model: $('model').value.trim() };
  for (const f of FIELDS) s[f] = $(f).value.trim();
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

function setStatus(text, isError = false) {
  $('modelStatus').textContent = text;
  $('modelStatus').classList.toggle('error', isError);
}

function renderModels(models) {
  $('modelList').replaceChildren(...models.map(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.label = m.name;
    return opt;
  }));
}

// Listing runs the CLI (up to ~2 s), so results are cached per CLI until refreshed.
async function loadModels(cli, force = false) {
  const cacheKey = `modelCache:${cli}`;
  const cached = (await chrome.storage.local.get(cacheKey))[cacheKey];
  if (cached && !force) {
    renderModels(cached.models);
    setStatus(`${cached.models.length} models (cached)`);
    return;
  }
  renderModels([]);
  setStatus('Loading models…');
  let res;
  try {
    res = await chrome.runtime.sendNativeMessage(HOST_NAME, { type: 'models', cli });
  } catch (e) {
    res = { error: e.message };
  }
  if ($('cli').value !== cli) return; // the user switched CLI meanwhile
  if (res.error) {
    setStatus(res.error, true);
    return;
  }
  await chrome.storage.local.set({ [cacheKey]: { models: res.models, fetchedAt: Date.now() } });
  renderModels(res.models);
  setStatus(`${res.models.length} models`);
}

(async () => {
  let { mode, modelByCli, cli: currentCli } = await loadSettings();
  loadModels(currentCli);

  // The model id is remembered per CLI, since ids are not shared between CLIs.
  $('cli').addEventListener('change', async () => {
    modelByCli[currentCli] = $('model').value.trim();
    currentCli = $('cli').value;
    $('model').value = modelByCli[currentCli] || '';
    await chrome.storage.local.set({ cli: currentCli, modelByCli });
    loadModels(currentCli);
  });

  $('refreshModels').addEventListener('click', e => {
    e.preventDefault();
    loadModels(currentCli, true);
  });

  $('translate').addEventListener('click', async () => {
    const settings = readSettings(mode);
    modelByCli[settings.cli] = settings.model;
    await chrome.storage.local.set({ ...settings, modelByCli });
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
