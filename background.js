// A regular extension tab survives focus changes; a toolbar popup does not.
let opening = null;
chrome.action.onClicked.addListener(() => {
  if (opening) return;
  opening = (async () => {
    const url = chrome.runtime.getURL('popup.html');
    const tabs = await chrome.tabs.query({url});
    if (tabs.length) {
      await chrome.tabs.update(tabs[0].id, {active: true});
      await chrome.windows.update(tabs[0].windowId, {focused: true});
    } else {
      await chrome.tabs.create({url, active: true});
    }
  })().catch(error => console.error('[MerchUploader] Cannot open uploader:', error.message))
    .finally(() => { opening = null; });
});
