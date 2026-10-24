// Chính sách an toàn khi AIVN AGENT điều khiển máy (không phụ thuộc Electron, để kiểm thử)
// thao tác "quan trọng": luôn hỏi người dùng trước, kể cả ở chế độ "Chỉ hỏi bước quan trọng"
const RISKY_NAME = /(gửi|send|thanh\s*toán|pay(ment)?|mua( ngay)?|buy|đặt\s*(hàng|mua)|order|chuyển\s*(khoản|tiền)|transfer|xo[áa]|delete|remove|gỡ\s*(bỏ|cài)|uninstall|thùng rác|trash|nộp|submit|đăng\s*(bài|tin|lên)?\b|post|publish|chia sẻ|share|xác\s*nhận|confirm|đồng\s*ý|accept|agree|đăng\s*ký|sign\s*up|checkout|ký|sign|cài\s*đặt\s*(lại|gốc)|reset|format|đăng\s*xuất|log\s*out|sign\s*out)/i;
const ACT_LABEL = { click: 'Bấm', double_click: 'Bấm đúp', right_click: 'Bấm chuột phải', type_text: 'Gõ chữ', hotkey: 'Bấm phím', scroll: 'Cuộn', wait: 'Chờ', focus_window: 'Chuyển cửa sổ', open_chat: 'Mở cuộc trò chuyện' };
const ALIASES = { type: 'type_text', key: 'hotkey', keys: 'hotkey', press: 'hotkey', doubleclick: 'double_click', rightclick: 'right_click', focus: 'focus_window', switch_window: 'focus_window', openchat: 'open_chat', open_conversation: 'open_chat' };

function riskOf(action, { el, query, text, keys, lastAction } = {}) {
  const name = [el && el.name, query].filter(Boolean).join(' ');
  if (['click', 'double_click'].includes(action) && RISKY_NAME.test(name)) return `bấm “${(el && el.name) || query}” có thể gửi/thanh toán/xoá/nộp — không hoàn tác được`;
  if (action === 'hotkey') {
    const k = String(keys || '').toLowerCase().replace(/\s+/g, '');
    if (/(^|\+)(enter|return)$/.test(k) && lastAction && lastAction.action === 'type_text') return 'bấm Enter ngay sau khi gõ chữ có thể GỬI tin nhắn hoặc NỘP biểu mẫu';
    // B219: sau screen_look, Enter / Ctrl+Enter / Alt+S vẫn có thể gửi bản nháp đang nằm sẵn trong ô (chưa gõ ở lượt này)
    if (lastAction && lastAction.action === 'screen_look' && (/^(?:(?:control|ctrl|cmd|command|meta)\+(?:enter|return|numpad_enter|kp_enter)|alt\+s)$/.test(k) || /(^|\+)(enter|return|numpad_enter|kp_enter)$/.test(k))) return 'phím Enter, Ctrl+Enter hoặc Alt+S sau khi nhìn màn hình có thể GỬI bản nháp đang có sẵn';
    if (/(^|\+)(delete|del)$/.test(k) || /shift\+(delete|del)/.test(k)) return 'phím Delete có thể xoá dữ liệu';
  }
  if (action === 'type_text' && /\n/.test(String(text || ''))) return 'chữ có xuống dòng (Enter) có thể gửi tin nhắn';
  return null;
}

module.exports = { riskOf, RISKY_NAME, ACT_LABEL, ALIASES };
