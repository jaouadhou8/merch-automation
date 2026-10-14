'use strict';
let csvData = [];
let designFiles = Object.create(null);
let concurrentTabs = 1;
let isUploading = false;
let runnerActive = false;
let statuses = [];
let inputRevision = 0;
let designRevision = 0;
let previewURLs = [];
const activeTabs = new Map();
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const parseCSV = text => MerchCore.parseCSV(text);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function showError(message = '') { $('#inputError').textContent = message; }
function goToStep(num) {
  $$('.panel').forEach(p => { p.style.display = 'none'; });
  $(`#step${num}`).style.display = 'block';
  $$('.step').forEach(s => {
    const n = Number(s.dataset.step);
    s.classList.toggle('active', n === num);
    s.classList.toggle('done', n < num);
  });
}
function clearPreviews() {
  previewURLs.forEach(url => URL.revokeObjectURL(url));
  previewURLs = [];
  $('#designPreview').replaceChildren();
}
function resetQueue() {
  statuses = csvData.map(() => 'pending');
  $('#logArea').replaceChildren();
  $('#progressSection').style.display = 'none';
  $('#startUpload').disabled = false;
  $('#startUpload').textContent = 'Prepare Listings';
}
function bindDrop(zone, input, handler) {
  zone.tabIndex = 0; zone.setAttribute('role', 'button');
  zone.addEventListener('keydown', e => {
    if (!runnerActive && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); input().click(); }
  });
  zone.addEventListener('click', () => input().click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = 'var(--accent)'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.style.borderColor = '';
    if (!runnerActive) handler(e.dataTransfer.files);
  });
}
async function handleCSVFile(file) {
  if (runnerActive) return;
  const revision = ++inputRevision;
  csvData = [];
  $('#toStep2').disabled = true;
  $('#toStep3').disabled = true;
  $('#csvInfo').style.display = 'none';
  $('#csvDropZone').style.display = '';
  showError();
  try {
    if (!/\.csv$/i.test(file.name)) throw new Error('Please select a CSV file.');
    if (file.size > 2 * 1024 * 1024) throw new Error('CSV exceeds the 2 MiB import limit. Split it into smaller files.');
    const rows = parseCSV(await file.text());
    if (revision !== inputRevision) return;
    csvData = rows;
    $('#csvFileName').textContent = file.name;
    $('#csvRows').textContent = rows.length;
    $('#csvCols').textContent = Object.keys(rows[0]).length;
    $('#csvInfo').style.display = 'block';
    $('#csvDropZone').style.display = 'none';
    $('#toStep2').disabled = false;
    resetQueue();
    checkDesignMatches();
  } catch (error) { if (revision === inputRevision) showError(error.message); }
}
bindDrop($('#csvDropZone'), () => $('#csvInput'), files => { if (files[0]) handleCSVFile(files[0]); });
$('#csvInput').addEventListener('change', e => { if (e.target.files[0]) handleCSVFile(e.target.files[0]); e.target.value = ''; });
$('#csvRemove').addEventListener('click', () => {
  inputRevision++;
  csvData = [];
  $('#csvInput').value = '';
  $('#csvInfo').style.display = 'none';
  $('#csvDropZone').style.display = '';
  $('#toStep2').disabled = true;
  resetQueue(); checkDesignMatches(); showError();
});
$('#toStep2').addEventListener('click', () => { checkDesignMatches(); goToStep(2); });

async function handleDesignFiles(files) {
  if (runnerActive) return;
  const revision = ++designRevision;
  designFiles = Object.create(null);
  clearPreviews();
  $('#toStep3').disabled = true;
  showError();
  try {
    const images = Array.from(files).filter(f => /\.(png|jpe?g)$/i.test(f.name) || ['image/png', 'image/jpeg'].includes(f.type));
    if (!images.length) throw new Error('Select at least one PNG or JPEG image.');
    if (new Set(images.map(f => f.name)).size !== images.length) throw new Error('Duplicate image filenames found. Rename them so each filename is unique.');
    for (let i = 0; i < images.length; i++) {
      const file = images[i];
      if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name}: exceeds the 25 MiB transfer limit.`);
      const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      const png = [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n);
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (!png && !jpeg) throw new Error(`${file.name}: file contents are not PNG or JPEG.`);
      // Normalize MIME type from the bytes, including OS file pickers with no MIME type.
      const normalized = new File([file], file.name, {type: png ? 'image/png' : 'image/jpeg'});
      try { const bitmap = await createImageBitmap(normalized); bitmap.close(); }
      catch { throw new Error(`${file.name}: image is corrupt or cannot be decoded by Chrome.`); }
      if (revision !== designRevision) return;
      images[i] = normalized;
    }
    if (revision !== designRevision) return;
    images.forEach(file => { designFiles[file.name] = file; });
    $('#designCount').textContent = `${images.length} images loaded`;
    $('#designInfo').style.display = 'block';
    $('#designDropZone').style.display = 'none';
    for (const file of images.slice(0, 8)) {
      const img = document.createElement('img');
      img.className = 'design-thumb'; img.alt = file.name;
      img.src = URL.createObjectURL(file); previewURLs.push(img.src);
      $('#designPreview').appendChild(img);
    }
    resetQueue(); checkDesignMatches();
  } catch (error) {
    if (revision !== designRevision) return;
    $('#designInfo').style.display = 'none';
    $('#designDropZone').style.display = '';
    showError(error.message);
  }
}
bindDrop($('#designDropZone'), () => $($('#selectFolder').checked ? '#designInput' : '#designFilesInput'), handleDesignFiles);
$('#designReplace').addEventListener('click', () => {
  $($('#selectFolder').checked ? '#designInput' : '#designFilesInput').click();
});
$('#selectFiles').addEventListener('click', () => { $('#selectFolder').checked = false; $('#designFilesInput').click(); });
for (const id of ['designInput', 'designFilesInput']) $('#' + id).addEventListener('change', e => { handleDesignFiles(e.target.files); e.target.value = ''; });
function checkDesignMatches() {
  const result = MerchCore.matchDesigns(csvData, Object.values(designFiles));
  const el = $('#matchStatus');
  el.className = `match-status ${result.valid ? 'match-ok' : 'match-warn'}`;
  el.textContent = result.valid ? `✓ All ${csvData.length} designs matched to CSV rows` :
    result.missing.length ? `Missing designs: ${result.missing.slice(0, 5).join(', ')}${result.missing.length > 5 ? '…' : ''}` : 'Import a valid CSV and matching images.';
  $('#toStep3').disabled = !result.valid;
  return result.valid;
}
$('#backToStep1').addEventListener('click', () => goToStep(1));
$('#toStep3').addEventListener('click', () => { if (checkDesignMatches()) { buildQueue(); goToStep(3); } });
$('#backToStep2').addEventListener('click', () => goToStep(2));
$('#tabsMinus').addEventListener('click', () => { concurrentTabs = Math.max(1, concurrentTabs - 1); $('#tabsCount').textContent = concurrentTabs; });
$('#tabsPlus').addEventListener('click', () => { concurrentTabs = Math.min(10, concurrentTabs + 1); $('#tabsCount').textContent = concurrentTabs; });
function buildQueue() {
  $('#queueList').replaceChildren();
  csvData.forEach((row, index) => {
    const item = document.createElement('div'); item.className = 'queue-item'; item.id = `queue-${index}`;
    const num = document.createElement('span'); num.className = 'queue-num'; num.textContent = `#${index + 1}`;
    const title = document.createElement('span'); title.className = 'queue-title'; title.textContent = row.title;
    const status = document.createElement('span'); status.className = 'queue-status status-pending'; status.textContent = statuses[index] || 'pending';
    item.append(num, title, status); $('#queueList').appendChild(item);
  });
}
function updateQueueStatus(index, status, text) {
  statuses[index] = status;
  const el = $(`#queue-${index} .queue-status`);
  if (el) { el.className = `queue-status status-${status}`; el.textContent = text; }
}
function addTabLink(index, tabId) {
  const link = document.createElement('a'); link.href = '#'; link.textContent = 'View';
  link.addEventListener('click', async e => {
    e.preventDefault();
    try { const tab = await chrome.tabs.update(tabId, {active: true}); await chrome.windows.update(tab.windowId, {focused: true}); }
    catch { showError('That Amazon tab has been closed.'); }
  });
  $(`#queue-${index}`).appendChild(link);
}
function updateProgress() {
  const done = statuses.filter(s => s !== 'pending' && s !== 'active').length;
  const pct = csvData.length ? Math.round(done / csvData.length * 100) : 0;
  $('#progressBar').style.width = `${pct}%`; $('#progressText').textContent = `${done} / ${csvData.length}`; $('#progressPercent').textContent = `${pct}%`;
}
function addLog(type, message) {
  const line = document.createElement('div'); line.className = `log-${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  $('#logArea').appendChild(line); $('#logArea').scrollTop = $('#logArea').scrollHeight;
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Cannot read ${file.name}.`)); reader.readAsDataURL(file);
  });
}
function waitForTabLoad(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return; settled = true; clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(updated); chrome.tabs.onRemoved.removeListener(removed);
      error ? reject(error) : resolve();
    };
    const updated = (id, change) => { if (id === tabId && change.status === 'complete') finish(); };
    const removed = id => { if (id === tabId) finish(new Error('Amazon tab was closed.')); };
    const timer = setTimeout(() => finish(new Error('Amazon page load timed out. Check the tab and your connection.')), timeout);
    chrome.tabs.onUpdated.addListener(updated); chrome.tabs.onRemoved.addListener(removed);
    // Handles tabs that completed before the listener was attached.
    chrome.tabs.get(tabId).then(tab => { if (tab.status === 'complete') finish(); }, finish);
  });
}
function checkRunning() { if (!isUploading) throw new Error('Stopped by user. Inspect the Amazon tab before retrying this row.'); }
function lockControls(locked) {
  document.querySelectorAll('button, input, select').forEach(el => { if (el.id !== 'stopUpload') el.disabled = locked; });
  if (!locked) {
    $('#toStep2').disabled = !csvData.length; checkDesignMatches();
    $('#startUpload').disabled = !statuses.includes('pending');
  }
}
async function processRow(index, delay, autoPublish) {
  const row = csvData[index];
  updateQueueStatus(index, 'active', 'Preparing');
  try {
    checkRunning();
    const file = designFiles[row.design_filename];
    if (!file) throw new Error(`Missing design: ${row.design_filename}`);
    const designBase64 = await fileToBase64(file); checkRunning();
    const tab = await chrome.tabs.create({url: 'https://merch.amazon.com/designs/new', active: false});
    activeTabs.set(index, tab.id); addTabLink(index, tab.id);
    await waitForTabLoad(tab.id); checkRunning();
    const loaded = await chrome.tabs.get(tab.id);
    const url = new URL(loaded.url || 'about:blank');
    if (url.protocol !== 'https:' || url.hostname !== 'merch.amazon.com' || /signin|login/i.test(url.pathname)) {
      throw new Error('Sign into Merch on Demand in Chrome, then inspect this tab before retrying.');
    }
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['content.js']}); checkRunning();
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'FILL_LISTING', autoPublish, designBase64, designFileName: file.name,
      listing: {title: row.title, brand: row.brand_name, bullet1: row.bullet_point_1, bullet2: row.bullet_point_2, description: row.description, delay}
    });
    // Never retry a message that may already have uploaded or submitted a design.
    if (!response?.success) {
      if (response?.fieldDiagnostics?.length) addLog('info', `#${index + 1} visible field identifiers: ${JSON.stringify(response.fieldDiagnostics)}`);
      throw new Error(response?.error || 'No response from Amazon tab. Inspect it before retrying.');
    }
    if (!['prepared', 'submitted'].includes(response.status)) throw new Error('Unexpected content-script response. Inspect the Amazon tab.');
    updateQueueStatus(index, response.status, response.status === 'prepared' ? 'Review' : 'Submitted · unverified');
    addLog('ok', `#${index + 1}: ${response.status === 'prepared' ? 'Prepared for manual review' : 'Publish clicked; verify submission in Amazon'}.`);
  } catch (error) {
    updateQueueStatus(index, isUploading ? 'error' : 'stopped', isUploading ? 'Failed' : 'Stopped');
    addLog('err', `#${index + 1}: ${error.message}`);
  } finally { activeTabs.delete(index); updateProgress(); }
}
async function startUpload() {
  if (runnerActive || !checkDesignMatches() || !statuses.includes('pending')) return;
  showError();
  if (!globalThis.chrome?.tabs || !chrome.scripting) { showError('Open this uploader from the installed Chrome extension to prepare listings.'); return; }
  const delay = Number($('#actionDelay').value);
  if (!Number.isInteger(delay) || delay < 500 || delay > 10000) { showError('Action delay must be an integer from 500 to 10000 ms.'); return; }
  const autoPublish = $('#autoPublish').checked;
  if (autoPublish && !confirm('Automatically click Publish for each listing using Amazon’s current product, price and marketplace defaults? Submissions cannot be undone by Stop. Only continue if you have tested these defaults.')) return;
  runnerActive = true; isUploading = true; lockControls(true);
  $('#stopUpload').style.display = ''; $('#stopUpload').disabled = false; $('#stopUpload').textContent = 'Stop';
  $('#progressSection').style.display = 'block'; updateProgress();
  const pending = statuses.map((status, index) => status === 'pending' ? index : -1).filter(i => i >= 0);
  addLog('info', `Preparing ${pending.length} pending listings, ${concurrentTabs} tab(s) at a time.`);
  try {
    for (let offset = 0; offset < pending.length && isUploading; offset += concurrentTabs) {
      await Promise.all(pending.slice(offset, offset + concurrentTabs).map(index => processRow(index, delay, autoPublish)));
    }
  } finally {
    isUploading = false; runnerActive = false; lockControls(false);
    $('#stopUpload').style.display = 'none';
    $('#startUpload').textContent = statuses.includes('pending') ? 'Continue Pending Listings' : 'Queue Finished';
    const count = status => statuses.filter(s => s === status).length;
    addLog('info', `Queue settled: ${count('prepared')} prepared, ${count('submitted')} submitted (unverified), ${count('error')} failed, ${count('stopped')} stopped, ${count('pending')} pending. Inspect retained Amazon tabs.`);
  }
}
function stopUpload() {
  if (!runnerActive) return;
  isUploading = false;
  $('#stopUpload').disabled = true; $('#stopUpload').textContent = 'Stopping…';
  addLog('warn', 'Stopping active work and leaving all Amazon tabs open. Already submitted listings cannot be cancelled.');
  for (const tabId of activeTabs.values()) chrome.tabs.sendMessage(tabId, {action: 'CANCEL_FILL'}).catch(() => {});
}
$('#startUpload').addEventListener('click', startUpload);
$('#stopUpload').addEventListener('click', stopUpload);
window.addEventListener('beforeunload', e => {
  if (runnerActive) { stopUpload(); e.preventDefault(); e.returnValue = ''; }
});
window.addEventListener('unload', clearPreviews);
