// AIVN 0.16 — Đơn vị tính (Odoo: uom.uom). Dữ liệu lưu tên tiếng Việt (“cái”, “kg”, “giờ”…) làm khoá chuẩn — đúng với dữ liệu cũ;
// giao diện và mẫu in hiện theo ngôn ngữ người dùng (en “Units”, zh “件”). Người dùng gõ tên ở bất kỳ ngôn ngữ nào → quy về khoá chuẩn.
// Tên lạ (người dùng tự đặt) giữ nguyên. Dùng chung cho tiến trình chính và renderer (window.AIVN_UOM).
(function (root) {
  'use strict';
  // [khoá vi, en số ít, en số nhiều, zh, ...bí danh]
  const LIST = [
    ['cái', 'Unit', 'Units', '件', 'unit', 'units', 'đơn vị'],
    ['chiếc', 'Piece', 'Pieces', '个', 'pc', 'pcs', 'piece', 'pieces'],
    ['bộ', 'Set', 'Sets', '套', 'set', 'sets'],
    ['hộp', 'Box', 'Boxes', '盒', 'box', 'boxes'],
    ['thùng', 'Carton', 'Cartons', '箱', 'carton', 'cartons', 'ctn'],
    ['gói', 'Pack', 'Packs', '包', 'pack', 'packs', 'package', 'packages'],
    ['chai', 'Bottle', 'Bottles', '瓶', 'bottle', 'bottles'],
    ['lon', 'Tin', 'Tins', '听', 'tin', 'tins', 'cans'],
    ['lọ', 'Jar', 'Jars', '罐', 'jar', 'jars'],
    ['túi', 'Bag', 'Bags', '袋', 'bag', 'bags'],
    ['bao', 'Sack', 'Sacks', '麻袋', 'sack', 'sacks'],
    ['cuộn', 'Roll', 'Rolls', '卷', 'roll', 'rolls'],
    ['tờ', 'Sheet', 'Sheets', '张', 'sheet', 'sheets'],
    ['cuốn', 'Copy', 'Copies', '本', 'copy', 'copies', 'quyển'],
    ['ram', 'Ream', 'Reams', '令', 'ream', 'reams'],
    ['đôi', 'Pair', 'Pairs', '双', 'pair', 'pairs', 'cặp'],
    ['tá', 'Dozen', 'Dozens', '打', 'dozen', 'dozens', 'doz'],
    ['viên', 'Tablet', 'Tablets', '粒', 'tablet', 'tablets'],
    ['vỉ', 'Blister', 'Blisters', '板', 'blister', 'blisters'],
    ['can', 'Jerrycan', 'Jerrycans', '桶', 'jerrycan', 'jerrycans'],
    ['kg', 'kg', 'kg', '千克', 'kilogram', 'kilograms', 'kí', 'ký', 'cân', '公斤'],
    ['g', 'g', 'g', '克', 'gram', 'grams', 'gam'],
    ['tấn', 'Tonne', 'Tonnes', '吨', 'tonne', 'tonnes', 'ton', 'tons'],
    ['m', 'm', 'm', '米', 'mét', 'met', 'meter', 'meters', 'metre', 'metres'],
    ['cm', 'cm', 'cm', '厘米'],
    ['mm', 'mm', 'mm', '毫米'],
    ['km', 'km', 'km', '公里', 'cây số'],
    ['m²', 'm²', 'm²', '平方米', 'm2', 'mét vuông', 'sqm'],
    ['m³', 'm³', 'm³', '立方米', 'm3', 'khối', 'mét khối', 'cbm'],
    ['lít', 'L', 'L', '升', 'l', 'lit', 'liter', 'liters', 'litre', 'litres'],
    ['ml', 'mL', 'mL', '毫升', 'mililít'],
    ['giờ', 'Hour', 'Hours', '小时', 'hr', 'hrs', 'hour', 'hours', 'tiếng'],
    ['ngày', 'Day', 'Days', '天', 'day', 'days', '日'],
    ['tuần', 'Week', 'Weeks', '周', 'week', 'weeks'],
    ['tháng', 'Month', 'Months', '月', 'month', 'months', '个月'],
    ['năm', 'Year', 'Years', '年', 'year', 'years'],
    ['lần', 'Time', 'Times', '次', 'time', 'times'],
    ['chuyến', 'Trip', 'Trips', '趟', 'trip', 'trips'],
    ['người', 'Person', 'People', '人', 'person', 'people', 'pax'],
    ['phòng', 'Room', 'Rooms', '间', 'room', 'rooms'],
    ['suất', 'Serving', 'Servings', '份', 'serving', 'servings', 'portion'],
    ['buổi', 'Session', 'Sessions', '场', 'session', 'sessions'],
    ['công', 'Man-day', 'Man-days', '工日', 'man-day', 'man-days'],
  ];
  const key = (s) => String(s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  const BY = new Map(); // mọi tên/bí danh → dòng; tên có dấu được ưu tiên hơn bí danh không dấu
  for (const r of LIST) BY.set(key(r[0]), r); // khoá tiếng Việt thắng (vd. “can” = can nhựa)
  for (const r of LIST) for (const n of [r[1], r[2], r[3], ...r.slice(4)]) { const k = key(n); if (!BY.has(k)) BY.set(k, r); }
  const find = (u) => BY.get(key(u)) || null;
  // khoá chuẩn để lưu: “Units” / “件” / “pcs” → “cái” / “chiếc”; tên lạ giữ nguyên (đã gọn khoảng trắng)
  const canon = (u) => { const s = String(u ?? '').trim().replace(/\s+/g, ' '); const r = find(s); return r ? r[0] : s; };
  // tên hiện theo ngôn ngữ; en có số ít/số nhiều theo số lượng (không có số lượng → số nhiều, như Odoo “Units”)
  function label(u, lang = 'vi', qty) {
    const s = String(u ?? '').trim(); const r = find(s); if (!r || lang === 'vi') return r && lang === 'vi' ? r[0] : s;
    if (lang === 'zh') return r[3];
    return qty != null && Math.abs(Number(qty)) === 1 ? r[1] : r[2];
  }
  const names = (lang = 'vi') => LIST.map(r => lang === 'zh' ? r[3] : lang === 'en' ? r[2] : r[0]);
  const api = { canon, label, names, known: (u) => !!find(u), LIST };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.AIVN_UOM = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
