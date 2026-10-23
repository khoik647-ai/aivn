// Khi đăng trang web:
//   revoked.json (v1) — đóng băng. Chỉ chép nguyên byte nếu chữ ký còn là khoá cũ. Không ký lại, không tải bản khác đè lên.
//   revoked-v2.json — giữ bản MỚI NHẤT còn chữ ký hợp lệ (khoá hiện tại hoặc khoá cũ). Bản cũ hơn hoặc sai chữ ký bị bỏ.
//   Tệp --out đã có cũng là ứng viên: không bao giờ ghi đè bằng bản cũ hơn hoặc không hợp lệ.
// node build/merge-revoked.cjs <site/revoked.json> <đầu ra>
// node build/merge-revoked.cjs --next --out <revoked-v2.json> [--no-fetch] [ứng viên…]
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const L = require('../src/license');

function readFile(p) {
  try {
    if (!p || !fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p);
    return { raw, doc: JSON.parse(raw.toString('utf8')), from: p };
  } catch (e) { console.error(String(p) + ': ' + e.message); return null; }
}
function accept(item, publicX) {
  if (!item) return null;
  try { return { ...item, j: L.verifyRevoked(item.doc, publicX) }; }
  catch (e) { console.error(item.from + ': ' + e.message); return null; }
}
function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a.j.issuedAt >= b.j.issuedAt ? a : b;
}
function isFrozenV1(p) { return path.basename(String(p)) === 'revoked.json'; }

// publicX bỏ trống → mọi TRUSTED_KEYS. Bản --out hiện có được xét trước (hoà thì giữ nguyên byte đó).
function mergeV2({ out, paths = [], fetchLive = false, publicX } = {}) {
  if (!out) { console.error('thiếu --out'); return 1; }
  if (isFrozenV1(out)) { console.error('không ghi revoked.json (v1 đóng băng)'); return 1; }
  const items = []; const seen = new Set();
  const addPath = (p) => {
    if (!p) return;
    const key = path.resolve(p);
    if (seen.has(key)) return;
    seen.add(key);
    items.push(readFile(p));
  };
  addPath(out);
  for (const p of paths) addPath(p);
  if (fetchLive) {
    try {
      const raw = execFileSync('curl', ['-fsSL', '--max-time', '15', L.REVOKED_URL_NEXT + '?t=' + Date.now()], { maxBuffer: 2e6 });
      items.push({ raw, doc: JSON.parse(raw.toString('utf8')), from: L.REVOKED_URL_NEXT });
    } catch (e) { console.error('revoked-v2.json trên trang web: ' + (e.message || e).toString().split('\n')[0]); }
  }
  let best = null;
  for (const item of items) best = newer(best, accept(item, publicX));
  if (!best) { console.log('revoked-v2.json: chưa có bản hợp lệ — không ghi đè'); return 0; }
  fs.writeFileSync(out, best.raw);
  console.log(`revoked-v2.json: dùng bản ${best.from} (${best.j.revoked.length} mã thu hồi, ký lúc ${new Date(best.j.issuedAt).toISOString()})`);
  return 0;
}

function copyV1(local, out) {
  if (!local || !out) { console.error('thiếu đường dẫn revoked.json'); return 1; }
  const item = accept(readFile(local), L.LEGACY_PUBLIC_KEYS[0]);
  if (!item) {
    let newerKey = false; try { L.verifyRevoked(JSON.parse(fs.readFileSync(local, 'utf8')), L.PUBLIC_KEY_X); newerKey = true; } catch {}
    console.error(newerKey ? 'revoked.json ký bằng khoá mới — không ghi (bản cũ sẽ khoá sau ân hạn). Hãy đăng revoked-v2.json.' : 'Không có revoked.json hợp lệ (chữ ký khoá cũ). Giữ nguyên tệp đã ký; không ký lại.');
    return 1;
  }
  fs.writeFileSync(out, item.raw);
  console.log(`revoked.json: giữ nguyên bản site/ (${item.j.revoked.length} mã thu hồi, ký lúc ${new Date(item.j.issuedAt).toISOString()})`);
  return 0;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let code;
  if (args[0] === '--next') {
    let fetchLive = true; let out = null; const paths = [];
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--no-fetch') fetchLive = false;
      else if (args[i] === '--out') out = args[++i];
      else paths.push(args[i]);
    }
    code = mergeV2({ out, paths, fetchLive });
  } else code = copyV1(args[0], args[1]);
  process.exit(code);
}

module.exports = { mergeV2, copyV1 };
