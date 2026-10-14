const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('toolbar click opens one persistent controller and focuses the existing tab', async () => {
  let click, tabs = [], created = 0, updated = 0, focused = 0;
  const chrome = {action:{onClicked:{addListener(fn){click=fn;}}},runtime:{getURL:p=>'chrome-extension://test/'+p},
    tabs:{async query(){return tabs;},async create(){created++; tabs=[{id:7,windowId:8}];},async update(id){assert.equal(id,7);updated++;}},
    windows:{async update(id){assert.equal(id,8);focused++;}}};
  vm.runInNewContext(fs.readFileSync(`${__dirname}/../background.js`,'utf8'), {chrome, console});
  click(); click(); await new Promise(r=>setImmediate(r));
  assert.equal(created,1);
  click(); await new Promise(r=>setImmediate(r));
  assert.equal(created,1); assert.equal(updated,1);assert.equal(focused,1);
});
