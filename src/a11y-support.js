'use strict';
// Chromium dựng cây trợ năng LƯỜI. Lần đầu trình đọc màn hình hoặc client UIA hỏi
// (WM_GETOBJECT trên Windows), cây còn rỗng trong lúc dựng — dry-run beta.3 trên
// desktop đo hơn 4 giây, những lần hỏi đầu không thấy gì.
// Electron: setAccessibilitySupportEnabled phải gọi sau sự kiện ready, và không được
// bật mặc định (dựng cây làm chậm máy). Chỉ bật khi hệ điều hành ĐÃ báo trợ năng.
// Không chờ cây dựng xong: lần vẽ đầu vẫn theo ready-to-show → show.
function accessibilityPlan(app, platform = process.platform) {
  if (platform !== 'win32' && platform !== 'darwin') return { enable: false, reason: 'platform', features: [] };
  let already = false;
  let features = [];
  try { already = !!(app && typeof app.isAccessibilitySupportEnabled === 'function' && app.isAccessibilitySupportEnabled()); } catch { already = false; }
  try {
    const g = app && typeof app.getAccessibilitySupportFeatures === 'function' ? app.getAccessibilitySupportFeatures() : [];
    features = Array.isArray(g) ? g : [];
  } catch { features = []; }
  const requested = already || features.includes('screenReader') || features.includes('nativeAPIs');
  return { enable: requested, reason: requested ? 'os-reported' : 'lazy-until-client', features };
}

function armAccessibility(app, platform = process.platform) {
  const apply = () => {
    const plan = accessibilityPlan(app, platform);
    if (plan.enable && app && typeof app.setAccessibilitySupportEnabled === 'function') {
      try { app.setAccessibilitySupportEnabled(true); plan.applied = true; } catch { plan.applied = false; }
    }
    return plan;
  };
  const plan = apply();
  if (app && typeof app.on === 'function' && (platform === 'win32' || platform === 'darwin')) {
    app.on('accessibility-support-changed', (_e, enabled) => { if (enabled) apply(); });
    plan.listening = true;
  }
  return plan;
}

module.exports = { accessibilityPlan, armAccessibility };
