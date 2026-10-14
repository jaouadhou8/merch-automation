// ── State ─────────────────────────────
let csvData = [];
let designFiles = {};  // filename -> File
let concurrentTabs = 5;
let isUploading = false;

// ── DOM References ───────────────────
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ── CSV Parsing ──────────────────────
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < 5) continue;

    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim().toLowerCase().replace(/\s+/g, '_')] = (values[idx] || '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ── Step Navigation ──────────────────
function goToStep(num) {
  $$('.panel').forEach(p => p.style.display = 'none');
  $(`#step${num}`).style.display = 'block';

  $$('.step').forEach(s => {
    const sNum = parseInt(s.dataset.step);
    s.classList.remove('active', 'done');
    if (sNum === num) s.classList.add('active');
    else if (sNum < num) s.classList.add('done');
  });
}

// ── CSV Upload ───────────────────────
const csvDropZone = $('#csvDropZone');
const csvInput = $('#csvInput');

csvDropZone.addEventListener('click', () => csvInput.click());
csvDropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  csvDropZone.style.borderColor = 'var(--accent)';
});
csvDropZone.addEventListener('dragleave', () => {
  csvDropZone.style.borderColor = 'var(--border)';
});
csvDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  csvDropZone.style.borderColor = 'var(--border)';
  if (e.dataTransfer.files.length) handleCSVFile(e.dataTransfer.files[0]);
});

csvInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleCSVFile(e.target.files[0]);
});

function handleCSVFile(file) {
  if (!file.name.endsWith('.csv')) {
    alert('Please select a CSV file');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    csvData = parseCSV(e.target.result);
    if (csvData.length === 0) {
      alert('No valid rows found in CSV. Check the format.');
      return;
    }

    // Show info
    $('#csvFileName').textContent = file.name;
    $('#csvRows').textContent = csvData.length;
    $('#csvCols').textContent = Object.keys(csvData[0]).length;
    $('#csvInfo').style.display = 'block';
    csvDropZone.style.display = 'none';
    $('#toStep2').disabled = false;
  };
  reader.readAsText(file);
}

$('#csvRemove').addEventListener('click', () => {
  csvData = [];
  csvInput.value = '';
  $('#csvInfo').style.display = 'none';
  csvDropZone.style.display = '';
  $('#toStep2').disabled = true;
});

$('#toStep2').addEventListener('click', () => goToStep(2));

// ── Design Files ─────────────────────
const designDropZone = $('#designDropZone');
const designInput = $('#designInput');
const designFilesInput = $('#designFilesInput');

designDropZone.addEventListener('click', () => {
  if ($('#selectFolder').checked) {
    designInput.click();
  } else {
    designFilesInput.click();
  }
});

$('#selectFiles').addEventListener('click', () => {
  $('#selectFolder').checked = false;
  designFilesInput.click();
});

designInput.addEventListener('change', (e) => handleDesignFiles(e.target.files));
designFilesInput.addEventListener('change', (e) => handleDesignFiles(e.target.files));

designDropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  designDropZone.style.borderColor = 'var(--accent)';
});
designDropZone.addEventListener('dragleave', () => {
  designDropZone.style.borderColor = 'var(--border)';
});
designDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  designDropZone.style.borderColor = 'var(--border)';
  handleDesignFiles(e.dataTransfer.files);
});

function handleDesignFiles(files) {
  designFiles = {};
  const imageFiles = Array.from(files).filter(f =>
    f.type === 'image/png' || f.type === 'image/jpeg'
  );

  imageFiles.forEach(f => {
    designFiles[f.name] = f;
  });

  // Update UI
  $('#designCount').textContent = `${imageFiles.length} images loaded`;
  $('#designInfo').style.display = 'block';
  designDropZone.style.display = 'none';

  // Thumbnails (max 8)
  const preview = $('#designPreview');
  preview.innerHTML = '';
  imageFiles.slice(0, 8).forEach(f => {
    const img = document.createElement('img');
    img.className = 'design-thumb';
    img.src = URL.createObjectURL(f);
    preview.appendChild(img);
  });
  if (imageFiles.length > 8) {
    const more = document.createElement('span');
    more.style.cssText = 'font-size:11px;color:var(--text-dim);align-self:center;';
    more.textContent = `+${imageFiles.length - 8} more`;
    preview.appendChild(more);
  }

  // Check matches
  checkDesignMatches();
}

function checkDesignMatches() {
  const matchEl = $('#matchStatus');
  // Try to find the design filename column
  const designKey = findDesignKey(csvData[0]);

  if (!designKey) {
    matchEl.innerHTML = '<span class="match-warn">⚠ No "design filename" column found in CSV. Will use row order.</span>';
    $('#toStep3').disabled = false;
    return;
  }

  let matched = 0;
  let missing = [];

  csvData.forEach((row, i) => {
    const fname = row[designKey];
    if (fname && designFiles[fname]) {
      matched++;
    } else if (fname) {
      missing.push(fname);
    }
  });

  if (missing.length === 0) {
    matchEl.innerHTML = `<span class="match-ok">✓ All ${matched} designs matched to CSV rows</span>`;
  } else {
    matchEl.innerHTML = `<span class="match-warn">⚠ ${matched} matched, ${missing.length} missing: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '...' : ''}</span>`;
  }

  $('#toStep3').disabled = false;
}

function findDesignKey(row) {
  if (!row) return null;
  const keys = Object.keys(row);
  const candidates = ['design_filename', 'design', 'filename', 'file', 'image', 'design_file', 'file_name', 'image_file'];
  for (const c of candidates) {
    if (keys.includes(c)) return c;
  }
  // Partial match
  for (const k of keys) {
    if (k.includes('design') || k.includes('file') || k.includes('image')) return k;
  }
  return null;
}

$('#backToStep1').addEventListener('click', () => goToStep(1));
$('#toStep3').addEventListener('click', () => {
  buildQueue();
  goToStep(3);
});

// ── Tab Stepper ──────────────────────
$('#tabsMinus').addEventListener('click', () => {
  if (concurrentTabs > 1) {
    concurrentTabs--;
    $('#tabsCount').textContent = concurrentTabs;
  }
});

$('#tabsPlus').addEventListener('click', () => {
  if (concurrentTabs < 10) {
    concurrentTabs++;
    $('#tabsCount').textContent = concurrentTabs;
  }
});

// ── Queue ────────────────────────────
function buildQueue() {
  const list = $('#queueList');
  list.innerHTML = '';

  const designKey = csvData.length > 0 ? findDesignKey(csvData[0]) : null;

  csvData.forEach((row, i) => {
    const titleKey = Object.keys(row).find(k => k === 'title' || k.includes('title'));
    const title = titleKey ? row[titleKey] : `Listing ${i + 1}`;

    const item = document.createElement('div');
    item.className = 'queue-item';
    item.id = `queue-${i}`;
    item.innerHTML = `
      <span class="queue-num">#${i + 1}</span>
      <span class="queue-title">${escapeHtml(title)}</span>
      <span class="queue-status status-pending">Pending</span>
    `;
    list.appendChild(item);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Upload Orchestration ─────────────
$('#backToStep2').addEventListener('click', () => goToStep(2));

$('#startUpload').addEventListener('click', startUpload);
$('#stopUpload').addEventListener('click', stopUpload);

async function startUpload() {
  isUploading = true;
  $('#startUpload').style.display = 'none';
  $('#stopUpload').style.display = '';
  $('#backToStep2').style.display = 'none';
  $('#progressSection').style.display = 'block';

  const delay = parseInt($('#actionDelay').value) || 1500;
  const productType = $('#productType').value;
  const designKey = csvData.length > 0 ? findDesignKey(csvData[0]) : null;

  let completed = 0;
  let failed = 0;
  const total = csvData.length;

  addLog('info', `Starting upload of ${total} listings (${concurrentTabs} tabs)...`);

  // Process in batches of concurrentTabs
  for (let batch = 0; batch < total && isUploading; batch += concurrentTabs) {
    const batchItems = csvData.slice(batch, Math.min(batch + concurrentTabs, total));
    const batchIndices = batchItems.map((_, i) => batch + i);

    addLog('info', `Batch ${Math.floor(batch / concurrentTabs) + 1}: Opening ${batchItems.length} tabs...`);

    // Mark active
    batchIndices.forEach(i => updateQueueStatus(i, 'active', 'Uploading'));

    // Prepare data for each item in the batch
    const uploadPromises = batchItems.map(async (row, bIdx) => {
      const idx = batch + bIdx;

      try {
        // Collect row data with flexible key matching
        const listing = {
          title: getField(row, ['title']),
          brand: getField(row, ['brand_name', 'brand']),
          bullet1: getField(row, ['bullet_point_1', 'bullet1', 'bullet_1']),
          bullet2: getField(row, ['bullet_point_2', 'bullet2', 'bullet_2']),
          description: getField(row, ['description', 'desc']),
          productType: productType,
          delay: delay
        };

        // Get design file
        let designFile = null;
        if (designKey && row[designKey]) {
          designFile = designFiles[row[designKey]];
        }
        // Fallback: try to match by index
        if (!designFile) {
          const allFiles = Object.values(designFiles);
          if (allFiles[idx]) designFile = allFiles[idx];
        }

        // Convert design file to base64 for transfer
        let designBase64 = null;
        if (designFile) {
          designBase64 = await fileToBase64(designFile);
        }

        // Open tab and execute upload
        const tab = await chrome.tabs.create({
          url: 'https://merch.amazon.com/designs/new',
          active: false
        });

        // Wait for tab to load
        await waitForTabLoad(tab.id);
        await sleep(delay);

        // Inject content script
        addLog('info', `#${idx + 1}: Injecting content script...`);
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });

        // Wait for content script to initialize
        await sleep(2000);

        // Send listing data to content script
        addLog('info', `#${idx + 1}: Sending data to tab...`);
        let response;
        try {
          response = await chrome.tabs.sendMessage(tab.id, {
            action: 'FILL_LISTING',
            listing: listing,
            designBase64: designBase64,
            designFileName: designFile ? designFile.name : null
          });
        } catch (msgErr) {
          // Retry once if message fails
          addLog('warn', `#${idx + 1}: First message failed, retrying...`);
          await sleep(2000);
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          await sleep(1000);
          response = await chrome.tabs.sendMessage(tab.id, {
            action: 'FILL_LISTING',
            listing: listing,
            designBase64: designBase64,
            designFileName: designFile ? designFile.name : null
          });
        }

        if (response && response.success) {
          completed++;
          updateQueueStatus(idx, 'done', 'Done');
          addLog('ok', `✓ #${idx + 1}: "${listing.title}" uploaded`);
        } else {
          throw new Error(response?.error || 'Unknown error');
        }

        // Close tab after completion
        await sleep(1000);
        try { await chrome.tabs.remove(tab.id); } catch (e) {}

      } catch (err) {
        failed++;
        updateQueueStatus(idx, 'error', 'Failed');
        addLog('err', `✗ #${idx + 1}: ${err.message}`);
      }

      updateProgress(completed + failed, total);
    });

    await Promise.all(uploadPromises);
    await sleep(delay);
  }

  addLog(failed === 0 ? 'ok' : 'warn',
    `Upload complete: ${completed} succeeded, ${failed} failed out of ${total}`
  );
  isUploading = false;
  $('#stopUpload').style.display = 'none';
}

function stopUpload() {
  isUploading = false;
  addLog('warn', 'Upload stopped by user');
  $('#stopUpload').style.display = 'none';
  $('#startUpload').style.display = '';
  $('#startUpload').innerHTML = `
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M4 2L16 9L4 16V2Z" fill="currentColor"/>
    </svg>
    Resume Upload
  `;
  $('#backToStep2').style.display = '';
}

// ── Helpers ──────────────────────────
function getField(row, possibleKeys) {
  for (const key of possibleKeys) {
    if (row[key] !== undefined) return row[key];
  }
  // Fuzzy match
  const rowKeys = Object.keys(row);
  for (const pk of possibleKeys) {
    const found = rowKeys.find(k => k.includes(pk));
    if (found) return row[found];
  }
  return '';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    // Timeout after 30s
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 30000);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function updateQueueStatus(index, status, text) {
  const el = $(`#queue-${index} .queue-status`);
  if (el) {
    el.className = `queue-status status-${status}`;
    el.textContent = text;
  }
}

function updateProgress(done, total) {
  const pct = Math.round((done / total) * 100);
  $('#progressBar').style.width = `${pct}%`;
  $('#progressText').textContent = `${done} / ${total}`;
  $('#progressPercent').textContent = `${pct}%`;
}

function addLog(type, message) {
  const log = $('#logArea');
  const line = document.createElement('div');
  line.className = `log-${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}
