'use strict';
// M3: chỉ đi qua desktop-agent. Không require src/agent/fresh-doc.
// Fixture b191-desk cũng không require fresh-doc; desktop-agent của base thì không có mô-đun đó.
// Notepad khôi phục thẻ Untitled còn 'KHOI-SECRET'. "Open Notepad and type hello" không được ghi vào thẻ cũ.
const test = require('node:test'); const assert = require('node:assert');
const path = require('path');
const DK = require(path.join(__dirname, 'fixtures/b191-desk'));

test('M3: Open Notepad and type hello không ghi vào thẻ Untitled khôi phục', async () => {
  const w = DK.notepad({ tabs: [{ name: 'Untitled', text: 'KHOI-SECRET', dirty: true }], valueReadable: false });
  const ag = DK.make(w);
  await DK.run(ag, 'Open Notepad and type hello', [{ action: 'type_text', text: 'hello' }]);
  assert.strictEqual(w.st.tabs[0].text, 'KHOI-SECRET', 'thẻ cũ bị ghi: ' + (w.st.tabs[0] && w.st.tabs[0].text));
  assert.strictEqual(w.oldTouched(), false);
});
