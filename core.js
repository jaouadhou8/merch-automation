// Shared, dependency-free CSV and matching rules (also used by Node tests).
(function(root) {
  'use strict';
  const aliases = {
    title: ['title'], brand_name: ['brand_name', 'brand'],
    bullet_point_1: ['bullet_point_1', 'bullet1', 'bullet_1'],
    bullet_point_2: ['bullet_point_2', 'bullet2', 'bullet_2'],
    description: ['description', 'desc'],
    design_filename: ['design_filename', 'design_file', 'filename', 'file_name', 'image_file', 'design', 'image']
  };
  function parseRecords(text) {
    text = String(text).replace(/^\uFEFF/, '');
    const records = [];
    let row = [], field = '', quoted = false, closed = false;
    const finishField = () => { row.push(field); field = ''; closed = false; };
    const finishRow = () => { finishField(); if (row.some(v => v.trim())) records.push(row); row = []; };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { quoted = false; closed = true; }
        } else { field += ch; }
      } else if (ch === ',') { finishField(); }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        finishRow();
      } else if (ch === '"') {
        if (field || closed) throw new Error('Unexpected quote in CSV. Quote the entire field.');
        quoted = true;
      } else {
        if (closed && !/\s/.test(ch)) throw new Error('Unexpected text after a quoted CSV field.');
        if (!closed) field += ch;
      }
    }
    if (quoted) throw new Error('Unclosed quoted CSV field.');
    finishRow();
    return records;
  }
  function parseCSV(text) {
    const records = parseRecords(text);
    if (records.length < 2) throw new Error('CSV must contain a header and at least one listing.');
    const headers = records.shift().map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
    if (headers.some(h => !h) || new Set(headers).size !== headers.length) {
      throw new Error('CSV headers must be nonempty and unique.');
    }
    const columns = {};
    for (const [name, names] of Object.entries(aliases)) {
      const matches = headers.map((h, i) => names.includes(h) ? i : -1).filter(i => i >= 0);
      if (matches.length !== 1) throw new Error(`CSV needs exactly one ${name.replaceAll('_', ' ')} column.`);
      columns[name] = matches[0];
    }
    return records.map((values, i) => {
      if (values.length !== headers.length) throw new Error(`Listing ${i + 1}: expected ${headers.length} columns, found ${values.length}.`);
      const row = {};
      for (const [name, index] of Object.entries(columns)) row[name] = values[index].trim();
      for (const name of ['title', 'brand_name', 'design_filename']) {
        if (!row[name]) throw new Error(`Listing ${i + 1}: ${name.replaceAll('_', ' ')} is empty.`);
      }
      return row;
    });
  }
  function matchDesigns(rows, files) {
    const available = new Map(), duplicates = new Set();
    for (const file of files) {
      if (available.has(file.name)) duplicates.add(file.name);
      available.set(file.name, file);
    }
    const missing = rows.filter(row => !available.has(row.design_filename)).map(row => row.design_filename);
    return {available, missing, duplicates: [...duplicates], valid: rows.length > 0 && !missing.length && !duplicates.size};
  }
  const api = {parseCSV, parseRecords, matchDesigns};
  root.MerchCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
