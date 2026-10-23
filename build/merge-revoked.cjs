// Khi đăng trang web: giữ danh sách thu hồi MỚI NHẤT có chữ ký HỢP LỆ VỚI KHOÁ CŨ (bản trong site/ hoặc bản đang công khai),
// để việc phát hành không vô tình xoá một lần thu hồi chủ sở hữu đã làm từ máy của mình.
// Chỉ nhận chữ ký khoá cũ. Chữ ký khoá mới trên URL này làm bản v0.15.3 / beta.2.8 / beta.3 hết ân hạn 14 ngày rồi khoá.
// Danh sách ký bằng khoá mới đăng ở revoked-v2.json (REVOKED_URL_NEXT), không đi qua script này.
// node build/merge-revoked.cjs <site/revoked.json> <đầu ra>
const fs = require('fs'); const { execFileSync } = require('child_process');
const L = require('../src/license');
const [local, out] = process.argv.slice(2);
const legacyX = L.LEGACY_PUBLIC_KEYS[0];
const cands = [];
function take(d, from) {
  try { cands.push({ d, j: L.verifyRevoked(d, legacyX), from }); }
  catch (e) {
    let newer = false; try { L.verifyRevoked(d, L.PUBLIC_KEY_X); newer = true; } catch {}
    console.error(from + ': ' + (newer ? 'chữ ký khoá mới — không ghi đè revoked.json (bản cũ sẽ khoá sau ân hạn). Hãy đăng revoked-v2.json.' : e.message));
  }
}
try { take(JSON.parse(fs.readFileSync(local, 'utf8')), 'site/'); } catch (e) { console.error('revoked.json cục bộ: ' + e.message); }
try { take(JSON.parse(execFileSync('curl', ['-fsSL', '--max-time', '15', L.REVOKED_URL + '?t=' + Date.now()], { encoding: 'utf8' })), 'trang web'); } catch (e) { console.error('revoked.json trên trang web: ' + (e.message || e).toString().split('\n')[0]); }
if (!cands.length) { console.error('Không có revoked.json hợp lệ nào'); process.exit(1); }
cands.sort((a, b) => b.j.issuedAt - a.j.issuedAt);
fs.writeFileSync(out, JSON.stringify(cands[0].d, null, 2) + '\n');
if (cands[0].from !== 'site/') fs.writeFileSync(local, JSON.stringify(cands[0].d, null, 2) + '\n');
console.log(`revoked.json: dùng bản ${cands[0].from} (${cands[0].j.revoked.length} mã thu hồi, ký lúc ${new Date(cands[0].j.issuedAt).toISOString()})`);
