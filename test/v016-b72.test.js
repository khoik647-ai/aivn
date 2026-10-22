'use strict';
// QA lượt 8 B72 (macOS): chọn hết/dán khi gõ chữ phải bấm ⌘ bằng cờ libnut có thật trên darwin ('cmd'), không phải 'command' (libnut không có cờ đó → lỗi)
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const K = require('../src/agent/keys');
const ROOT = path.join(__dirname, '..');
const flagsOf = (pf) => { const f = path.join(ROOT, 'node_modules/@nut-tree-fork', 'libnut-' + pf, 'build/Release/libnut.node'); if (!fs.existsSync(f)) return null; try { return new Set(execFileSync('strings', ['-n', '3', f], { maxBuffer: 1 << 28 }).toString().split('\n')); } catch { return null; } };
test('B72: phím lệnh chính theo nền tảng — ⌘ (cmd) trên macOS, Ctrl trên Windows/Linux', () => {
  assert.strictEqual(K.primaryOf('darwin'), 'cmd'); assert.strictEqual(K.primaryOf('win32'), 'control'); assert.strictEqual(K.primaryOf('linux'), 'control');
  assert.deepStrictEqual(K.parse('cmd+v', 'darwin').mods, ['cmd']); assert.deepStrictEqual(K.parse('cmd+v', 'win32').mods, ['control']);
});
test('B72: mọi cờ phím bổ trợ AIVN gửi cho libnut đều có thật trong bản libnut của nền tảng đó (darwin, win32)', () => {
  for (const pf of ['darwin', 'win32']) {
    const have = flagsOf(pf); if (!have) continue;
    const sent = new Set([K.primaryOf(pf), K.metaOf(pf)]);
    for (const c of ['ctrl+a', 'cmd+v', 'command+c', 'win+s', 'meta+e', 'alt+tab', 'ctrl+shift+z', 'right_alt+a', 'option+f']) { try { for (const m of K.parse(c, pf).mods) sent.add(m); } catch {} }
    for (const m of sent) assert.ok(have.has(m), `${pf}: libnut không có cờ “${m}”`);
    assert.ok(!have.has('command') || pf !== 'darwin', 'bản darwin không có cờ command — giữ nguyên giả định');
  }
});
test('B72: đường gõ bằng dán (desktop-agent, screen-control) dùng primaryOf(process.platform), không còn cờ “command”', () => {
  for (const f of ['src/desktop-agent.js', 'src/screen-control.js']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/keyTap\([^)]*['"]command['"]/.test(s), f + ': còn keyTap(..., "command")');
    assert.ok(/keyTap\('v', [^\n]*?primaryOf\(process\.platform\)\)/.test(s), f + ': dán phải dùng primaryOf');
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'src/desktop-agent.js'), 'utf8'), /keyTap\('a', require\('\.\/agent\/keys'\)\.primaryOf\(process\.platform\)\)/);
});
