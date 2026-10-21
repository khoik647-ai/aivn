'use strict';
// B13 (QA lượt 2): llama-server không được sống sót khi AIVN thoát đột ngột.
//  (1) engine-host theo dõi pid tiến trình chính (watchParent): tiến trình chính mất → giết ngay mọi llama-server rồi thoát;
//  (2) tiến trình chính ghi pid llama-server vào tệp (PidFile); lần mở sau dọn những tiến trình còn sót (cleanup) —
//      chỉ giết khi pid đó VẪN là llama-server (tránh giết nhầm tiến trình khác dùng lại pid).
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// lệnh của một pid (để kiểm tra đúng là llama-server)
function commandOf(pid, platform = process.platform) {
  try {
    if (platform === 'linux') return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
    if (platform === 'win32') return execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim();
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 5000 }).trim();
  } catch { return ''; }
}
const isLlama = (cmd) => /llama-server(\.exe)?\b/i.test(cmd || '');

function createPidFile(file) {
  const read = () => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; } };
  const write = (list) => { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(list)); } catch {} };
  return {
    add(pid) { const l = read().filter(x => x.pid !== pid); l.push({ pid, at: Date.now() }); write(l); },
    remove(pid) { write(read().filter(x => x.pid !== pid)); },
    list: read,
    // dọn llama-server còn sót từ lần chạy trước; deps cho kiểm thử
    cleanup({ isAlive = alive, cmd = commandOf, kill = (p) => process.kill(p, 'SIGKILL'), log = () => {} } = {}) {
      const killed = [];
      for (const { pid } of read()) {
        if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue;
        if (!isAlive(pid)) continue;
        const c = cmd(pid);
        if (!isLlama(c)) { log(`[dọn] bỏ qua pid ${pid}: không còn là llama-server`); continue; }
        try { kill(pid); killed.push(pid); log(`[dọn] đã dừng llama-server còn sót từ lần chạy trước (pid ${pid})`); } catch (e) { log(`[dọn] không dừng được pid ${pid}: ${e.message}`); }
      }
      write([]);
      return killed;
    },
  };
}
// engine-host: kiểm tra tiến trình cha mỗi `ms`; cha mất (pid không còn, hoặc ppid đổi sang tiến trình khác) → onGone()
function watchParent(parentPid, onGone, { ms = 1500, isAlive = alive, ppid = () => process.ppid } = {}) {
  if (!Number.isInteger(parentPid) || parentPid <= 1) return { stop() {} };
  const t = setInterval(() => { if (!isAlive(parentPid) || ppid() !== parentPid) { clearInterval(t); onGone(); } }, ms);
  if (t.unref) t.unref();
  return { stop: () => clearInterval(t) };
}
module.exports = { createPidFile, watchParent, commandOf, isLlama, alive };
