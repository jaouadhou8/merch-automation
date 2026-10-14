// Injection is idempotent: message retries must never add a second fill listener.
(() => {
  'use strict';
  if (globalThis.__merchUploaderInstalled) return;
  globalThis.__merchUploaderInstalled = true;
  let currentRun = null;
  const fields = [
    ['brand', '#designCreator-productEditor-brandName', 'brandName'],
    ['title', '#prdm-copy-designCreator-productEditor-title-en', 'title-en'],
    ['bullet1', '#prdm-copy-designCreator-productEditor-featureBullet1-en', 'featureBullet1-en'],
    ['bullet2', '#prdm-copy-designCreator-productEditor-featureBullet2-en', 'featureBullet2-en'],
    ['description', '#designCreator-productEditor-description', 'description']
  ];
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id && sender.id !== chrome.runtime.id) return;
    if (msg?.action === 'CANCEL_FILL') {
      if (currentRun) currentRun.cancelled = true;
      sendResponse({success: true}); return;
    }
    if (msg?.action !== 'FILL_LISTING') return;
    if (currentRun) { sendResponse({success: false, error: 'This tab is already preparing a listing.'}); return; }
    const run = {cancelled: false}; currentRun = run;
    fillListing(msg, run).then(sendResponse, error => sendResponse({success: false, error: error.message}))
      .finally(() => { removeOverlay(); currentRun = null; });
    return true;
  });
  function checkCancelled(run) {
    if (run.cancelled) throw new Error('Stopped by user. Inspect this tab before retrying.');
  }
  async function sleep(ms, run) {
    const deadline = Date.now() + ms;
    do {
      checkCancelled(run);
      await new Promise(resolve => setTimeout(resolve, Math.min(50, Math.max(0, deadline - Date.now()))));
    } while (Date.now() < deadline);
    checkCancelled(run);
  }
  async function waitFor(find, label, timeout, run) {
    const deadline = Date.now() + timeout;
    do {
      checkCancelled(run);
      const element = find(); if (element) return element;
      await sleep(100, run);
    } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${label}. Check login, image processing and Amazon page changes.`);
  }
  function findField(selector, name) {
    return document.querySelector(selector) || document.querySelector(`[formcontrolname="${name}"]`);
  }
  async function fillField(selector, name, value, run) {
    const element = await waitFor(() => findField(selector, name), `field ${name}`, 15000, run);
    if (!['INPUT', 'TEXTAREA'].includes(element.tagName) || element.disabled || element.readOnly) {
      throw new Error(`Field ${name} is not editable.`);
    }
    if (element.maxLength >= 0 && value.length > element.maxLength) {
      throw new Error(`${name} exceeds Amazon’s ${element.maxLength}-character limit.`);
    }
    element.focus();
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) throw new Error(`Cannot set field ${name}.`);
    setter.call(element, value);
    element.dispatchEvent(new Event('input', {bubbles: true}));
    element.dispatchEvent(new Event('change', {bubbles: true}));
    element.blur();
    await sleep(150, run);
    if (element.value !== value) throw new Error(`Amazon did not retain the value for ${name}.`);
  }
  async function uploadDesign(data, name, run) {
    if (!/^data:image\/(png|jpeg);base64,/i.test(data)) throw new Error('Design must be a PNG or JPEG data URL.');
    const response = await fetch(data);
    const blob = await response.blob(); checkCancelled(run);
    const file = new File([blob], name, {type: blob.type});
    const input = document.querySelector('.dropzone-container input[type="file"]') ||
      document.querySelector('input.file-upload-input') || document.querySelector('input[type="file"][accept*="image/png"]');
    const transfer = new DataTransfer(); transfer.items.add(file);
    if (input) {
      if (input.disabled) throw new Error('Amazon’s design file input is disabled.');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', {bubbles: true}));
    } else {
      const dropzone = document.querySelector('.dropzone-container');
      if (!dropzone) throw new Error('Cannot find Amazon’s design upload control.');
      for (const type of ['dragenter', 'dragover', 'drop']) {
        checkCancelled(run);
        dropzone.dispatchEvent(new DragEvent(type, {bubbles: true, cancelable: true, dataTransfer: transfer}));
      }
    }
    // Do not also dispatch a drop when a file-input upload was already dispatched.
  }
  async function fillListing(msg, run) {
    const listing = msg.listing;
    if (!listing || fields.some(([key]) => typeof listing[key] !== 'string') || !listing.title.trim() || !listing.brand.trim()) {
      throw new Error('Listing needs a title, brand, and string values for all text fields.');
    }
    if (!msg.designBase64 || !msg.designFileName) throw new Error('A matching design image is required.');
    const delay = Number(listing.delay);
    if (!Number.isInteger(delay) || delay < 500 || delay > 10000) throw new Error('Invalid action delay.');
    showOverlay(`Preparing: ${listing.title}`);
    await waitFor(() => document.querySelector('.dropzone-container, input.file-upload-input'), 'design upload control', 20000, run);
    updateOverlay('Uploading design…');
    await uploadDesign(msg.designBase64, msg.designFileName, run);
    await sleep(delay, run);
    await waitFor(() => {
      const field = findField(fields[0][1], fields[0][2]);
      return field && !field.disabled ? field : null;
    }, 'product editor', 60000, run);
    for (const [key, selector, name] of fields) {
      updateOverlay(`Filling ${key}…`);
      await fillField(selector, name, listing[key], run);
    }
    await sleep(delay, run);
    // Verify every field again: a later rerender can discard earlier field values.
    for (const [key, selector, name] of fields) {
      if (findField(selector, name)?.value !== listing[key]) throw new Error(`Field ${name} changed after filling. Review this tab.`);
    }
    checkCancelled(run);
    if (msg.autoPublish !== true) return {success: true, status: 'prepared'};
    updateOverlay('Waiting for Publish…');
    const button = await waitFor(() => {
      const button = document.querySelector('#submit-button');
      return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && button.getClientRects().length ? button : null;
    }, 'enabled Publish button', 15000, run);
    checkCancelled(run);
    button.click();
    // A click is not evidence of publication. The controller retains the tab for verification.
    return {success: true, status: 'submitted', publicationVerified: false};
  }
  function showOverlay(text) {
    removeOverlay();
    const overlay = document.createElement('div'); overlay.id = 'merch-uploader-overlay';
    const spinner = document.createElement('div'); spinner.className = 'merch-uploader-spinner';
    const label = document.createElement('div'); label.className = 'merch-uploader-text'; label.textContent = text;
    overlay.append(spinner, label); document.body.appendChild(overlay);
  }
  function updateOverlay(text) { const label = document.querySelector('.merch-uploader-text'); if (label) label.textContent = text; }
  function removeOverlay() { document.getElementById('merch-uploader-overlay')?.remove(); }
})();
