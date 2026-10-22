'use strict';
// Máy thật (beta.2, DESKTOP-2G546S3): “win + d”, “win + s” → “Invalid key flag specified.”, ctrl+f chạy. Gốc: phím Windows bị đổi thành cờ
// “command” (libnut Windows không có). Mọi phím bổ trợ / phím mở rộng phải ra tên CÓ THẬT trong tệp .node của libnut ở từng hệ điều hành.
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path'); const { spawnSync } = require('child_process');
const K = require('../src/agent/keys');
const NODE = (pf) => { const d = path.join(__dirname, '..', 'node_modules/@nut-tree-fork/libnut-' + pf); const walk = (p) => fs.statSync(p).isDirectory() ? fs.readdirSync(p).flatMap(x => walk(path.join(p, x))) : [p]; return fs.existsSync(d) ? walk(d).find(f => f.endsWith('.node')) : null; };
const names = {}; for (const pf of ['win32', 'linux', 'darwin']) { const f = NODE(pf); names[pf] = f ? new Set(spawnSync('strings', ['-n', '2', f], { encoding: 'utf8', maxBuffer: 64e6 }).stdout.split('\n')) : null; }
// libnut-linux không để lộ chuỗi tên phím ngắn trong tệp .node → đối chiếu bảng tên chung (win32 ∪ darwin) + thử thật trên Xvfb bên dưới
if (names.linux && names.win32 && names.darwin) names.linux = new Set([...names.linux, ...[...names.win32].filter(n => names.darwin.has(n))]);
const okName = (pf, n) => /^[a-z0-9]$/.test(n) || n.length === 1 || /^f([1-9]|1\d|2[0-4])$/.test(n) || names[pf].has(n);
const CASES = {
  // phím bổ trợ (cách viết khác nhau, có/không dấu cách quanh “+”)
  'win + d': 'meta+d', 'win+s': 'meta+s', 'Win + S': 'meta+s', '  WIN+E ': 'meta+e', 'windows+r': null, 'super+a': 'meta+a', 'meta + tab': 'meta+tab', 'win + shift + s': 'meta+shift+s',
  'ctrl+f': 'control+f', ' Ctrl + L ': 'control+l', 'control+t': 'control+t', 'ctrl + h': 'control+h', 'ctrl+shift+esc': null, 'alt+tab': 'alt+tab', 'Alt + F4': null, 'shift+f10': 'shift+f10',
  'right ctrl+c': 'right_control+c', 'rshift+a': 'right_shift+a', 'altgr+e': 'right_alt+e', 'right win+x': null,
  // phím mở rộng
  up: 'up', down: 'down', left: 'left', right: 'right', 'arrow up': 'up', home: 'home', end: 'end', pgup: 'pageup', 'page down': 'pagedown', ins: 'insert', del: 'delete', 'ctrl+home': 'control+home', 'shift+end': 'shift+end', printscreen: 'printscreen', menu: 'menu',
  // bàn phím số, F, đa phương tiện
  numpad0: 'numpad_0', 'num 5': 'numpad_5', numpad9: 'numpad_9', 'numpad decimal': 'numpad_decimal', f1: 'f1', F12: 'f12', f24: 'f24',
  'volume up': 'audio_vol_up', voldown: 'audio_vol_down', mute: 'audio_mute', 'play pause': 'audio_play', 'next track': 'audio_next', prevtrack: 'audio_prev', 'media stop': 'audio_stop',
  enter: 'enter', 'ctrl+enter': 'control+enter', esc: 'escape', tab: 'tab', space: 'space', backspace: 'backspace',
};
for (const pf of ['win32', 'linux', 'darwin']) {
  test(`mọi phím bổ trợ / mở rộng / số / F / đa phương tiện ra tên có thật trong libnut-${pf}`, { skip: !names[pf] && 'thiếu libnut-' + pf }, () => {
    for (const [c, want] of Object.entries(CASES)) {
      let k; try { k = K.parse(c, pf); } catch (e) { if (want === null) continue; throw new Error(`${c}: ${e.message}`); }
      if (want === null) { if (c === 'windows+r' || c === 'right win+x') continue; assert.fail(`${c} phải bị chặn`); }
      const exp = pf === 'darwin' ? want.replace(/\bmeta\b/g, 'cmd').replace('right_cmd', 'right_cmd') : want;
      assert.strictEqual(k.combo, exp, `${pf} ${c}`);
      for (const n of [...k.mods, k.key]) assert.ok(okName(pf, n), `${pf}: “${n}” (từ “${c}”) không có trong libnut`);
      assert.ok(!k.mods.includes('command') && k.key !== 'command', 'không bao giờ dùng cờ “command”');
    }
  });
}
test('Windows: phím Windows = VK_LWIN 0x5B + EXTENDEDKEY; mũi tên/Home/End/PgUp/PgDn/Ins/Del/Ctrl-Alt phải/đa phương tiện có EXTENDEDKEY', () => {
  assert.deepStrictEqual(K.vkOf('meta'), { vk: 0x5b, scan: 0x5b, ext: true });
  for (const n of ['up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'insert', 'delete', 'right_control', 'right_alt', 'right_meta', 'audio_vol_up', 'audio_mute', 'audio_next', 'printscreen', 'menu']) assert.strictEqual(K.vkOf(n).ext, true, n);
  for (const n of ['control', 'shift', 'alt', 'a', 'f5', 'numpad_5', 'enter']) assert.strictEqual(K.vkOf(n).ext, false, n);
  assert.strictEqual(K.vkOf('numpad_7').vk, 0x67); assert.strictEqual(K.vkOf('f12').vk, 0x7b); assert.strictEqual(K.vkOf('f24').vk, 0x87);
  const d = K.diag(K.parse('win + s', 'win32'), 'win32'); assert.match(d, /meta VK 0x5B quét 0x5B \+EXTENDEDKEY/); assert.match(d, /s VK 0x53 quét 0x1F/); assert.match(d, /cờ libnut \[meta\]/);
});
test('an toàn: Win+D chỉ khi được yêu cầu (hidesAll); phím âm lượng/nhạc không bấm bằng phím tắt (cần xin phép qua công cụ hệ thống)', () => {
  assert.strictEqual(K.parse('win + d', 'win32').hidesAll, true); assert.strictEqual(K.parse('volume up', 'win32').media, true); assert.strictEqual(K.parse('ctrl+f', 'win32').media, false);
  for (const c of ['ctrl+alt+del', 'ctrl + alt + delete', 'ctrl+shift+esc', 'alt+f4', 'win+l']) assert.throws(() => K.parse(c, 'win32'), /không bấm/, c);
  const src = fs.readFileSync(path.join(__dirname, '../src/desktop-agent.js'), 'utf8'); assert.match(src, /if \(k\.media\) throw new Error/);
});

test('Linux thật (Xvfb): phím mới (bàn phím số, Ctrl phải, Insert, F12) bấm được, không báo lỗi', { skip: spawnSync('which', ['Xvfb']).status !== 0 && 'cần Xvfb' }, () => {
  const disp = ':' + (80 + Math.floor(Math.random() * 9)); const x = require('child_process').spawn('Xvfb', [disp, '-screen', '0', '640x480x24'], { stdio: 'ignore' });
  try { spawnSync('sleep', ['1']);
    const probe = (combo) => { const k = K.parse(combo, 'linux'); return spawnSync(process.execPath, ['-e', `const n=require('@nut-tree-fork/libnut-linux');try{n.keyTap(${JSON.stringify(k.key)},${JSON.stringify(k.mods)});console.log('ok')}catch(e){console.log('ERR '+e.message)}`], { cwd: path.join(__dirname, '..'), env: { ...process.env, DISPLAY: disp }, encoding: 'utf8' }).stdout.trim(); };
    for (const c of ['num 5', 'numpad decimal', 'right ctrl+c', 'rshift+a', 'insert', 'f12', /* 'menu', 'f13': bố cục phím của Xvfb không có keysym Menu/F13 (Windows: VK_APPS) */ 'win + s', 'ctrl + l', 'page down']) assert.strictEqual(probe(c), 'ok', c);
  } finally { x.kill(); }
});
