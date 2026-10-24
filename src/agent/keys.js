// Phím tắt → tên phím/cờ của libnut cho TỪNG hệ điều hành (B66c).
// Lỗi thật trên Windows: AIVN đổi "win"/"cmd" thành cờ "command" — libnut không có cờ đó trên Windows/Linux (chỉ có meta/win;
// "cmd" chỉ có trên macOS) → mọi tổ hợp Win+… báo “Invalid key flag specified.”, và Cmd+V/Cmd+A trên macOS cũng hỏng.
// Ở đây chỉ trả về tên có thật trong bảng phím của libnut ở hệ điều hành đó (kiểm thử đối chiếu với chính tệp .node).
const MOD_NAMES = ['control', 'alt', 'shift', 'meta', 'cmd', 'right_control', 'right_alt', 'right_shift', 'right_meta', 'right_cmd'];
const metaOf = (pf) => (pf === 'darwin' ? 'cmd' : 'meta');      // phím Windows / Super / ⌘
const primaryOf = (pf) => (pf === 'darwin' ? 'cmd' : 'control'); // phím lệnh chính: Ctrl (Windows/Linux), ⌘ (macOS)
function keymap(pf) {
  const M = metaOf(pf), P = primaryOf(pf);
  return {
    ctrl: 'control', control: 'control', ctl: 'control', strg: 'control',
    // “cmd/command” mô hình viết = phím lệnh chính của máy (⌘ trên macOS, Ctrl trên Windows/Linux — Cmd+F trên Windows là Ctrl+F)
    cmd: P, command: P, '⌘': P,
    win: M, windows: M, meta: M, super: M, os: M, start: M, '⊞': M,
    alt: 'alt', option: 'alt', opt: 'alt', altgr: 'right_alt', shift: 'shift',
    enter: 'enter', return: 'enter', esc: 'escape', escape: 'escape', tab: 'tab', space: 'space', spacebar: 'space',
    backspace: 'backspace', bksp: 'backspace', delete: 'delete', del: 'delete', insert: 'insert', ins: 'insert',
    up: 'up', down: 'down', left: 'left', right: 'right', arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
    home: 'home', end: 'end', pageup: 'pageup', pgup: 'pageup', pagedown: 'pagedown', pgdn: 'pagedown',
    printscreen: 'printscreen', prtsc: 'printscreen', menu: 'menu', capslock: 'caps_lock',
    // dấu câu: libnut nhận đúng MỘT ký tự (tra mã phím theo bố cục bàn phím); “plus” = phím + bên số (Ctrl + “+” phóng to)
    // phím bổ trợ bên PHẢI (viết liền / cách / gạch: “right ctrl”, “rctrl”, “right_shift”…)
    rightctrl: 'right_control', rctrl: 'right_control', rightcontrol: 'right_control', rightshift: 'right_shift', rshift: 'right_shift', rightalt: 'right_alt', ralt: 'right_alt',
    rightwin: 'right_' + M, rwin: 'right_' + M, rightmeta: 'right_' + M, rightcmd: 'right_' + (pf === 'darwin' ? 'cmd' : 'meta'),
    // bàn phím số
    ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap(n => [['numpad' + n, 'numpad_' + n], ['num' + n, 'numpad_' + n], ['kp' + n, 'numpad_' + n]])),
    numpaddecimal: 'numpad_decimal', numdecimal: 'numpad_decimal', numpaddot: 'numpad_decimal', numpadequal: 'numpad_equal',
    numpadenter: 'numpad_enter', kpenter: 'numpad_enter',
    // phím đa phương tiện
    volumeup: 'audio_vol_up', volup: 'audio_vol_up', audiovolumeup: 'audio_vol_up', volumedown: 'audio_vol_down', voldown: 'audio_vol_down', audiovolumedown: 'audio_vol_down',
    mute: 'audio_mute', volumemute: 'audio_mute', audiomute: 'audio_mute', playpause: 'audio_play', mediaplaypause: 'audio_play', play: 'audio_play', mediaplay: 'audio_play',
    pausemedia: 'audio_pause', mediapause: 'audio_pause', nexttrack: 'audio_next', medianext: 'audio_next', mediatracknext: 'audio_next', next: 'audio_next',
    prevtrack: 'audio_prev', previoustrack: 'audio_prev', mediaprev: 'audio_prev', mediatrackprevious: 'audio_prev', prev: 'audio_prev', stop: 'audio_stop', mediastop: 'audio_stop',
    pageup2: 'pageup', printscr: 'printscreen', print: 'printscreen', apps: 'menu', contextmenu: 'menu',
    plus: 'add', minus: '-', '-': '-', '=': '=', ',': ',', '.': '.', '/': '/', ';': ';', '\'': '\'', '[': '[', ']': ']', '\\': '\\', '`': '`',
  };
}
// Mã phím ảo Windows (VK_*) và mã quét (set 1) để ghi nhật ký từng lần bấm — libnut gửi SendInput bằng VK; phím “mở rộng”
// (mũi tên, Home/End, PgUp/PgDn, Insert/Delete, phím Windows, Ctrl/Alt phải) cần cờ KEYEVENTF_EXTENDEDKEY.
const VK = { control: [0x11, 0x1d], right_control: [0xa3, 0x1d, 1], alt: [0x12, 0x38], right_alt: [0xa5, 0x38, 1], shift: [0x10, 0x2a], right_shift: [0xa1, 0x36], meta: [0x5b, 0x5b, 1], cmd: [0x5b, 0x5b, 1],
  enter: [0x0d, 0x1c], numpad_enter: [0x0d, 0x1c, 1], escape: [0x1b, 0x01], tab: [0x09, 0x0f], space: [0x20, 0x39], backspace: [0x08, 0x0e], delete: [0x2e, 0x53, 1], insert: [0x2d, 0x52, 1],
  up: [0x26, 0x48, 1], down: [0x28, 0x50, 1], left: [0x25, 0x4b, 1], right: [0x27, 0x4d, 1], home: [0x24, 0x47, 1], end: [0x23, 0x4f, 1], pageup: [0x21, 0x49, 1], pagedown: [0x22, 0x51, 1],
  printscreen: [0x2c, 0x37, 1], menu: [0x5d, 0x5d, 1], caps_lock: [0x14, 0x3a], add: [0x6b, 0x4e], '-': [0xbd, 0x0c], '=': [0xbb, 0x0d], ',': [0xbc, 0x33], '.': [0xbe, 0x34], '/': [0xbf, 0x35], ';': [0xba, 0x27], '\'': [0xde, 0x28], '[': [0xdb, 0x1a], ']': [0xdd, 0x1b], '\\': [0xdc, 0x2b], '`': [0xc0, 0x29],
  right_meta: [0x5c, 0x5c, 1], right_cmd: [0x5c, 0x5c, 1], numpad_decimal: [0x6e, 0x53], numpad_equal: [0x92, 0x59],
  audio_next: [0xb0, 0x19, 1], audio_prev: [0xb1, 0x10, 1], audio_stop: [0xb2, 0x24, 1], audio_play: [0xb3, 0x22, 1], audio_pause: [0xb3, 0x22, 1],
  audio_mute: [0xad, 0x20, 1], audio_vol_down: [0xae, 0x2e, 1], audio_vol_up: [0xaf, 0x30, 1] };
const SCAN_LETTERS = 'qwertyuiop|asdfghjkl|zxcvbnm'; const SCAN_ROW = [0x10, 0x1e, 0x2c];
function vkOf(k) {
  if (VK[k]) return { vk: VK[k][0], scan: VK[k][1], ext: !!VK[k][2] };
  const np = /^numpad_(\d)$/.exec(k); if (np) return { vk: 0x60 + Number(np[1]), scan: [0x52, 0x4f, 0x50, 0x51, 0x4b, 0x4c, 0x4d, 0x47, 0x48, 0x49][Number(np[1])], ext: false };
  if (/^[a-z]$/.test(k)) { const rows = SCAN_LETTERS.split('|'); const r = rows.findIndex(x => x.includes(k)); return { vk: k.toUpperCase().charCodeAt(0), scan: SCAN_ROW[r] + rows[r].indexOf(k), ext: false }; }
  if (/^[0-9]$/.test(k)) return { vk: k.charCodeAt(0), scan: k === '0' ? 0x0b : 0x01 + Number(k), ext: false };
  const f = /^f(\d{1,2})$/.exec(k); if (f) { const n = Number(f[1]); return { vk: 0x6f + n, scan: n <= 10 ? 0x3a + n : n === 11 ? 0x57 : n === 12 ? 0x58 : 0x5b + n, ext: false }; }
  return { vk: null, scan: null, ext: false };
}
const hex = (n) => (n == null ? '?' : '0x' + n.toString(16).toUpperCase().padStart(2, '0'));
// Tổ hợp hệ thống/đóng ứng dụng: không bao giờ bấm. Win+D / Win+M (thu nhỏ mọi cửa sổ) chỉ khi người dùng xin (B66d).
const BLOCKED = /^(?:control\+alt\+delete|control\+shift\+escape|control\+alt\+escape|cmd\+alt\+escape|cmd\+q|alt\+f4|cmd\+shift\+q|meta\+l|cmd\+control\+q|meta\+x|meta\+r|meta\+i|cmd\+alt\+power)$/;
const HIDE_ALL = /^(?:meta\+d|meta\+m|meta\+shift\+m|cmd\+f3|cmd\+alt\+h\+m)$/;
function parse(combo, pf = process.platform) {
  const raw = String(combo || '').trim(); const lower = raw.toLowerCase().replace(/\s*\+\s*/g, '+');
  const plusEnd = lower === '+' || lower.endsWith('++'); const body = lower === '+' ? '' : plusEnd ? lower.slice(0, -2) : lower;
  const parts = [...body.split('+').map(s => s.trim()).filter(Boolean), ...(plusEnd ? ['plus'] : [])];
  if (!parts.length || parts.length > 4) throw new Error('Phím không hợp lệ: ' + combo);
  const map = keymap(pf);
  const keys = parts.map(p => map[p] || (p.length > 1 && map[p.replace(/[\s_-]+/g, '')]) || (/^f([1-9]|1[0-9]|2[0-4])$/.test(p) || /^[a-z0-9]$/.test(p) ? p : null));
  const bad = parts.filter((p, i) => !keys[i]); if (bad.length) throw new Error(`Phím không hỗ trợ: ${combo} (không biết “${bad.join('”, “')}”)`);
  const key = keys.pop();
  const mods = [...new Set(keys)]; const notMod = mods.filter(m => !MOD_NAMES.includes(m));
  if (notMod.length) throw new Error(`Tổ hợp phím không hợp lệ: ${combo} (“${notMod.join('”, “')}” không phải phím bổ trợ)`);
  // thứ tự cố định để so khớp danh sách chặn
  const order = ['control', 'right_control', 'cmd', 'right_cmd', 'meta', 'right_meta', 'alt', 'right_alt', 'shift', 'right_shift']; mods.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const c = [...mods, key].join('+');
  if (BLOCKED.test(c) || (key === 'delete' && mods.includes('control') && mods.includes('alt'))) throw new Error('AIVN không bấm tổ hợp phím hệ thống/đóng ứng dụng này: ' + combo);
  return { key, mods, combo: c, hidesAll: HIDE_ALL.test(c), media: /^audio_/.test(key) };
}
// Một dòng nhật ký cho mỗi lần bấm phím: tên, VK, mã quét, cờ
function diag(k, pf = process.platform) {
  const one = (name) => { const v = vkOf(name); return `${name} VK ${hex(v.vk)} quét ${hex(v.scan)}${v.ext ? ' +EXTENDEDKEY' : ''}`; };
  return `Phím ${k.combo || [...k.mods, k.key].join('+')} · ${[...k.mods.map(one), one(k.key)].join(' · ')} · cờ libnut ${k.mods.length ? '[' + k.mods.join(',') + ']' : 'không'} · ${pf}`;
}
module.exports = { parse, diag, keymap, vkOf, metaOf, primaryOf, BLOCKED, HIDE_ALL };
