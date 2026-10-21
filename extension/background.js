const HOST_NAME = 'com.mordol.llm_translate';

// Debug helper for the service worker console: `await echo('hello')`.
self.echo = function echo(payload) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative(HOST_NAME);
    const t0 = performance.now();
    port.onMessage.addListener(msg => {
      console.log(`echo reply in ${(performance.now() - t0).toFixed(0)} ms`, msg);
      port.disconnect();
      resolve(msg);
    });
    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.error('native port disconnected:', err.message);
        reject(new Error(err.message));
      }
    });
    port.postMessage({ type: 'echo', payload });
  });
};

// --- Translation relay -----------------------------------------------------
// One native port is shared by all tabs; replies are routed back by job id.

let port = null;
const jobTabs = new Map(); // job -> { tabId, cacheKeyPrefix, texts }
const cache = new Map();   // `${cli}|${model}|${lang}|${text}` -> translation
let jobSeq = 0;

function getPort() {
  if (port) return port;
  port = chrome.runtime.connectNative(HOST_NAME);
  port.onMessage.addListener(onHostMessage);
  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message || 'native host disconnected';
    console.error(error);
    for (const [job, { tabId }] of jobTabs) {
      chrome.tabs.sendMessage(tabId, { type: 'llmt-done', job, error });
    }
    jobTabs.clear();
    port = null;
  });
  return port;
}

function onHostMessage(msg) {
  const entry = jobTabs.get(msg.job);
  if (!entry) return;
  if (msg.type === 'para') {
    const text = entry.texts.get(msg.id);
    if (text !== undefined) cache.set(entry.cacheKeyPrefix + text, msg.text);
    chrome.tabs.sendMessage(entry.tabId, { type: 'llmt-para', id: msg.id, text: msg.text });
  } else if (msg.type === 'error') {
    console.error('host error', msg.error);
    entry.error = msg.error;
  } else if (msg.type === 'done') {
    console.log('job done', msg.job, msg.stats);
    jobTabs.delete(msg.job);
    chrome.tabs.sendMessage(entry.tabId, { type: 'llmt-done', job: msg.job, stats: msg.stats, error: entry.error });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'llmt-translate' || !sender.tab) return;
  const { paragraphs, settings } = msg;
  const tabId = sender.tab.id;
  const cacheKeyPrefix = `${settings.cli}|${settings.model}|${settings.targetLang}|`;

  const misses = [];
  for (const p of paragraphs) {
    const hit = cache.get(cacheKeyPrefix + p.text);
    if (hit !== undefined) chrome.tabs.sendMessage(tabId, { type: 'llmt-para', id: p.id, text: hit });
    else misses.push(p);
  }
  if (!misses.length) {
    sendResponse({ job: null });
    return;
  }

  const job = `j${++jobSeq}`;
  jobTabs.set(job, { tabId, cacheKeyPrefix, texts: new Map(misses.map(p => [p.id, p.text])) });
  getPort().postMessage({
    type: 'translate',
    job,
    cli: settings.cli,
    model: settings.model || undefined,
    targetLang: settings.targetLang,
    paragraphs: misses,
  });
  sendResponse({ job });
});
