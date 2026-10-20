// Khi đăng trang web: giữ danh sách thu hồi MỚI NHẤT có chữ ký hợp lệ (bản trong site/ hoặc bản đang công khai),
// để việc phát hành không vô tình xoá một lần thu hồi chủ sở hữu đã làm từ máy của mình.
// node build/merge-revoked.cjs <site/revoked.json> <đầu ra>
const fs = require('fs'); const { execFileSync } = require('child_process');
const L = require('../src/license');
const [local, out] = process.argv.slice(2);
const cands = [];
try { const d = JSON.parse(fs.readFileSync(local, 'utf8')); cands.push({ d, j: L.verifyRevoked(d), from: 'site/' }); } catch (e) { console.error('revoked.json cục bộ: ' + e.message); }
try { const d = JSON.parse(execFileSync('curl', ['-fsSL', '--max-time', '15', L.REVOKED_URL + '?t=' + Date.now()], { encoding: 'utf8' })); cands.push({ d, j: L.verifyRevoked(d), from: 'trang web' }); } catch (e) { console.error('revoked.json trên trang web: ' + (e.message || e).toString().split('\n')[0]); }
if (!cands.length) { console.error('Không có revoked.json hợp lệ nào'); process.exit(1); }
cands.sort((a, b) => b.j.issuedAt - a.j.issuedAt);
fs.writeFileSync(out, JSON.stringify(cands[0].d, null, 2) + '\n');
if (cands[0].from !== 'site/') fs.writeFileSync(local, JSON.stringify(cands[0].d, null, 2) + '\n');
console.log(`revoked.json: dùng bản ${cands[0].from} (${cands[0].j.revoked.length} mã thu hồi, ký lúc ${new Date(cands[0].j.issuedAt).toISOString()})`);
