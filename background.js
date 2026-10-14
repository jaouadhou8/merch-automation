// ── Background Service Worker ─────────
// Handles tab management and message routing

chrome.runtime.onInstalled.addListener(() => {
  console.log('[MerchUploader] Extension installed');
});

// Relay messages between popup and content scripts if needed
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'OPEN_TAB') {
    chrome.tabs.create({
      url: message.url,
      active: false
    }, (tab) => {
      sendResponse({ tabId: tab.id });
    });
    return true;
  }

  if (message.action === 'CLOSE_TAB') {
    chrome.tabs.remove(message.tabId).catch(() => {});
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'GET_ACTIVE_TABS') {
    chrome.tabs.query({ url: 'https://merch.amazon.com/*' }, (tabs) => {
      sendResponse({ tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title })) });
    });
    return true;
  }
});
