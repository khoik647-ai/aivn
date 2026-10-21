// Điều khiển màn hình (cấp 2, THỬ NGHIỆM): chụp màn hình → mô hình nhìn ảnh đề xuất vị trí → thẻ duyệt có khung đỏ →
// chỉ thao tác chuột/bàn phím sau khi người dùng đồng ý. Chỉ màn hình chính. Chuột/bàn phím qua libnut (Apache-2.0).
const path = require('path');
const D = require('./agent/dpi');
const { desktopCapturer, screen, systemPreferences, clipboard } = require('electron');

let nut = null, nutErr = null;
function libnut() {
  if (nut || nutErr) { if (nutErr) throw nutErr; return nut; }
  const pkg = { win32: 'libnut-win32', darwin: 'libnut-darwin', linux: 'libnut-linux' }[process.platform];
  try {
    const dir = path.dirname(require.resolve(`@nut-tree-fork/${pkg}/package.json`)).replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    nut = require(path.join(dir, 'build', 'Release', 'libnut.node'));
    nut.setMouseDelay && nut.setMouseDelay(30); nut.setKeyboardDelay && nut.setKeyboardDelay(20);
    // Kiểm thử (chỉ khi phát triển): giả lập luồng gửi chuột KHÔNG nhận DPI như máy Windows 125% — toạ độ bị nhân AIVN_FAKE_INPUT_SCALE
    const k = Number(process.env.AIVN_FAKE_INPUT_SCALE); let packaged = true; try { packaged = require('electron').app.isPackaged; } catch {}
    if (k && !packaged) { const real = nut; nut = Object.assign(Object.create(real), { moveMouse: (x, y) => real.moveMouse(Math.round(x * k), Math.round(y * k)), getScreenSize: () => { const z = real.getScreenSize(); return { width: Math.round(z.width / k), height: Math.round(z.height / k) }; } }); }
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
// ---------- màn hình: tỉ lệ & toạ độ theo từng màn hình (xem agent/dpi.js) ----------
function geos() {
  let prim = null; try { prim = screen.getPrimaryDisplay().id; } catch {}
  return D.geometry(screen.getAllDisplays(), { primaryId: prim, dipToScreenRect: process.platform === 'win32' && screen.dipToScreenRect ? (b) => screen.dipToScreenRect(null, b) : null });
}
// vị trí con trỏ THẬT (vật lý) — để kiểm tra chuột đã tới đúng chỗ chưa
function cursorPhys() {
  try {
    const p = screen.getCursorScreenPoint();
    if (process.platform === 'win32' && screen.dipToScreenPoint) return screen.dipToScreenPoint(p);
    return D.dipToPhys(geos(), p.x, p.y);
  } catch { return null; }
}
function displayInfo() {
  const g = geos(); let nutSize = null; try { const z = libnut().getScreenSize(); nutSize = `${z.width}×${z.height}`; } catch {}
  return { displays: g, text: D.describe(g), nutSize, platform: process.platform };
}
async function capture({ maxW = 1280, align = 0, geo = null } = {}) {
  const G = geos(); const g = (geo && G.find(x => String(x.id) === String(geo.id))) || D.primaryOf(G);
  const d = screen.getAllDisplays().find(x => String(x.id) === String(g.id)) || screen.getPrimaryDisplay();
  // thumbnailSize áp cho MỌI màn hình: lấy kích thước vật lý lớn nhất để màn hình nào cũng không bị thu nhỏ
  const phys = { width: Math.max(...G.map(x => Math.round(x.dip.width * x.scale))), height: Math.max(...G.map(x => Math.round(x.dip.height * x.scale))) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: phys });
  const src = sources.find(s => String(s.display_id) === String(d.id)) || (G.length === 1 ? sources[0] : null) || sources[0];
  if (!src || src.thumbnail.isEmpty()) throw new Error(process.platform === 'darwin' ? 'Không chụp được màn hình: hãy cấp quyền Ghi màn hình cho AIVN (Cài đặt hệ thống → Quyền riêng tư & Bảo mật → Ghi màn hình), rồi mở lại AIVN.' : 'Không chụp được màn hình.');
  let img = src.thumbnail; const full = img.getSize();
  if (full.width > maxW) img = img.resize({ width: maxW, quality: 'good' });
  // Qwen2.5-VL / UI-TARS trả toạ độ điểm ảnh của ảnh SAU khi mô hình chia ô (bội số 28; Qwen3-VL: 32): tự đưa ảnh về đúng bội số đó
  // để toạ độ mô hình trả về khớp đúng ảnh AIVN đã gửi (quy đổi theo từng trục ở parseBox)
  if (align > 1) { const s0 = img.getSize(); const w = Math.max(align, Math.round(s0.width / align) * align), h = Math.max(align, Math.round(s0.height / align) * align); if (w !== s0.width || h !== s0.height) img = img.resize({ width: w, height: h, quality: 'good' }); }
  const sz = img.getSize();
  return { dataUrl: 'data:image/jpeg;base64,' + img.toJPEG(80).toString('base64'), width: sz.width, height: sz.height, full, geo: g, display: { id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor } };
}

// Mỗi họ mô hình định vị theo cách riêng: Qwen2.5-VL & UI-TARS-1.5 trả điểm ảnh tuyệt đối (ảnh đã chia ô 28),
// Qwen3-VL & phần lớn mô hình khác trả thang 0-1000. Biết họ mô hình thì không phải đoán.
function groundingFamily(id) {
  const s = String(id || '').toLowerCase().replace(/_/g, '-');
  if (/ui-?tars/.test(s)) return 'uitars';
  if (/qwen2\.?5-?vl|qwen2-?vl/.test(s)) return 'qwen25vl';
  // mục 1: Holo2 (Qwen3-VL) / Holo3.x / Holo4 (Qwen3.5/3.6/3.8) — tài liệu H Company: MỌI mô hình Holo hiện nay trả x,y nguyên trong [0,1000]
  // theo ảnh gửi vào, gọi tắt suy nghĩ + nhiệt độ 0; câu lệnh như Holo1.5, chỉ khác thang toạ độ. Ảnh chia ô 16×2 = 32.
  if (/holo-?[2-9]/.test(s)) return 'holo3';
  if (/qwen3-?vl|gui-?owl|evocua/.test(s)) return 'qwen3vl';
  // Holo1.5 và UI-Venus-Ground dựa trên Qwen2.5-VL (toạ độ điểm ảnh) nhưng được huấn luyện với câu lệnh riêng: dùng đúng câu lệnh của nhà phát triển
  if (/holo/.test(s)) return 'holo';
  // mục 2: UI-Venus-2 dựa trên Qwen3.5, thẻ mô hình không nêu thang toạ độ → tự nhận (0-1000 hay điểm ảnh) cho tới khi AIVN Bench đo
  if (/ui-?venus-?2/.test(s)) return 'venus2';
  // UI-Venus: câu lệnh hộp [x1,y1,x2,y2] của nhà phát triển cho 3/10 trên AIVN Bench (hộp lệch ~20 px), câu lệnh điểm kiểu Qwen2.5-VL cho 8/10 → dùng cách đo được tốt hơn
  if (/ui-?venus/.test(s)) return 'qwen25vl';
  if (/showui|os-?atlas|gui-?actor/.test(s)) return 'qwen25vl';
  // mục 3: họ rõ ràng thay vì 'generic'. Fara1.5 (Qwen3.5): thẻ ghi toạ độ ĐIỂM ẢNH; Fara-7B cũ dựa trên Qwen2.5-VL
  if (/fara-?1\.?5/.test(s)) return 'fara';
  if (/fara/.test(s)) return 'qwen25vl';
  // Qwen3.5 / 3.6 / 3.8 (lai Gated-DeltaNet, nhìn ảnh sẵn): thẻ không nêu thang toạ độ — hỏi thang 0-1000 như Qwen3-VL, tự nhận nếu trả điểm ảnh
  if (/qwen-?3(?:\.|_)?[5-9](?![\db])/.test(s)) return 'qwen35';
  if (/gemma-?4/.test(s)) return 'gemma4';
  return 'generic';
}
const FAMILY = {
  qwen25vl: { coords: 'pixel', align: 28 },
  uitars: { coords: 'pixel', align: 28 },
  qwen3vl: { coords: 'norm1000', align: 32 },
  holo: { coords: 'pixel', align: 28 },
  holo3: { coords: 'norm1000', align: 32 },
  venus: { coords: 'pixel', align: 28 },
  venus2: { coords: 'auto', align: 32 },
  fara: { coords: 'pixel', align: 32 },
  qwen35: { coords: 'auto', align: 32 },
  gemma4: { coords: 'auto', align: 0 },
  generic: { coords: 'auto', align: 0 },
};
// mục 4: các họ này bật suy nghĩ mặc định (Qwen3.5 và các bản tinh chỉnh, Gemma 4) → llama-server --reasoning off
// (llama.cpp #20837: Qwen3.5 suy nghĩ thì hay in lời gọi công cụ trong khối suy nghĩ rồi dừng; #28827 Gemma 4 suy nghĩ thêm rác cuối)
const THINKS_BY_DEFAULT = new Set(['holo3', 'venus2', 'fara', 'qwen35', 'gemma4']);
const familyInfo = (id) => FAMILY[groundingFamily(id)];
const LOCATE_PROMPT = (target, W, H, fam = 'generic') => {
  if (fam === 'qwen25vl') return `Ảnh chụp màn hình rộng ${W}, cao ${H} điểm ảnh. Tìm phần tử giao diện: "${target}". Trả lời đúng MỘT dòng JSON: {"bbox_2d": [x1, y1, x2, y2], "label": "chữ trên phần tử"} với toạ độ điểm ảnh tuyệt đối trên ảnh này. Nếu không thấy: {"found": false, "why": "lý do ngắn"}.`;
  // Holo1.5 (H Company, localization.py / tài liệu "Element localization"): trả {"x": int, "y": int} theo điểm ảnh của ảnh gửi vào
  if (fam === 'holo' || fam === 'holo3') return `Localize an element on the GUI image according to the provided target and output a click position.\n * You must output a valid JSON following the format: {"x": int, "y": int}\n Your target is:\n${target}`;
  // UI-Venus-Ground (thẻ mô hình inclusionAI): trả [x1,y1,x2,y2] theo điểm ảnh
  if (fam === 'venus') return `Outline the position corresponding to the instruction: ${target}. The output should be only [x1,y1,x2,y2].`;
  if (fam === 'uitars') return `You are a GUI agent. Screenshot size ${W}x${H}. Task: click on "${target}". Output only one line: click(start_box='(x,y)') using absolute pixel coordinates of the screenshot. If the element is not visible output: not_found`;
  if (fam === 'fara') return `Ảnh chụp màn hình rộng ${W}, cao ${H} điểm ảnh. Tìm phần tử giao diện: "${target}". Trả lời đúng MỘT dòng JSON: {"x": số, "y": số} là điểm cần bấm, toạ độ điểm ảnh tuyệt đối trên ảnh này. Nếu không thấy: {"found": false, "why": "lý do ngắn"}.`;
  if (fam === 'qwen3vl' || fam === 'qwen35' || fam === 'venus2') return `Ảnh chụp màn hình máy tính. Tìm phần tử giao diện: "${target}". Trả lời đúng MỘT dòng JSON: {"bbox_2d": [x1, y1, x2, y2], "label": "chữ trên phần tử"} với toạ độ tương đối thang 0-1000 (0,0 góc trên trái; 1000,1000 góc dưới phải). Nếu không thấy: {"found": false, "why": "lý do ngắn"}.`;
  return `Đây là ảnh chụp màn hình máy tính (rộng ${W}, cao ${H} điểm ảnh). Hãy tìm phần tử giao diện sau: "${target}".
Chỉ trả lời MỘT dòng JSON, không giải thích: {"found": true, "x1": số, "y1": số, "x2": số, "y2": số, "label": "chữ trên phần tử"} với toạ độ khung bao quanh phần tử tính theo thang 0-1000 (0,0 là góc trên trái; 1000,1000 là góc dưới phải). Nếu không thấy: {"found": false, "why": "lý do ngắn"}.`;
};
// coords: 'pixel' | 'norm1000' | 'auto' (đoán: > 1000 hoặc vượt khung 0-1000 theo tỉ lệ ảnh → điểm ảnh)
function parseBox(text, W, H, { coords = 'auto' } = {}) {
  const t = String(text || '');
  if (/^\s*not_found/i.test(t)) return { found: false, why: 'mô hình không thấy phần tử' };
  let nums = null, label = '', j = null;
  // UI-TARS: click(start_box='(x,y)') / '<|box_start|>(x,y)<|box_end|>' / (x1,y1,x2,y2); <point>x y</point>
  const pt = t.match(/start_box=['"]?\(?\s*\[?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?))?/) || t.match(/<\|box_start\|>\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)(?:\s*,?\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\))?/) || t.match(/<point>\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*<\/point>/);
  if (pt) { const [x, y] = [+pt[1], +pt[2]]; nums = pt[3] != null ? [x, y, +pt[3], +pt[4]] : [x - 12, y - 12, x + 12, y + 12]; }
  // mảng trần [x1,y1,x2,y2] (UI-Venus-Ground) hoặc [x,y]
  if (!nums && !/[{]/.test(t)) { const a = t.match(/\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?))?\s*\]/);
    if (a) { const [x, y] = [+a[1], +a[2]]; nums = a[3] != null ? [x, y, +a[3], +a[4]] : [x - 12, y - 12, x + 12, y + 12]; } }
  // JSON hỏng kiểu {"x": 70, 451} (thiếu khoá "y"): vẫn là một điểm x, y
  if (!nums) { const xy = t.match(/"x"\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*(?:"y"\s*:\s*)?(-?\d+(?:\.\d+)?)/); if (xy) { const [x, y] = [+xy[1], +xy[2]]; nums = [x - 12, y - 12, x + 12, y + 12]; } }
  if (!nums) {
    const m = t.match(/\{[\s\S]*?\}(?=[^{}]*$|\s*[,\]\n])/) || t.match(/\{[\s\S]*?\}/) || (/\(\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*\)/.test(t) ? ['{}'] : null); if (!m) return null;
    try { j = JSON.parse(m[0].replace(/'/g, '"')); } catch { const m2 = t.match(/\{[^{}]*\}/); try { j = JSON.parse(m2 && m2[0]); } catch { j = { found: !/"found"\s*:\s*false/.test(t) || undefined }; if (/"found"\s*:\s*false/.test(t)) return { found: false, why: '' }; } } // JSON hỏng (dấu nháy trong câu): vẫn thử lấy điểm (x, y)
    if (Array.isArray(j)) j = j[0]; if (!j || typeof j !== 'object') return null;
    if (j.found === false) return { found: false, why: j.why || '' };
    label = j.label || '';
    nums = ['x1', 'y1', 'x2', 'y2'].map(k => Number(j[k]));
    if (nums.some(n => !Number.isFinite(n))) {
      const b = [j.bbox_2d, j.bbox, j.box, j.box_2d].find(Array.isArray);
      if (b && b.length >= 4) nums = b.slice(0, 4).map(Number);
      else if (Array.isArray(j.point_2d) || Array.isArray(j.point)) { const [x, y] = (j.point_2d || j.point).map(Number); nums = [x - 12, y - 12, x + 12, y + 12]; }
      else if (Number.isFinite(+j.x) && Number.isFinite(+j.y)) nums = [+j.x - 15, +j.y - 15, +j.x + 15, +j.y + 15];
      else { const pp = t.match(/\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)/); if (!pp) return null; const [x, y] = [+pp[1], +pp[2]]; nums = [x - 12, y - 12, x + 12, y + 12]; } // vd. Holo: điểm ghi trong câu
    }
  }
  if (nums.some(n => !Number.isFinite(n))) return null;
  let [x1, y1, x2, y2] = nums;
  const pixel = coords === 'pixel' ? true : coords === 'norm1000' ? false : (Math.max(x1, x2) > 1000 || Math.max(y1, y2) > 1000);
  const nx = (v) => pixel ? v / W : v / 1000, ny = (v) => pixel ? v / H : v / 1000;
  const c = (v) => Math.min(1, Math.max(0, v));
  const box = { x1: c(nx(Math.min(x1, x2))), y1: c(ny(Math.min(y1, y2))), x2: c(nx(Math.max(x1, x2))), y2: c(ny(Math.max(y1, y2))) };
  if (box.x2 - box.x1 < 0.003) { box.x1 = c(box.x1 - 0.01); box.x2 = c(box.x2 + 0.01); }
  if (box.y2 - box.y1 < 0.003) { box.y1 = c(box.y1 - 0.01); box.y2 = c(box.y2 + 0.01); }
  return { found: true, ...box, label, coords: pixel ? 'pixel' : 'norm1000' };
}
const HOLO_SCHEMA = { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'], additionalProperties: false };
async function locate(engine, shot, target, { signal, modelId = '' } = {}) {
  const fam = groundingFamily(modelId); const fi = FAMILY[fam];
  // Holo1.5: nhà phát triển gọi kèm "structured outputs" (lược đồ JSON {x, y}); không ràng buộc thì bản lượng tử Q4 hay bỏ mất khoá "y"
  const jsonSchema = fam === 'holo' || fam === 'holo3' ? HOLO_SCHEMA : null;
  const r = await engine.generate([{ role: 'user', content: [{ type: 'text', text: LOCATE_PROMPT(target, shot.width, shot.height, fam) }, { type: 'image_url', image_url: { url: shot.dataUrl } }] }], { temperature: 0, maxTokens: 160, signal, ...(jsonSchema ? { jsonSchema } : {}) });
  return { box: parseBox(r.text, shot.width, shot.height, { coords: fi.coords }), raw: String(r.text || '').slice(0, 400), family: fam };
}
async function describe(engine, shot, question, { signal } = {}) {
  const q = question ? `Câu hỏi về màn hình: ${question}\n` : '';
  const r = await engine.generate([{ role: 'user', content: [{ type: 'text', text: `${q}Mô tả ngắn gọn bằng tiếng Việt những gì đang hiển thị trên ảnh chụp màn hình này: cửa sổ/ứng dụng nào đang mở, các nút, ô nhập và chữ quan trọng (ghi đúng chữ hiển thị). Tối đa 12 dòng.` }, { type: 'image_url', image_url: { url: shot.dataUrl } }] }], { temperature: 0.1, maxTokens: 400, signal });
  return String(r.text || '').trim();
}

// Toạ độ chuẩn hoá (0..1 trên màn hình chính) → toạ độ libnut
function toNut(nx, ny, display) {
  // ảnh chụp chuẩn hoá 0..1 của màn hình `display` → toạ độ vật lý theo đúng màn hình đó (tỉ lệ riêng, gốc riêng, kể cả toạ độ âm)
  const G = geos(); const g = (display && G.find(x => String(x.id) === String(display.id))) || D.primaryOf(G);
  return D.normToPhys(g, nx, ny);
}
// B66c: bảng phím theo hệ điều hành ở agent/keys.js (cờ “command” không tồn tại trên Windows/Linux)
const K = require('./agent/keys');
function parseKeys(combo) { const k = K.parse(combo); return { key: k.key, mods: k.mods }; }
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
    // dán từ bộ nhớ tạm: gõ đúng tiếng Việt có dấu. Electron 44: clipboard.readText/writeText có thể trả Promise → luôn await
    const prev = await Promise.resolve(clipboard.readText()).catch(() => '');
    await Promise.resolve(clipboard.writeText(t));
    n.keyTap('v', K.primaryOf(process.platform)); await sleep(250);
    setTimeout(async () => { try { if (await Promise.resolve(clipboard.readText()) === t) await Promise.resolve(clipboard.writeText(prev)); } catch {} }, 1500);
  }
  if (action === 'key') { const k = parseKeys(keys); if (k.mods.length) n.keyTap(k.key, k.mods); else n.keyTap(k.key); await sleep(150); }
  if (action === 'scroll') { const a = Math.max(-20, Math.min(20, Math.round(Number(amount) || -5))); n.scrollMouse(0, process.platform === 'win32' ? a * 120 : a); await sleep(150); }
}

module.exports = { THINKS_BY_DEFAULT, geos, cursorPhys, displayInfo, groundingFamily, familyInfo, FAMILY, permissions, PERM_URLS, capture, locate, describe, parseBox, parseKeys, perform, toNut, libnut, LOCATE_PROMPT };
