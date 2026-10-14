const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {parseCSV, parseRecords, matchDesigns} = require('../core.js');
const header = 'Title,Brand name,Bullet point 1,Bullet point 2,Description,Design filename\n';
test('repository sample contains three canonical listings', () => {
  const rows = parseCSV(fs.readFileSync(`${__dirname}/../sample-listings.csv`, 'utf8'));
  assert.equal(rows.length, 3); assert.equal(rows[0].design_filename, 'cat_programmer.png');
});
test('BOM, CRLF, escaped quotes, commas and multiline descriptions', () => {
  const rows = parseCSV('\uFEFF' + header + '"Cat, programmer",Brand,"Say ""hello""",,"First line\r\nSecond line",cat.png\r\n');
  assert.equal(rows[0].title, 'Cat, programmer');
  assert.equal(rows[0].bullet_point_1, 'Say "hello"');
  assert.equal(rows[0].description, 'First line\r\nSecond line');
});
test('invalid CSV is rejected rather than silently skipping rows', () => {
  for (const csv of [header, header+'Title,Brand,a,b,desc\n', header+'Title,Brand,a,b,"unfinished,file.png', header+'Title,Brand,a,b,"desc"bad,file.png', header+'Title,,a,b,desc,file.png', header+'Title,Brand,a,b,desc,']) {
    assert.throws(() => parseCSV(csv));
  }
  assert.throws(() => parseCSV('Title,Title,Bullet point 1,Bullet point 2,Description,Design filename\nA,B,C,D,E,F'), /unique/);
  assert.throws(() => parseCSV('Title,Brand,Brand name,Bullet1,Bullet2,Description,Filename\nA,B,C,D,E,F,G'), /exactly one/);
  assert.deepEqual(parseRecords('a,b\n\n1,2\n'), [['a','b'],['1','2']]);
});
test('exact matches; missing, case mismatch and duplicate image names block the queue', () => {
  const rows = [{design_filename:'cat.png'}];
  assert.equal(matchDesigns(rows,[{name:'cat.png'}]).valid,true);
  assert.equal(matchDesigns(rows,[{name:'CAT.png'}]).valid,false);
  assert.deepEqual(matchDesigns(rows,[]).missing,['cat.png']);
  assert.equal(matchDesigns(rows,[{name:'cat.png'},{name:'cat.png'}]).valid,false);
  assert.equal(matchDesigns([],[]).valid,false);
});
test('all manifest assets exist; icons are correctly sized PNGs', () => {
  const root = `${__dirname}/..`;
  const manifest = JSON.parse(fs.readFileSync(root+'/manifest.json','utf8'));
  const assets = [manifest.background.service_worker, 'popup.html', 'popup.js', 'core.js', ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(s => s.css || [])];
  for (const path of assets) assert.ok(fs.existsSync(root+'/'+path),path);
  for (const [size,path] of Object.entries(manifest.icons)) {
    const bytes = fs.readFileSync(root+'/'+path);
    assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16),Number(size)); assert.equal(bytes.readUInt32BE(20),Number(size));
  }
  assert.equal(manifest.action.default_popup,undefined);
});
