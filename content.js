// ============================================================
// Merch on Demand Auto Uploader — Content Script
// Runs on https://merch.amazon.com/* pages
// Uses EXACT selectors from the actual Merch page
// ============================================================

// Don't send CONTENT_READY on auto-load — it causes errors
// when background isn't expecting it. Just listen for messages.

// ============================================================
// LISTEN FOR FILL COMMANDS FROM POPUP
// ============================================================

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.action === 'FILL_LISTING') {
    console.log('[MerchUploader] Received FILL_LISTING command');
    fillListing(msg)
      .then(function(result) {
        console.log('[MerchUploader] Fill result:', result);
        sendResponse(result);
      })
      .catch(function(err) {
        console.error('[MerchUploader] Fill error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // keep message channel open for async response
  }
});

// ============================================================
// MAIN FILL LOGIC
// ============================================================

async function fillListing(msg) {
  var listing = msg.listing;
  var designBase64 = msg.designBase64;
  var designFileName = msg.designFileName;

  try {
    showOverlay('Starting: ' + listing.title);
    console.log('[MerchUploader] Starting fill for:', listing.title);

    // Step 1: Wait for the page to fully load
    updateOverlay('Waiting for page to load...');
    console.log('[MerchUploader] Waiting for dropzone...');
    await waitForElement('.dropzone-container', 20000);
    console.log('[MerchUploader] Dropzone found');
    await sleep(2000);

    // Step 2: Upload the design file
    if (designBase64) {
      updateOverlay('Uploading design file...');
      console.log('[MerchUploader] Uploading design...');
      await uploadDesign(designBase64, designFileName);
      
      // Wait for the design to process (Amazon takes time)
      updateOverlay('Waiting for design to process...');
      console.log('[MerchUploader] Waiting for design processing...');
      await sleep(8000);
    } else {
      console.log('[MerchUploader] No design file provided, skipping upload');
    }

    // Step 3: Wait for the product editor form to appear
    // After design upload, Amazon shows the form fields
    updateOverlay('Waiting for product editor form...');
    console.log('[MerchUploader] Waiting for brand name field...');
    
    try {
      await waitForElement('#designCreator-productEditor-brandName', 30000);
    } catch (e) {
      // Try alternative: maybe the form uses different IDs
      console.log('[MerchUploader] Brand field not found by ID, trying formcontrolname...');
      await waitForElement('[formcontrolname="brandName"]', 10000);
    }
    
    console.log('[MerchUploader] Form fields found');
    await sleep(2000);

    // Step 4: Fill in all fields
    // Brand Name (input field)
    updateOverlay('Filling brand name...');
    console.log('[MerchUploader] Filling brand:', listing.brand);
    await fillAngularField('#designCreator-productEditor-brandName', 'brandName', listing.brand);
    await sleep(500);

    // Title (textarea)
    updateOverlay('Filling title...');
    console.log('[MerchUploader] Filling title:', listing.title);
    await fillAngularField('#prdm-copy-designCreator-productEditor-title-en', 'title-en', listing.title);
    await sleep(500);

    // Bullet Point 1 (textarea)
    updateOverlay('Filling bullet point 1...');
    console.log('[MerchUploader] Filling bullet1:', listing.bullet1);
    await fillAngularField('#prdm-copy-designCreator-productEditor-featureBullet1-en', 'featureBullet1-en', listing.bullet1);
    await sleep(500);

    // Bullet Point 2 (textarea)
    updateOverlay('Filling bullet point 2...');
    console.log('[MerchUploader] Filling bullet2:', listing.bullet2);
    await fillAngularField('#prdm-copy-designCreator-productEditor-featureBullet2-en', 'featureBullet2-en', listing.bullet2);
    await sleep(500);

    // Description (textarea)
    updateOverlay('Filling description...');
    console.log('[MerchUploader] Filling description');
    await fillAngularField('#designCreator-productEditor-description', 'description', listing.description);
    await sleep(1000);

    // Step 5: Check if Publish button is enabled
    updateOverlay('Checking Publish button...');
    var publishBtn = await waitForPublishEnabled(15000);
    
    if (publishBtn) {
      updateOverlay('Publishing...');
      console.log('[MerchUploader] Clicking Publish');
      publishBtn.click();
      await sleep(3000);
    } else {
      console.warn('[MerchUploader] Publish button disabled — logging field states');
      logFieldStates();
      throw new Error('Publish button is disabled — form validation may have failed');
    }

    removeOverlay();
    console.log('[MerchUploader] SUCCESS for:', listing.title);
    return { success: true };

  } catch (err) {
    removeOverlay();
    console.error('[MerchUploader] FAILED:', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
// DESIGN FILE UPLOAD
// ============================================================

async function uploadDesign(base64Data, fileName) {
  // Convert base64 data URL to a File object
  var response = await fetch(base64Data);
  var blob = await response.blob();
  var file = new File([blob], fileName || 'design.png', { type: 'image/png' });

  // Find the file input — exact selector from the page
  var fileInput = document.querySelector('input.file-upload-input');
  if (!fileInput) fileInput = document.querySelector('.dropzone-container input[type="file"]');
  if (!fileInput) fileInput = document.querySelector('input[type="file"][accept="image/png"]');
  if (!fileInput) fileInput = document.querySelector('input[type="file"]');

  if (!fileInput) {
    throw new Error('Could not find file upload input on page');
  }

  console.log('[MerchUploader] Found file input:', fileInput.className);

  // Set files on the input using DataTransfer
  var dt = new DataTransfer();
  dt.items.add(file);
  fileInput.files = dt.files;

  // Fire the change event — Angular binds to (change) on file inputs
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  fileInput.dispatchEvent(new Event('input', { bubbles: true }));

  console.log('[MerchUploader] File set on input, change event dispatched');

  // Also try drag-and-drop on the dropzone container
  var dropZone = document.querySelector('.dropzone-container');
  if (dropZone) {
    try {
      var dt2 = new DataTransfer();
      dt2.items.add(file);
      dropZone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt2 }));
      await sleep(50);
      dropZone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt2 }));
      await sleep(50);
      dropZone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt2 }));
      console.log('[MerchUploader] Drop event dispatched on dropzone');
    } catch (e) {
      console.log('[MerchUploader] Drop event failed (non-critical):', e.message);
    }
  }
}

// ============================================================
// ANGULAR FORM FILLING
// Types character by character to trigger Angular's change detection
// ============================================================

async function fillAngularField(idSelector, formControlName, value) {
  if (!value) {
    console.log('[MerchUploader] Skipping empty value for', idSelector);
    return;
  }

  // Find element by ID first, then by formcontrolname
  var element = document.querySelector(idSelector);
  if (!element) {
    element = document.querySelector('[formcontrolname="' + formControlName + '"]');
  }
  if (!element) {
    // Last resort: try partial ID match
    var allInputs = document.querySelectorAll('input, textarea');
    for (var i = 0; i < allInputs.length; i++) {
      var el = allInputs[i];
      if (el.id && el.id.toLowerCase().indexOf(formControlName.toLowerCase().replace('-', '')) !== -1) {
        element = el;
        break;
      }
    }
  }

  if (!element) {
    console.error('[MerchUploader] FIELD NOT FOUND:', idSelector, '/', formControlName);
    return;
  }

  console.log('[MerchUploader] Found field:', element.tagName, element.id, 'classes:', element.className);

  // Focus the field
  element.focus();
  element.dispatchEvent(new Event('focus', { bubbles: true }));
  element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await sleep(100);

  // Clear existing value
  element.value = '';
  element.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(50);

  // Type the value character by character
  // This is the most reliable way to fill Angular forms
  for (var i = 0; i < value.length; i++) {
    var char = value[i];

    element.dispatchEvent(new KeyboardEvent('keydown', {
      key: char, code: 'Key' + char.toUpperCase(),
      bubbles: true, cancelable: true
    }));

    // Set value progressively
    element.value = value.substring(0, i + 1);

    // Input event — this is the critical one for Angular
    element.dispatchEvent(new Event('input', { bubbles: true }));

    element.dispatchEvent(new KeyboardEvent('keypress', {
      key: char, charCode: char.charCodeAt(0),
      bubbles: true, cancelable: true
    }));

    element.dispatchEvent(new KeyboardEvent('keyup', {
      key: char, code: 'Key' + char.toUpperCase(),
      bubbles: true, cancelable: true
    }));

    // Pace the typing to not overwhelm the page
    if (i % 10 === 0) await sleep(5);
  }

  // Signal completion
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
  element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  await sleep(200);

  // Verify
  if (element.value === value) {
    console.log('[MerchUploader] ✓ Field filled successfully:', idSelector);
  } else {
    console.warn('[MerchUploader] ✗ Value mismatch on', idSelector);
    console.warn('[MerchUploader]   Expected:', value.substring(0, 50));
    console.warn('[MerchUploader]   Got:', element.value.substring(0, 50));
    
    // Fallback: use native setter
    var proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) {
      setter.set.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));
      console.log('[MerchUploader] Applied native setter fallback');
    }
  }
}

// ============================================================
// PUBLISH BUTTON
// ============================================================

async function waitForPublishEnabled(timeout) {
  var start = Date.now();
  while (Date.now() - start < timeout) {
    var btn = document.querySelector('#submit-button');
    if (btn && !btn.disabled) {
      return btn;
    }
    await sleep(500);
  }
  return null;
}

function logFieldStates() {
  var fields = {
    'Brand': '#designCreator-productEditor-brandName',
    'Title': '#prdm-copy-designCreator-productEditor-title-en',
    'Bullet1': '#prdm-copy-designCreator-productEditor-featureBullet1-en',
    'Bullet2': '#prdm-copy-designCreator-productEditor-featureBullet2-en',
    'Description': '#designCreator-productEditor-description'
  };
  for (var name in fields) {
    var el = document.querySelector(fields[name]);
    if (el) {
      console.log('[MerchUploader] ' + name + ': value="' + (el.value || '').substring(0, 40) + '" classes=' + el.className);
    } else {
      console.log('[MerchUploader] ' + name + ': NOT FOUND');
    }
  }
  var btn = document.querySelector('#submit-button');
  console.log('[MerchUploader] Publish button disabled:', btn ? btn.disabled : 'NOT FOUND');
}

// ============================================================
// STATUS OVERLAY
// ============================================================

function showOverlay(text) {
  removeOverlay();
  var overlay = document.createElement('div');
  overlay.id = 'merch-uploader-overlay';
  overlay.innerHTML =
    '<div class="merch-uploader-spinner"></div>' +
    '<div class="merch-uploader-text">' + escapeHtml(text) + '</div>';
  document.body.appendChild(overlay);
}

function updateOverlay(text) {
  var el = document.querySelector('.merch-uploader-text');
  if (el) el.textContent = text;
}

function removeOverlay() {
  var el = document.getElementById('merch-uploader-overlay');
  if (el) el.remove();
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// UTILITIES
// ============================================================

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function waitForElement(selector, timeout) {
  timeout = timeout || 10000;
  return new Promise(function(resolve, reject) {
    var existing = document.querySelector(selector);
    if (existing) {
      console.log('[MerchUploader] Element found immediately:', selector);
      return resolve(existing);
    }

    var observer = new MutationObserver(function() {
      var el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        console.log('[MerchUploader] Element appeared:', selector);
        resolve(el);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    var timer = setTimeout(function() {
      observer.disconnect();
      console.error('[MerchUploader] TIMEOUT waiting for:', selector);
      reject(new Error('Timeout waiting for: ' + selector));
    }, timeout);
  });
}

console.log('[MerchUploader] Content script loaded and ready');
