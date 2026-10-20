// Điều khiển màn hình (cấp 2, THỬ NGHIỆM): chụp màn hình → mô hình nhìn ảnh đề xuất vị trí → thẻ duyệt có khung đỏ →
// chỉ thao tác chuột/bàn phím sau khi người dùng đồng ý. Chỉ màn hình chính. Chuột/bàn phím qua libnut (Apache-2.0).
const path = require('path');
const { desktopCapturer, screen, systemPreferences, clipboard } = require('electron');

let nut = null, nutErr = null;
function libnut() {
  if (nut || nutErr) { if (nutErr) throw nutErr; return nut; }
  const pkg = { win32: 'libnut-win32', darwin: 'libnut-darwin', linux: 'libnut-linux' }[process.platform];
  try {
    const dir = path.dirname(require.resolve(`@nut-tree-fork/${pkg}/package.json`)).replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    nut = require(path.join(dir, 'build', 'Release', 'libnut.node'));
    nut.setMouseDelay && nut.setMouseDelay(30); nut.setKeyboardDelay && nut.setKeyboardDelay(20);
    return nut;
  } catch (e) { nutErr = new Error('Không nạp được bộ điều khiển chuột/bàn phím (' + e.message + ')'); throw nutErr; }
}

// Quyền trên macOS: Ghi màn hình (Screen Recording) + Trợ năng (Accessibility)
function permissions({ prompt = false } = {}) {
  if (process.platform !== 'darwin') return { needed: false, screen: 'granted', accessibility: true };
  let scr = 'unknown'; try { scr = systemPreferences.getMediaAccessStatus('screen'); } catch {}
  let acc = false; try { acc = systemPreferences.isTrustedAccessibilityClient(!!prompt); } catch {}
  return { needed: true, screen: scr, accessibility: acc };
}
const PERM_URLS = { screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture', accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility' };

// Chụp màn hình chính; trả ảnh JPEG (≤ maxW) + thông tin quy đổi toạ độ
async function capture({ maxW = 1280 } = {}) {
  const d = screen.getPrimaryDisplay();
  const phys = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: phys });
  const src = sources.find(s => String(s.display_id) === String(d.id)) || sources[0];
  if (!src || src.thumbnail.isEmpty()) throw new Error(process.platform === 'darwin' ? 'Không chụp được màn hình: hãy cấp quyền Ghi màn hình cho AIVN (Cài đặt hệ thống → Quyền riêng tư & Bảo mật → Ghi màn hình), rồi mở lại AIVN.' : 'Không chụp được màn hình.');
  let img = src.thumbnail; const full = img.getSize();
  if (full.width > maxW) img = img.resize({ width: maxW, quality: 'good' });
  const sz = img.getSize();
  return { dataUrl: 'data:image/jpeg;base64,' + img.toJPEG(80).toString('base64'), width: sz.width, height: sz.height, display: { id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor } };
}

// Hỏi mô hình nhìn ảnh vị trí của phần tử; trả khung chuẩn hoá 0..1 hoặc null
const LOCATE_PROMPT = (target, W, H) => `Đây là ảnh chụp màn hình máy tính (rộng ${W}, cao ${H} điểm ảnh). Hãy tìm phần tử giao diện sau: "${target}".
Chỉ trả lời MỘT dòng JSON, không giải thích: {"found": true, "x1": số, "y1": số, "x2": số, "y2": số, "label": "chữ trên phần tử"} với toạ độ khung bao quanh phần tử tính theo thang 0-1000 (0,0 là góc trên trái; 1000,1000 là góc dưới phải). Nếu không thấy: {"found": false, "why": "lý do ngắn"}.`;
function parseBox(text, W, H) {
  const m = String(text || '').match(/\{[\s\S]*?\}/); if (!m) return null;
  let j; try { j = JSON.parse(m[0].replace(/'/g, '"')); } catch { return null; }
  if (j.found === false) return { found: false, why: j.why || '' };
  let nums = ['x1', 'y1', 'x2', 'y2'].map(k => Number(j[k]));
  if (nums.some(n => !Number.isFinite(n))) { const b = Array.isArray(j.bbox) ? j.bbox.map(Number) : Array.isArray(j.box) ? j.box.map(Number) : null; if (!b || b.length < 4) { if (Number.isFinite(+j.x) && Number.isFinite(+j.y)) nums = [+j.x - 15, +j.y - 15, +j.x + 15, +j.y + 15]; else return null; } else nums = b.slice(0, 4); }
  let [x1, y1, x2, y2] = nums;
  const pixel = Math.max(x1, x2) > 1000 || Math.max(y1, y2) > 1000; // một số mô hình trả điểm ảnh tuyệt đối
  const nx = (v) => pixel ? v / W : v / 1000, ny = (v) => pixel ? v / H : v / 1000;
  const c = (v) => Math.min(1, Math.max(0, v));
  const box = { x1: c(nx(Math.min(x1, x2))), y1: c(ny(Math.min(y1, y2))), x2: c(nx(Math.max(x1, x2))), y2: c(ny(Math.max(y1, y2))) };
  if (box.x2 - box.x1 < 0.003) { box.x1 = c(box.x1 - 0.01); box.x2 = c(box.x2 + 0.01); }
  if (box.y2 - box.y1 < 0.003) { box.y1 = c(box.y1 - 0.01); box.y2 = c(box.y2 + 0.01); }
  return { found: true, ...box, label: j.label || '' };
}
async function locate(engine, shot, target, { signal } = {}) {
  const r = await engine.generate([{ role: 'user', content: [{ type: 'text', text: LOCATE_PROMPT(target, shot.width, shot.height) }, { type: 'image_url', image_url: { url: shot.dataUrl } }] }], { temperature: 0, maxTokens: 160, signal });
  return { box: parseBox(r.text, shot.width, shot.height), raw: String(r.text || '').slice(0, 400) };
}
async function describe(engine, shot, question, { signal } = {}) {
  const q = question ? `Câu hỏi về màn hình: ${question}\n` : '';
  const r = await engine.generate([{ role: 'user', content: [{ type: 'text', text: `${q}Mô tả ngắn gọn bằng tiếng Việt những gì đang hiển thị trên ảnh chụp màn hình này: cửa sổ/ứng dụng nào đang mở, các nút, ô nhập và chữ quan trọng (ghi đúng chữ hiển thị). Tối đa 12 dòng.` }, { type: 'image_url', image_url: { url: shot.dataUrl } }] }], { temperature: 0.1, maxTokens: 400, signal });
  return String(r.text || '').trim();
}

// Toạ độ chuẩn hoá (0..1 trên màn hình chính) → toạ độ libnut
function toNut(nx, ny, display) {
  const b = display.bounds; const dip = { x: Math.round(b.x + nx * b.width), y: Math.round(b.y + ny * b.height) };
  if (process.platform === 'win32' && screen.dipToScreenPoint) return screen.dipToScreenPoint(dip); // Windows: điểm ảnh vật lý
  if (process.platform === 'linux') return { x: Math.round(dip.x * display.scaleFactor), y: Math.round(dip.y * display.scaleFactor) };
  return dip; // macOS: điểm (point)
}
const KEYMAP = { ctrl: 'control', control: 'control', cmd: 'command', command: 'command', win: 'command', meta: 'command', alt: 'alt', option: 'alt', shift: 'shift', enter: 'enter', return: 'enter', esc: 'escape', escape: 'escape', tab: 'tab', space: 'space', backspace: 'backspace', delete: 'delete', del: 'delete', up: 'up', down: 'down', left: 'left', right: 'right', home: 'home', end: 'end', pageup: 'pageup', pagedown: 'pagedown' };
function parseKeys(combo) {
  const parts = String(combo || '').toLowerCase().split('+').map(s => s.trim()).filter(Boolean);
  if (!parts.length || parts.length > 4) throw new Error('Phím không hợp lệ: ' + combo);
  const keys = parts.map(p => KEYMAP[p] || (/^f([1-9]|1[0-2])$/.test(p) || /^[a-z0-9]$/.test(p) ? p : null));
  if (keys.some(k => !k)) throw new Error('Phím không hỗ trợ: ' + combo);
  const key = keys.pop(); const mods = keys.filter(k => ['control', 'command', 'alt', 'shift'].includes(k));
  // chặn tổ hợp nguy hiểm/hệ thống
  const c = [...mods, key].join('+');
  if (/(control\+alt\+delete|command\+alt\+escape|control\+alt\+escape|command\+q$|alt\+f4$|command\+shift\+q$)/.test(c)) throw new Error('AIVN không bấm tổ hợp phím hệ thống/đóng ứng dụng này: ' + combo);
  return { key, mods };
}
async function perform({ action, nx, ny, text, keys, display, amount }) {
  const n = libnut();
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  if (['click', 'double_click', 'right_click', 'move'].includes(action) || (action === 'type' && nx != null) || (action === 'scroll' && nx != null)) {
    const p = toNut(nx, ny, display); n.moveMouse(p.x, p.y); await sleep(120);
    if (action === 'click' || action === 'type') n.mouseClick('left', false);
    if (action === 'double_click') n.mouseClick('left', true);
    if (action === 'right_click') n.mouseClick('right', false);
    await sleep(200);
  }
  if (action === 'type') {
    const t = String(text || ''); if (!t) throw new Error('Thiếu chữ cần gõ');
    const prev = clipboard.readText(); clipboard.writeText(t); // dán từ bộ nhớ tạm: gõ đúng tiếng Việt có dấu
    n.keyTap('v', process.platform === 'darwin' ? 'command' : 'control'); await sleep(250);
    setTimeout(() => { try { if (clipboard.readText() === t) clipboard.writeText(prev); } catch {} }, 1500);
  }
  if (action === 'key') { const k = parseKeys(keys); n.keyTap(k.key, k.mods.length ? k.mods : undefined); await sleep(150); }
  if (action === 'scroll') { const a = Math.max(-20, Math.min(20, Math.round(Number(amount) || -5))); n.scrollMouse(0, process.platform === 'win32' ? a * 120 : a); await sleep(150); }
}

module.exports = { permissions, PERM_URLS, capture, locate, describe, parseBox, parseKeys, perform, toNut, libnut, LOCATE_PROMPT };
