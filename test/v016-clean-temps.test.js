'use strict';
// #82 / review #55: tệp tạm trong nhật ký chỉ được xoá bên trong thư mục đích.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const MD = require('../src/models-dir');

test('cleanTemps không xoá tệp nằm ngoài thư mục đích', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-clean-temps-'));
  try {
    const from = path.join(base, 'from'), to = path.join(base, 'to');
    fs.mkdirSync(from); fs.mkdirSync(to);
    const outside = path.join(base, 'x.aivn-moving-y');
    const inside = path.join(to, 'a.aivn-moving-b');
    fs.writeFileSync(outside, 'giữ lại'); fs.writeFileSync(inside, 'tạm');
    const journal = path.join(base, 'models-move.json');
    fs.writeFileSync(journal, JSON.stringify({ from, to, rels: [], created: [], temps: ['../x.aivn-moving-y', 'a.aivn-moving-b'], phase: 'moving' }));
    await MD.recoverMove(journal);
    assert.ok(fs.existsSync(outside), 'tệp ngoài thư mục đích phải còn');
    assert.ok(!fs.existsSync(inside), 'tệp tạm trong thư mục đích vẫn được dọn');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});