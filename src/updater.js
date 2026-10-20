// Tự động cập nhật qua GitHub Releases (electron-updater).
// Windows (NSIS): tải và cài tại chỗ. macOS: bản chưa ký số không cài tại chỗ được (Squirrel.Mac yêu cầu chữ ký Apple),
// nên chỉ báo có bản mới và mở trang tải về.
const { app, shell } = require('electron');
const path = require('path');

const PLACEHOLDER = 'GITHUB_OWNER_PLACEHOLDER';

function publishConfig() {
  // Bản đóng gói: electron-builder bỏ trường "build" khỏi package.json, nguồn cập nhật nằm trong resources/app-update.yml
  let pub = {};
  try {
    const fs = require('fs');
    const f = path.join(process.resourcesPath || '', 'app-update.yml');
    if (app.isPackaged && fs.existsSync(f)) {
      for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^(\w+):\s*['"]?([^'"]*?)['"]?\s*$/);
        if (m) pub[m[1]] = m[2];
      }
    }
  } catch { pub = {}; }
  if (!pub.owner) {
    try {
      const pkg = require(path.join(__dirname, '..', 'package.json'));
      pub = [].concat((pkg.build && pkg.build.publish) || [])[0] || {};
    } catch { pub = {}; }
  }
  return { provider: 'github', owner: pub.owner || PLACEHOLDER, repo: pub.repo || 'aivn' };
}

function createUpdater({ send, log }) {
  let autoUpdater = null;
  let state = { status: 'idle' };
  const canInstallInPlace = process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE);
  const cfg = publishConfig();
  const releasesUrl = `https://github.com/${cfg.owner}/${cfg.repo}/releases/latest`;

  const set = (patch) => { state = { ...state, ...patch }; send('update:status', state); if (process.env.AIVN_TEST === '1') console.log('[update-state] ' + JSON.stringify(state)); };

  function get() {
    if (autoUpdater) return autoUpdater;
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: (m) => log && log('[cập nhật] ' + m), warn: (m) => log && log('[cập nhật] ' + m), error: (m) => log && log('[cập nhật] lỗi: ' + m), debug: () => {} };
    if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true;
    if (process.env.AIVN_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.AIVN_UPDATE_URL }); // chỉ dùng khi kiểm thử
    else autoUpdater.setFeedURL(cfg);
    autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
    autoUpdater.on('update-available', (info) => set({ status: 'available', version: info.version, releaseDate: info.releaseDate, canInstallInPlace, releasesUrl }));
    autoUpdater.on('update-not-available', () => set({ status: 'latest', checkedAt: Date.now() }));
    autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond }));
    autoUpdater.on('update-downloaded', (info) => set({ status: 'downloaded', version: info.version }));
    autoUpdater.on('error', (e) => set({ status: 'error', error: friendly(e) }));
    return autoUpdater;
  }

  function friendly(e) {
    const m = String((e && e.message) || e);
    if (cfg.owner === PLACEHOLDER && !process.env.AIVN_UPDATE_URL) return 'Không kiểm tra được cập nhật: nguồn cập nhật chưa được cấu hình.';
    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::ERR_/i.test(m)) return 'Không kiểm tra được cập nhật: không có kết nối mạng.';
    if (/404|Not Found|Unable to find latest version|No published versions/i.test(m)) return 'Không kiểm tra được cập nhật: chưa tìm thấy bản phát hành nào.';
    if (/sha512 checksum mismatch/i.test(m)) return 'Tệp cập nhật tải về bị lỗi, vui lòng thử lại.';
    return 'Không kiểm tra được cập nhật. Vui lòng thử lại sau.';
  }

  async function check({ silent = false } = {}) {
    if (state.status === 'checking' || state.status === 'downloading') return state;
    if (cfg.owner === PLACEHOLDER && !process.env.AIVN_UPDATE_URL) {
      set({ status: 'error', error: friendly(null), silent });
      return state;
    }
    try {
      set({ status: 'checking', error: null, silent });
      const r = await get().checkForUpdates();
      // electron-updater trả về null mà không phát sự kiện khi bộ cập nhật không hoạt động (vd. bản Linux không phải AppImage)
      if (r == null && state.status === 'checking') set({ status: 'error', error: 'Không kiểm tra được cập nhật trên bản cài này. Vui lòng tải bản mới từ trang chủ.', releasesUrl });
    } catch (e) {
      set({ status: 'error', error: friendly(e), silent });
    }
    return state;
  }

  async function download() {
    if (!canInstallInPlace) { shell.openExternal(releasesUrl); return state; }
    try { set({ status: 'downloading', percent: 0 }); await get().downloadUpdate(); }
    catch (e) { set({ status: 'error', error: friendly(e) }); }
    return state;
  }

  function install() { if (state.status === 'downloaded') setImmediate(() => get().quitAndInstall(false, true)); return true; }
  function openReleases() { shell.openExternal(releasesUrl); return true; }

  return { check, download, install, openReleases, state: () => ({ ...state, canInstallInPlace, releasesUrl, current: app.getVersion() }), config: cfg };
}

module.exports = { createUpdater, PLACEHOLDER };
