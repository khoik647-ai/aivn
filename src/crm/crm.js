// Quản lý khách hàng (CRM) của AIVN: liên hệ, công ty, cơ hội, hoạt động, lịch sử, sản phẩm, báo giá, bảng điều khiển.
// Lưu cục bộ (SQLite), không gửi dữ liệu đi đâu.
const crypto = require('crypto');
const T = require('./text');
const UOM = require('./uom'); // đơn vị tính: lưu khoá chuẩn tiếng Việt, hiện theo ngôn ngữ
const TAX = require('./tax');
const { companyOf } = require('./company');

const STAGES = [
  { id: 'new', name: 'Mới', prob: 10 }, { id: 'contacted', name: 'Đã liên hệ', prob: 20 }, { id: 'quoted', name: 'Báo giá', prob: 40 },
  { id: 'negotiation', name: 'Đàm phán', prob: 70 }, { id: 'won', name: 'Thắng', prob: 100 }, { id: 'lost', name: 'Thua', prob: 0 },
];
const STAGE_VI = Object.fromEntries(STAGES.map(s => [s.id, s.name]));
const ACT_TYPES = { call: 'Gọi điện', meeting: 'Cuộc hẹn', email: 'Email', todo: 'Việc cần làm' };
const QUOTE_STATUS = { draft: 'Báo giá', sent: 'Báo giá đã gửi', sale: 'Đơn bán hàng', cancel: 'Đã huỷ' }; // theo Odoo sale.order
const NO_OWNER = '(chưa giao)';
const KIND_VI = { person: 'Cá nhân', company: 'Công ty' };
const newId = (p) => p + '_' + crypto.randomBytes(6).toString('hex');
const str = (v, max = 500) => (v == null ? '' : String(v)).trim().slice(0, max);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
class CrmError extends Error { constructor(m) { super(m); this.userMessage = m; } }

function createCrm({ db, defaultOwner = () => '', reminders = null, log = () => {} }) {
  const now = () => Date.now();
  const hist = (contactId, leadId, kind, text) => db.run('INSERT INTO history(id, contact_id, lead_id, kind, text, at) VALUES (?,?,?,?,?,?)', [newId('h'), contactId || null, leadId || null, kind, str(text, 2000), now()]);
  const parseTags = (v) => { if (Array.isArray(v)) return v; try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return String(v || '').split(/[,;]/); } };
  const cleanTags = (v) => [...new Set(parseTags(v).map(t => str(t, 40)).filter(Boolean))].slice(0, 20);
  const pubContact = (c) => c && ({ ...c, tags: parseTags(c.tags), phone_fmt: T.fmtPhone(c.phone), kind_vi: KIND_VI[c.kind] || c.kind });

  // ---------- Liên hệ & công ty ----------
  function saveContact(input = {}) {
    const old = input.id ? db.get('SELECT * FROM contacts WHERE id = ?', [input.id]) : null;
    if (input.id && !old) throw new CrmError('Không tìm thấy liên hệ.');
    const c = { ...(old || {}), ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
    c.kind = c.kind === 'company' ? 'company' : 'person';
    c.name = str(c.name, 200); if (!c.name) throw new CrmError('Hãy nhập tên liên hệ.');
    c.phone = str(c.phone, 40); c.phone_norm = T.normPhone(c.phone);
    if (c.phone && !T.validPhone(c.phone_norm)) throw new CrmError(`Số điện thoại "${c.phone}" chưa đúng định dạng Việt Nam (vd. 0912 345 678 hoặc +84 912 345 678).`);
    if (c.phone) c.phone = T.fmtPhone(c.phone);
    c.email = str(c.email, 200); c.email_norm = T.normEmail(c.email); if (!T.validEmail(c.email_norm)) throw new CrmError(`Email "${c.email}" chưa đúng.`);
    c.tax_id = T.normTax(c.tax_id); if (!T.validTax(c.tax_id)) throw new CrmError(`Mã số thuế "${input.tax_id}" phải có 10 số (hoặc 10 số-3 số cho chi nhánh, 12 số với cá nhân).`);
    c.address = str(c.address, 300); c.job_title = str(c.job_title, 120); c.owner = str(c.owner || (old ? old.owner : defaultOwner()), 80); c.notes = str(c.notes, 5000);
    c.tags = JSON.stringify(cleanTags(c.tags)); c.name_norm = T.fold(c.name);
    if (c.avatar && !/^data:image\/(png|jpeg|webp);base64,/.test(c.avatar)) c.avatar = null;
    if (c.avatar && c.avatar.length > 200000) throw new CrmError('Ảnh đại diện quá lớn.');
    c.company_id = c.kind === 'company' ? null : (c.company_id || null);
    if (c.company_id && !db.get("SELECT id FROM contacts WHERE id = ? AND kind = 'company'", [c.company_id])) c.company_id = null;
    c.updated_at = now();
    const cols = ['kind', 'name', 'name_norm', 'company_id', 'job_title', 'phone', 'phone_norm', 'email', 'email_norm', 'address', 'tax_id', 'tags', 'owner', 'notes', 'avatar', 'updated_at'];
    if (old) {
      db.run(`UPDATE contacts SET ${cols.map(k => k + ' = ?').join(', ')} WHERE id = ?`, [...cols.map(k => c[k] ?? null), c.id]);
      const changed = ['name', 'phone', 'email', 'address', 'tax_id', 'owner', 'company_id', 'job_title'].filter(k => (old[k] || '') !== (c[k] || ''));
      if (changed.length) hist(c.id, null, 'edit', 'Cập nhật: ' + changed.map(k => FIELD_VI[k]).join(', '));
    } else {
      c.id = newId('c'); c.created_at = now();
      db.run(`INSERT INTO contacts(id, created_at, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')})`, [c.id, c.created_at, ...cols.map(k => c[k] ?? null)]);
      hist(c.id, null, 'create', `Tạo ${c.kind === 'company' ? 'công ty' : 'liên hệ'} "${c.name}"`);
    }
    return pubContact(db.get('SELECT * FROM contacts WHERE id = ?', [c.id]));
  }
  const FIELD_VI = { name: 'tên', phone: 'điện thoại', email: 'email', address: 'địa chỉ', tax_id: 'MST', owner: 'người phụ trách', company_id: 'công ty', job_title: 'chức vụ' };

  function listContacts({ q = '', kind = '', tag = '', owner = '', companyId = '', groupBy = '', sort = 'name', limit = 500, offset = 0 } = {}) {
    const where = [], p = [];
    if (q) { const f = '%' + T.fold(q) + '%'; const ph = T.normPhone(q); where.push(`(name_norm LIKE ? OR email_norm LIKE ? OR tax_id LIKE ? OR lower(tags) LIKE ?${ph.length >= 3 ? ' OR phone_norm LIKE ?' : ''})`); p.push(f, '%' + q.toLowerCase().trim() + '%', '%' + q.trim() + '%', '%' + q.toLowerCase().trim() + '%'); if (ph.length >= 3) p.push('%' + ph.replace(/^0/, '') + '%'); }
    if (kind) { where.push('kind = ?'); p.push(kind); }
    if (tag) { where.push('tags LIKE ?'); p.push('%' + JSON.stringify(String(tag)).slice(0, -1) + '"%'); }
    if (owner) { where.push('owner = ?'); p.push(owner); }
    if (companyId) { where.push('company_id = ?'); p.push(companyId); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const order = sort === 'recent' ? 'updated_at DESC' : sort === 'created' ? 'created_at DESC' : 'name_norm ASC';
    const total = db.get(`SELECT count(*) AS n FROM contacts ${w}`, p).n;
    const rows = db.all(`SELECT c.*, (SELECT name FROM contacts x WHERE x.id = c.company_id) AS company_name,
      (SELECT count(*) FROM leads l WHERE l.contact_id = c.id AND l.stage NOT IN ('won','lost')) AS open_leads,
      (SELECT min(due_at) FROM activities a WHERE a.contact_id = c.id AND a.done_at IS NULL) AS next_due
      FROM contacts c ${w.replace(/\b(name_norm|email_norm|tax_id|tags|phone_norm|kind|owner|company_id)\b/g, 'c.$1')} ORDER BY ${order.replace(/^(\w)/, 'c.$1')} LIMIT ? OFFSET ?`, [...p, Math.min(5000, limit), offset]).map(pubContact);
    let groups = null;
    if (groupBy) {
      const key = (c) => groupBy === 'tag' ? (c.tags.length ? c.tags : ['(không có thẻ)']) : groupBy === 'owner' ? [c.owner || '(chưa giao)'] : groupBy === 'company' ? [c.kind === 'company' ? c.name : c.company_name || '(không thuộc công ty)'] : groupBy === 'kind' ? [c.kind_vi] : ['Tất cả'];
      const m = new Map(); for (const c of rows) for (const k of key(c)) { if (!m.has(k)) m.set(k, []); m.get(k).push(c.id); }
      groups = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'vi')).map(([name, ids]) => ({ name, ids }));
    }
    return { rows, total, groups };
  }

  function getContact(id) {
    const c = pubContact(db.get('SELECT * FROM contacts WHERE id = ?', [id])); if (!c) throw new CrmError('Không tìm thấy liên hệ.');
    c.company = c.company_id ? pubContact(db.get('SELECT * FROM contacts WHERE id = ?', [c.company_id])) : null;
    c.members = c.kind === 'company' ? db.all('SELECT * FROM contacts WHERE company_id = ? ORDER BY name_norm', [id]).map(pubContact) : [];
    const ids = [id, ...c.members.map(m => m.id)]; const qs = ids.map(() => '?').join(',');
    c.leads = db.all(`SELECT * FROM leads WHERE contact_id IN (${qs}) ORDER BY updated_at DESC`, ids).map(l => ({ ...l, stage_vi: STAGE_VI[l.stage] }));
    c.activities = db.all(`SELECT * FROM activities WHERE contact_id IN (${qs}) ORDER BY (done_at IS NOT NULL), coalesce(due_at, 9e15) ASC, created_at DESC`, ids).map(pubAct);
    c.history = db.all(`SELECT * FROM history WHERE contact_id IN (${qs}) ORDER BY at DESC LIMIT 300`, ids);
    c.quotes = db.all(`SELECT * FROM quotes WHERE contact_id IN (${qs}) ORDER BY created_at DESC`, ids).map(q => ({ ...q, ...quoteTotals(q), status_vi: QUOTE_STATUS[q.status] }));
    const won = c.leads.filter(l => l.stage === 'won');
    c.stats = { openLeads: c.leads.filter(l => !['won', 'lost'].includes(l.stage)).length, wonRevenue: won.reduce((a, l) => a + (l.expected_revenue || 0), 0), pipeline: c.leads.filter(l => !['won', 'lost'].includes(l.stage)).reduce((a, l) => a + (l.expected_revenue || 0), 0), openActivities: c.activities.filter(a => !a.done_at).length };
    return c;
  }
  function deleteContact(id) {
    const c = db.get('SELECT * FROM contacts WHERE id = ?', [id]); if (!c) return false;
    db.tx(() => {
      for (const a of db.all('SELECT id, schedule_id FROM activities WHERE contact_id = ?', [id])) dropReminder(a);
      db.run('DELETE FROM activities WHERE contact_id = ?', [id]); db.run('DELETE FROM history WHERE contact_id = ?', [id]);
      db.run('UPDATE leads SET contact_id = NULL WHERE contact_id = ?', [id]); db.run('UPDATE quotes SET contact_id = NULL WHERE contact_id = ?', [id]);
      db.run('UPDATE contacts SET company_id = NULL WHERE company_id = ?', [id]); db.run('DELETE FROM contacts WHERE id = ?', [id]);
    });
    return true;
  }
  const facets = () => {
    const tags = new Map(); for (const r of db.all('SELECT tags FROM contacts')) for (const t of parseTags(r.tags)) tags.set(t, (tags.get(t) || 0) + 1);
    const owners = [...new Set([...db.all("SELECT DISTINCT owner FROM contacts WHERE owner <> ''"), ...db.all("SELECT DISTINCT owner FROM leads WHERE owner <> ''")].map(r => r.owner))].sort((a, b) => a.localeCompare(b, 'vi'));
    return { tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })), owners, companies: db.all("SELECT id, name FROM contacts WHERE kind = 'company' ORDER BY name_norm").map(r => ({ id: r.id, name: r.name })) };
  };

  // ---------- Cơ hội (pipeline) ----------
  function saveLead(input = {}) {
    const old = input.id ? db.get('SELECT * FROM leads WHERE id = ?', [input.id]) : null;
    if (input.id && !old) throw new CrmError('Không tìm thấy cơ hội.');
    const l = { ...(old || {}), ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
    l.title = str(l.title, 200); if (!l.title) throw new CrmError('Hãy đặt tên cho cơ hội.');
    if (!STAGE_VI[l.stage]) l.stage = 'new';
    l.expected_revenue = Math.max(0, T.parseVnd(l.expected_revenue));
    l.probability = l.probability === '' || l.probability == null ? STAGES.find(s => s.id === l.stage).prob : Math.max(0, Math.min(100, Math.round(Number(l.probability) || 0)));
    if (l.stage === 'won') l.probability = 100; if (l.stage === 'lost') l.probability = 0;
    l.close_date = /^\d{4}-\d{2}-\d{2}$/.test(String(l.close_date || '')) ? l.close_date : null;
    l.contact_id = l.contact_id && db.get('SELECT id FROM contacts WHERE id = ?', [l.contact_id]) ? l.contact_id : null;
    l.owner = str(l.owner || defaultOwner(), 80); l.notes = str(l.notes, 5000); l.lost_reason = str(l.lost_reason, 300);
    l.updated_at = now();
    if (['won', 'lost'].includes(l.stage) && (!old || old.stage !== l.stage)) l.closed_at = now(); else if (!['won', 'lost'].includes(l.stage)) l.closed_at = null;
    const cols = ['title', 'contact_id', 'stage', 'expected_revenue', 'probability', 'close_date', 'owner', 'notes', 'lost_reason', 'position', 'updated_at', 'closed_at'];
    if (old) {
      db.run(`UPDATE leads SET ${cols.map(k => k + ' = ?').join(', ')} WHERE id = ?`, [...cols.map(k => l[k] ?? null), l.id]);
      if (old.stage !== l.stage) hist(l.contact_id, l.id, 'stage', `Cơ hội "${l.title}": ${STAGE_VI[old.stage]} → ${STAGE_VI[l.stage]}${l.stage === 'lost' && l.lost_reason ? ' (lý do: ' + l.lost_reason + ')' : ''}`);
      else if (old.expected_revenue !== l.expected_revenue) hist(l.contact_id, l.id, 'edit', `Cơ hội "${l.title}": doanh thu dự kiến ${T.fmtVnd(old.expected_revenue)} → ${T.fmtVnd(l.expected_revenue)}`);
    } else {
      l.id = newId('l'); l.created_at = now();
      l.position = (db.get('SELECT max(position) AS p FROM leads WHERE stage = ?', [l.stage]).p || 0) + 1;
      db.run(`INSERT INTO leads(id, created_at, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')})`, [l.id, l.created_at, ...cols.map(k => l[k] ?? null)]);
      hist(l.contact_id, l.id, 'lead', `Tạo cơ hội "${l.title}" (${STAGE_VI[l.stage]}, ${T.fmtVnd(l.expected_revenue)})`);
    }
    return pubLead(db.get('SELECT * FROM leads WHERE id = ?', [l.id]));
  }
  const pubLead = (l) => l && ({ ...l, stage_vi: STAGE_VI[l.stage], contact_name: l.contact_id ? (db.get('SELECT name FROM contacts WHERE id = ?', [l.contact_id]) || {}).name || null : null, weighted: Math.round((l.expected_revenue || 0) * (l.probability || 0) / 100) });
  function moveLead(id, stage, beforeId = null) {
    const l = db.get('SELECT * FROM leads WHERE id = ?', [id]); if (!l) throw new CrmError('Không tìm thấy cơ hội.');
    if (!STAGE_VI[stage]) throw new CrmError('Giai đoạn không hợp lệ.');
    const col = db.all('SELECT id, position FROM leads WHERE stage = ? AND id <> ? ORDER BY position', [stage, id]);
    let pos; const i = beforeId ? col.findIndex(x => x.id === beforeId) : -1;
    if (i < 0) pos = (col.length ? col[col.length - 1].position : 0) + 1; else pos = i === 0 ? col[0].position - 1 : (col[i - 1].position + col[i].position) / 2;
    const prob = stage === l.stage ? l.probability : (stage === 'won' ? 100 : stage === 'lost' ? 0 : Math.max(STAGES.find(s => s.id === stage).prob, ['won', 'lost'].includes(l.stage) ? 0 : 0) || STAGES.find(s => s.id === stage).prob);
    return saveLead({ id, stage, position: pos, probability: prob });
  }
  function listLeads({ q = '', owner = '', contactId = '', stage = '' } = {}) {
    const where = [], p = [];
    if (q) { where.push('(lower(l.title) LIKE ? OR c.name_norm LIKE ?)'); p.push('%' + q.toLowerCase() + '%', '%' + T.fold(q) + '%'); }
    if (owner) { where.push('l.owner = ?'); p.push(owner); }
    if (contactId) { where.push('l.contact_id = ?'); p.push(contactId); }
    if (stage) { where.push('l.stage = ?'); p.push(stage); }
    const rows = db.all(`SELECT l.*, c.name AS contact_name, c.phone AS contact_phone FROM leads l LEFT JOIN contacts c ON c.id = l.contact_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.position ASC, l.created_at ASC`, p)
      .map(l => ({ ...l, stage_vi: STAGE_VI[l.stage], weighted: Math.round((l.expected_revenue || 0) * (l.probability || 0) / 100) }));
    const columns = STAGES.map(s => { const items = rows.filter(r => r.stage === s.id); return { ...s, items, sum: items.reduce((a, r) => a + (r.expected_revenue || 0), 0), count: items.length }; });
    return { rows, columns };
  }
  function deleteLead(id) { const l = db.get('SELECT * FROM leads WHERE id = ?', [id]); if (!l) return false; db.tx(() => { db.run('UPDATE activities SET lead_id = NULL WHERE lead_id = ?', [id]); db.run('UPDATE quotes SET lead_id = NULL WHERE lead_id = ?', [id]); db.run('DELETE FROM leads WHERE id = ?', [id]); }); hist(l.contact_id, null, 'lead', `Xoá cơ hội "${l.title}"`); return true; }

  // ---------- Hoạt động (gọi, hẹn, email, việc cần làm) + nhắc việc qua Lịch tự động ----------
  const pubAct = (a) => a && ({ ...a, type_vi: ACT_TYPES[a.type] || a.type, overdue: !a.done_at && a.due_at && a.due_at < now(), contact_name: a.contact_id ? (db.get('SELECT name FROM contacts WHERE id = ?', [a.contact_id]) || {}).name || null : null });
  function dropReminder(a) { if (a && a.schedule_id && reminders) { try { reminders.remove(a.schedule_id); } catch {} } }
  function armReminder(a) {
    if (!reminders || !a.due_at || a.done_at || a.remind_min == null || a.remind_min < 0) return null;
    const at = a.due_at - a.remind_min * 60000; if (at < now() - 30000) return null;
    const who = a.contact_id ? (db.get('SELECT name, phone FROM contacts WHERE id = ?', [a.contact_id]) || {}) : {};
    try { return reminders.create({ title: `${ACT_TYPES[a.type]}: ${a.title}`.slice(0, 120), message: [who.name ? `Khách hàng: ${who.name}${who.phone ? ' · ' + who.phone : ''}` : '', a.notes || ''].filter(Boolean).join('\n'), at: Math.max(at, now() + 5000) }); } catch (e) { log('[crm] không đặt được nhắc việc: ' + e.message); return null; }
  }
  function saveActivity(input = {}) {
    const old = input.id ? db.get('SELECT * FROM activities WHERE id = ?', [input.id]) : null;
    if (input.id && !old) throw new CrmError('Không tìm thấy hoạt động.');
    const a = { ...(old || {}), ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
    a.type = ACT_TYPES[a.type] ? a.type : 'todo'; a.title = str(a.title, 200) || ACT_TYPES[a.type];
    a.notes = str(a.notes, 3000); a.owner = str(a.owner || defaultOwner(), 80);
    a.due_at = a.due_at ? (typeof a.due_at === 'number' ? a.due_at : Date.parse(a.due_at)) : null; if (!Number.isFinite(a.due_at)) a.due_at = null;
    a.remind_min = a.remind_min === '' || a.remind_min == null ? null : Math.max(0, Math.min(10080, Number(a.remind_min) || 0));
    a.contact_id = a.contact_id && db.get('SELECT id FROM contacts WHERE id = ?', [a.contact_id]) ? a.contact_id : null;
    a.lead_id = a.lead_id && db.get('SELECT id FROM leads WHERE id = ?', [a.lead_id]) ? a.lead_id : null;
    if (a.lead_id && !a.contact_id) a.contact_id = (db.get('SELECT contact_id FROM leads WHERE id = ?', [a.lead_id]) || {}).contact_id || null;
    a.updated_at = now();
    if (old) dropReminder(old);
    if (!old) { a.id = newId('a'); a.created_at = now(); }
    a.schedule_id = armReminder(a)?.id || null;
    const cols = ['contact_id', 'lead_id', 'type', 'title', 'notes', 'due_at', 'remind_min', 'schedule_id', 'done_at', 'owner', 'updated_at'];
    if (old) db.run(`UPDATE activities SET ${cols.map(k => k + ' = ?').join(', ')} WHERE id = ?`, [...cols.map(k => a[k] ?? null), a.id]);
    else { db.run(`INSERT INTO activities(id, created_at, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')})`, [a.id, a.created_at, ...cols.map(k => a[k] ?? null)]); hist(a.contact_id, a.lead_id, 'activity', `Lên lịch ${ACT_TYPES[a.type].toLowerCase()}: ${a.title}${a.due_at ? ' (hạn ' + fmtDate(a.due_at) + ')' : ''}`); }
    return pubAct(db.get('SELECT * FROM activities WHERE id = ?', [a.id]));
  }
  const fmtDate = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };
  function completeActivity(id, result = '') {
    const a = db.get('SELECT * FROM activities WHERE id = ?', [id]); if (!a) throw new CrmError('Không tìm thấy hoạt động.');
    dropReminder(a);
    db.run('UPDATE activities SET done_at = ?, schedule_id = NULL, notes = ?, updated_at = ? WHERE id = ?', [now(), [a.notes, result ? 'Kết quả: ' + str(result, 2000) : ''].filter(Boolean).join('\n'), now(), id]);
    hist(a.contact_id, a.lead_id, 'done', `Đã xong ${(ACT_TYPES[a.type] || '').toLowerCase()}: ${a.title}${result ? ' — ' + str(result, 500) : ''}`);
    return pubAct(db.get('SELECT * FROM activities WHERE id = ?', [id]));
  }
  function deleteActivity(id) { const a = db.get('SELECT * FROM activities WHERE id = ?', [id]); if (!a) return false; dropReminder(a); db.run('DELETE FROM activities WHERE id = ?', [id]); return true; }
  function listActivities({ status = 'open', contactId = '', owner = '', limit = 300 } = {}) {
    const where = [], p = []; const t0 = new Date(); t0.setHours(0, 0, 0, 0); const t1 = t0.getTime() + 864e5;
    if (status === 'open') where.push('done_at IS NULL'); else if (status === 'done') where.push('done_at IS NOT NULL');
    else if (status === 'overdue') { where.push('done_at IS NULL AND due_at < ?'); p.push(now()); } else if (status === 'today') { where.push('done_at IS NULL AND due_at >= ? AND due_at < ?'); p.push(t0.getTime(), t1); }
    if (contactId) { where.push('contact_id = ?'); p.push(contactId); } if (owner) { where.push('owner = ?'); p.push(owner); }
    return db.all(`SELECT * FROM activities ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${status === 'done' ? 'done_at DESC' : 'coalesce(due_at, 9e15) ASC'} LIMIT ?`, [...p, limit]).map(pubAct);
  }
  function addNote(contactId, text, leadId = null) { if (!str(text)) throw new CrmError('Ghi chú trống.'); if (!db.get('SELECT id FROM contacts WHERE id = ?', [contactId])) throw new CrmError('Không tìm thấy liên hệ.'); hist(contactId, leadId, 'note', text); return true; }

  // ---------- Sản phẩm & báo giá ----------
  function saveProduct(input = {}) {
    const old = input.id ? db.get('SELECT * FROM products WHERE id = ?', [input.id]) : null;
    const p = { ...(old || {}), ...input }; p.name = str(p.name, 200); if (!p.name) throw new CrmError('Hãy nhập tên sản phẩm.');
    p.sku = str(p.sku, 60); p.unit = UOM.canon(str(p.unit, 30)) || 'cái'; p.price = Math.max(0, TAX.moneyIn(p.price)); p.description = str(p.description, 1000); p.active = p.active === false || p.active === 0 || p.active === '0' ? 0 : 1; p.updated_at = now();
    // 0.16 (theo Odoo): loại sản phẩm — product = hàng lưu kho (theo dõi tồn), consu = hàng tiêu dùng (giao nhưng không tính tồn), service = dịch vụ
    p.type = ['product', 'consu', 'service'].includes(p.type) ? p.type : 'product';
    if (old && old.type !== p.type && db.get("SELECT id FROM moves WHERE product_id = ? AND state = 'done' LIMIT 1", [p.id])) throw new CrmError('Sản phẩm đã có dịch chuyển kho: không đổi loại sản phẩm được nữa.');
    p.vat_pct = TAX.vatOf(p.vat_pct, 10); // 0.16: thuế GTGT mặc định của sản phẩm (Odoo: Thuế khách hàng/nhà cung cấp)
    p.cost = Math.max(0, TAX.moneyIn(p.cost)); p.barcode = str(p.barcode, 60); p.category = str(p.category, 80); p.min_qty = (() => { const n = T.parseQty(p.min_qty); if (!(p.min_qty == null || String(p.min_qty).trim() === '') && !Number.isFinite(n)) throw new CrmError(`Số lượng “${p.min_qty}” không phải là số.`); return Math.max(0, Number.isFinite(n) ? n : 0); })();
    p.max_qty = (() => { const n = T.parseQty(p.max_qty); if (!(p.max_qty == null || String(p.max_qty).trim() === '') && !Number.isFinite(n)) throw new CrmError(`Số lượng “${p.max_qty}” không phải là số.`); return Math.max(0, Number.isFinite(n) ? n : 0); })(); // #42 K2: tồn tối đa
    if (p.sku && db.get('SELECT id FROM products WHERE sku = ? AND id != ? AND active = 1', [p.sku, p.id || ''])) throw new CrmError(`Mã sản phẩm "${p.sku}" đã dùng cho sản phẩm khác.`);
    if (p.barcode && db.get('SELECT id FROM products WHERE barcode = ? AND id != ? AND active = 1', [p.barcode, p.id || ''])) throw new CrmError(`Mã vạch "${p.barcode}" đã dùng cho sản phẩm khác.`);
    const cols = ['name', 'sku', 'unit', 'price', 'description', 'active', 'type', 'cost', 'barcode', 'category', 'min_qty', 'max_qty', 'vat_pct', 'updated_at'];
    if (old) db.run(`UPDATE products SET ${cols.map(k => k + '=?').join(', ')} WHERE id=?`, [...cols.map(k => p[k]), p.id]);
    else { p.id = newId('p'); db.run(`INSERT INTO products(id, created_at, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')})`, [p.id, now(), ...cols.map(k => p[k])]); }
    return db.get('SELECT * FROM products WHERE id = ?', [p.id]);
  }
  const listProducts = ({ q = '', all = false } = {}) => db.all(`SELECT * FROM products WHERE ${all ? '1' : 'active = 1'} ${q ? 'AND (lower(name) LIKE ? OR lower(sku) LIKE ?)' : ''} ORDER BY name`, q ? ['%' + q.toLowerCase() + '%', '%' + q.toLowerCase() + '%'] : []);
  // B54: lưu trữ sản phẩm còn tồn kho → báo (tồn và giá trị tồn sẽ biến khỏi báo cáo); force = người dùng đã đồng ý
  const deleteProduct = (id, { force = false } = {}) => {
    let q = 0; try { q = db.get("SELECT COALESCE(SUM(CASE kind WHEN 'in' THEN qty_done WHEN 'out' THEN -qty_done ELSE qty_done END), 0) AS q FROM moves WHERE product_id = ? AND state = 'done'", [id]).q; } catch {}
    if (Math.abs(q) > 1e-9 && !force) { const e = new CrmError(`Sản phẩm còn tồn ${(Math.round(q * 1000) / 1000).toLocaleString('vi-VN')} trong kho. Kiểm kê về 0 trước khi lưu trữ, hoặc xác nhận vẫn lưu trữ.`); e.code = 'stock'; throw e; }
    return db.run('UPDATE products SET active = 0 WHERE id = ?', [id]) > 0;
  };
  // 0.16: thuế theo từng dòng (src/crm/tax.js); chứng từ cũ làm tròn “toàn chứng từ” nên tổng giữ nguyên
  function quoteTotals(q) {
    const lines = db.all('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY pos', [q.id]);
    const t = TAX.totals(lines, TAX.roundingOf(q.tax_rounding));
    return { subtotal: t.amount_untaxed, vat: t.amount_tax, total: t.amount_total, tax_groups: t.tax_groups, lineCount: lines.length };
  }
  function nextQuoteNumber() { const y = new Date().getFullYear(); const r = db.get('SELECT number FROM quotes WHERE number LIKE ? ORDER BY number DESC LIMIT 1', [`BG-${y}-%`]); const n = r ? parseInt(r.number.split('-')[2], 10) + 1 : 1; return `BG-${y}-${String(n).padStart(4, '0')}`; }
  function saveQuote(input = {}) {
    const old = input.id ? db.get('SELECT * FROM quotes WHERE id = ?', [input.id]) : null;
    if (input.id && !old) throw new CrmError('Không tìm thấy báo giá.');
    const q = { ...(old || {}), ...Object.fromEntries(Object.entries(input).filter(([k, v]) => v !== undefined && k !== 'lines')) };
    q.contact_id = q.contact_id && db.get('SELECT id FROM contacts WHERE id = ?', [q.contact_id]) ? q.contact_id : null;
    if (!q.contact_id) throw new CrmError('Báo giá cần chọn khách hàng.');
    q.lead_id = q.lead_id && db.get('SELECT id FROM leads WHERE id = ?', [q.lead_id]) ? q.lead_id : null;
    // xác nhận/huỷ đơn chỉ qua các nút của Bán hàng (biz.js: confirmOrder/cancelOrder) vì còn tạo phiếu giao hàng; đơn đã xác nhận/huỷ thì khoá dòng
    if (old && ['sale', 'cancel'].includes(old.status) && Array.isArray(input.lines)) throw new CrmError(old.status === 'sale' ? 'Đơn bán hàng đã xác nhận: không sửa dòng được nữa. Huỷ đơn rồi “Đặt lại báo giá” nếu cần sửa.' : 'Đơn đã huỷ: bấm “Đặt lại báo giá” trước khi sửa.');
    q.status = old && ['sale', 'cancel'].includes(old.status) ? old.status : ['draft', 'sent'].includes(q.status) ? q.status : old ? old.status : 'draft';
    q.owner = str(q.owner || (old ? old.owner : defaultOwner()), 80); q.payment_days = Math.max(0, Math.min(365, parseInt(q.payment_days, 10) || 0));
    q.commitment_date = /^\d{4}-\d{2}-\d{2}$/.test(q.commitment_date || '') ? q.commitment_date : null;
    q.date = /^\d{4}-\d{2}-\d{2}$/.test(q.date || '') ? q.date : today();
    q.valid_until = /^\d{4}-\d{2}-\d{2}$/.test(q.valid_until || '') ? q.valid_until : null;
    q.vat_pct = TAX.vatOf(q.vat_pct, 10); q.notes = str(q.notes, 3000); q.updated_at = now(); // B52; mức của chứng từ = mức mặc định cho dòng không ghi thuế
    q.tax_rounding = old ? TAX.roundingOf(old.tax_rounding) : companyOf(db).tax_rounding;
    // thuế của dòng: ghi trên dòng > mức chứng từ người dùng vừa chọn > thuế mặc định của sản phẩm > mức chứng từ
    const docVatGiven = input.vat_pct !== undefined && input.vat_pct !== null && input.vat_pct !== '';
    const lineVat = (l) => { if (l.vat_pct !== undefined && l.vat_pct !== null && l.vat_pct !== '') return TAX.vatOf(l.vat_pct); if (!docVatGiven && l.product_id) { const pr = db.get('SELECT vat_pct FROM products WHERE id = ?', [l.product_id]); if (pr && pr.vat_pct != null) return TAX.vatOf(pr.vat_pct); } return q.vat_pct; };
    const lines = Array.isArray(input.lines) ? input.lines.map((l, i) => ({ id: newId('ql'), product_id: l.product_id || null, name: str(l.name, 300), unit: UOM.canon(str(l.unit, 30)) || 'cái', qty: (() => { const n = T.parseQty(l.qty); if (l.qty != null && String(l.qty).trim() !== '' && !Number.isFinite(n)) throw new CrmError(`Số lượng “${l.qty}” không phải là số.`); return Math.max(0, Number.isFinite(n) ? n : 0); })(), price: Math.max(0, TAX.moneyIn(l.price)), discount_pct: TAX.pctIn(l.discount_pct), vat_pct: lineVat(l), pos: i })).filter(l => l.name) : null;
    db.tx(() => {
      if (old) db.run('UPDATE quotes SET contact_id=?, lead_id=?, status=?, date=?, valid_until=?, notes=?, vat_pct=?, owner=?, payment_days=?, commitment_date=?, updated_at=? WHERE id=?', [q.contact_id, q.lead_id, q.status, q.date, q.valid_until, q.notes, q.vat_pct, q.owner, q.payment_days, q.commitment_date, q.updated_at, q.id]);
      else { q.id = newId('q'); q.number = nextQuoteNumber(); db.run('INSERT INTO quotes(id, number, contact_id, lead_id, status, date, valid_until, notes, vat_pct, owner, payment_days, commitment_date, tax_rounding, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [q.id, q.number, q.contact_id, q.lead_id, q.status, q.date, q.valid_until, q.notes, q.vat_pct, q.owner, q.payment_days, q.commitment_date, q.tax_rounding, now(), q.updated_at]); }
      if (lines) { db.run('DELETE FROM quote_lines WHERE quote_id = ?', [q.id]); for (const l of lines) db.run('INSERT INTO quote_lines(id, quote_id, product_id, name, unit, qty, price, discount_pct, vat_pct, pos) VALUES (?,?,?,?,?,?,?,?,?,?)', [l.id, q.id, l.product_id, l.name, l.unit, l.qty, l.price, l.discount_pct, l.vat_pct, l.pos]); }
    });
    const full = getQuote(q.id);
    if (!old) hist(q.contact_id, q.lead_id, 'quote', `Tạo báo giá ${full.number}: ${T.fmtVnd(full.total)}`);
    else if (old.status !== q.status) hist(q.contact_id, q.lead_id, 'quote', `Báo giá ${full.number}: ${QUOTE_STATUS[old.status]} → ${QUOTE_STATUS[q.status]}`);
    if (!old && q.lead_id) { const l = db.get('SELECT stage FROM leads WHERE id = ?', [q.lead_id]); if (l && ['new', 'contacted'].includes(l.stage)) moveLead(q.lead_id, 'quoted'); }
    return full;
  }
  function getQuote(id) {
    const q = db.get('SELECT * FROM quotes WHERE id = ?', [id]); if (!q) throw new CrmError('Không tìm thấy báo giá.');
    q.lines = db.all('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY pos', [id]).map(l => ({ ...l, amount: TAX.lineSubtotal(l, TAX.roundingOf(q.tax_rounding)), tax: TAX.lineTax(l, TAX.roundingOf(q.tax_rounding)) }));
    Object.assign(q, quoteTotals(q)); q.status_vi = QUOTE_STATUS[q.status]; q.total_words = T.vndWords(q.total);
    q.contact = q.contact_id ? pubContact(db.get('SELECT * FROM contacts WHERE id = ?', [q.contact_id])) : null;
    if (q.contact && q.contact.company_id) q.company = pubContact(db.get('SELECT * FROM contacts WHERE id = ?', [q.contact.company_id]));
    q.lead = q.lead_id ? db.get('SELECT id, title FROM leads WHERE id = ?', [q.lead_id]) : null;
    return q;
  }
  const listQuotes = ({ q = '', status = '' } = {}) => db.all(`SELECT q.*, c.name AS contact_name FROM quotes q LEFT JOIN contacts c ON c.id = q.contact_id WHERE 1 ${status ? 'AND q.status = ?' : ''} ${q ? 'AND (lower(q.number) LIKE ? OR c.name_norm LIKE ?)' : ''} ORDER BY q.created_at DESC`, [...(status ? [status] : []), ...(q ? ['%' + q.toLowerCase() + '%', '%' + T.fold(q) + '%'] : [])]).map(x => ({ ...x, ...quoteTotals(x), status_vi: QUOTE_STATUS[x.status] }));
  const deleteQuote = (id) => { const q = db.get('SELECT * FROM quotes WHERE id = ?', [id]); if (!q) return false; if (q.status === 'sale') throw new CrmError('Không xoá được đơn bán hàng đã xác nhận — hãy huỷ đơn trước.'); if (db.get("SELECT id FROM invoices WHERE so_id = ? AND state != 'cancel' LIMIT 1", [id]) || db.get("SELECT id FROM pickings WHERE so_id = ? AND state = 'done' LIMIT 1", [id])) throw new CrmError('Đơn đã có hoá đơn hoặc đã giao hàng: không xoá được, chỉ huỷ.'); db.run("DELETE FROM moves WHERE picking_id IN (SELECT id FROM pickings WHERE so_id = ?)", [id]); db.run('DELETE FROM pickings WHERE so_id = ?', [id]); db.tx(() => { db.run('DELETE FROM quote_lines WHERE quote_id = ?', [id]); db.run('DELETE FROM quotes WHERE id = ?', [id]); }); hist(q.contact_id, q.lead_id, 'quote', `Xoá báo giá ${q.number}`); return true; };

  // ---------- Chế độ xem đã lưu ----------
  const listViews = (entity) => db.all('SELECT * FROM views WHERE entity = ? ORDER BY created_at', [entity]).map(v => ({ ...v, spec: JSON.parse(v.spec || '{}') }));
  function saveView({ entity, name, spec }) { name = str(name, 60); if (!name) throw new CrmError('Hãy đặt tên cho chế độ xem.'); const id = newId('v'); db.run('INSERT INTO views(id, entity, name, spec, created_at) VALUES (?,?,?,?,?)', [id, entity, name, JSON.stringify(spec || {}), now()]); return { id, entity, name, spec }; }
  const deleteView = (id) => db.run('DELETE FROM views WHERE id = ?', [id]) > 0;

  // ---------- Bảng điều khiển ----------
  function dashboard({ owner = '' } = {}) {
    const ow = owner ? ' AND owner = ?' : ''; const op = owner ? [owner] : [];
    const open = db.get(`SELECT count(*) AS n, coalesce(sum(expected_revenue),0) AS sum, coalesce(sum(expected_revenue * probability / 100.0),0) AS weighted FROM leads WHERE stage NOT IN ('won','lost')${ow}`, op);
    const d = new Date(); const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); const since90 = now() - 90 * 864e5;
    const wonMonth = db.get(`SELECT count(*) AS n, coalesce(sum(expected_revenue),0) AS sum FROM leads WHERE stage = 'won' AND closed_at >= ?${ow}`, [monthStart, ...op]);
    const closed = db.get(`SELECT sum(stage='won') AS won, sum(stage='lost') AS lost FROM leads WHERE stage IN ('won','lost')${ow}`, op);
    const closed90 = db.get(`SELECT sum(stage='won') AS won, sum(stage='lost') AS lost FROM leads WHERE stage IN ('won','lost') AND closed_at >= ?${ow}`, [since90, ...op]);
    const rate = (c) => (c.won || 0) + (c.lost || 0) ? Math.round(100 * (c.won || 0) / ((c.won || 0) + (c.lost || 0))) : null;
    const byStage = STAGES.map(s => { const r = db.get(`SELECT count(*) AS n, coalesce(sum(expected_revenue),0) AS sum FROM leads WHERE stage = ?${ow}`, [s.id, ...op]); return { id: s.id, name: s.name, n: r.n, sum: r.sum }; });
    const byOwner = db.all(`SELECT coalesce(nullif(owner,''),?) AS owner, sum(stage NOT IN ('won','lost')) AS open, coalesce(sum(CASE WHEN stage NOT IN ('won','lost') THEN expected_revenue * probability / 100.0 END),0) AS weighted,
      coalesce(sum(CASE WHEN stage='won' THEN expected_revenue END),0) AS won_sum, sum(stage='won') AS won, sum(stage='lost') AS lost FROM leads GROUP BY 1 ORDER BY weighted DESC`, [NO_OWNER]).map(r => ({ ...r, weighted: Math.round(r.weighted), rate: rate(r) }));
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const acts = db.get(`SELECT sum(due_at < ?) AS overdue, sum(due_at >= ? AND due_at < ?) AS today, count(*) AS open FROM activities WHERE done_at IS NULL${ow}`, [now(), t0.getTime(), t0.getTime() + 864e5, ...op]);
    const upcoming = db.all(`SELECT * FROM activities WHERE done_at IS NULL${ow} ORDER BY coalesce(due_at, 9e15) LIMIT 8`, op).map(pubAct);
    const recentWon = db.all(`SELECT l.*, c.name AS contact_name FROM leads l LEFT JOIN contacts c ON c.id = l.contact_id WHERE l.stage = 'won'${owner ? ' AND l.owner = ?' : ''} ORDER BY l.closed_at DESC LIMIT 5`, op);
    // doanh thu đã thắng theo tháng (6 tháng gần nhất)
    const months = []; for (let i = 5; i >= 0; i--) { const s = new Date(d.getFullYear(), d.getMonth() - i, 1); const e = new Date(d.getFullYear(), d.getMonth() - i + 1, 1); const r = db.get(`SELECT coalesce(sum(expected_revenue),0) AS sum FROM leads WHERE stage='won' AND closed_at >= ? AND closed_at < ?${ow}`, [s.getTime(), e.getTime(), ...op]); months.push({ label: `T${s.getMonth() + 1}/${String(s.getFullYear()).slice(2)}`, sum: r.sum }); }
    const counts = { contacts: db.get("SELECT count(*) AS n FROM contacts WHERE kind='person'").n, companies: db.get("SELECT count(*) AS n FROM contacts WHERE kind='company'").n, quotesOpen: db.get("SELECT count(*) AS n FROM quotes WHERE status IN ('draft','sent')").n };
    return { open: { n: open.n, sum: open.sum, weighted: Math.round(open.weighted) }, wonMonth, winRate: rate(closed), winRate90: rate(closed90), closed, byStage, byOwner, activities: { overdue: acts.overdue || 0, today: acts.today || 0, open: acts.open || 0 }, upcoming, recentWon, months, counts };
  }

  // ---------- Trùng lặp & gộp ----------
  function findDuplicates() {
    const rows = db.all('SELECT * FROM contacts'); const groups = []; const seen = new Set();
    const by = (key, reason) => { const m = new Map(); for (const r of rows) { const k = key(r); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } for (const [k, list] of m) if (list.length > 1) { const sig = list.map(x => x.id).sort().join('|'); if (!seen.has(sig)) { seen.add(sig); groups.push({ reason, key: k, contacts: list.map(pubContact) }); } } };
    by(r => r.phone_norm, 'Cùng số điện thoại'); by(r => r.email_norm, 'Cùng email'); by(r => r.tax_id, 'Cùng mã số thuế'); by(r => r.kind + ':' + r.name_norm, 'Cùng tên');
    return groups;
  }
  function merge(primaryId, otherIds = []) {
    const p = db.get('SELECT * FROM contacts WHERE id = ?', [primaryId]); if (!p) throw new CrmError('Không tìm thấy liên hệ chính.');
    const others = otherIds.filter(id => id !== primaryId).map(id => db.get('SELECT * FROM contacts WHERE id = ?', [id])).filter(Boolean);
    if (!others.length) throw new CrmError('Chọn ít nhất một liên hệ khác để gộp.');
    db.tx(() => {
      const m = { ...p }; const tags = new Set(parseTags(p.tags)); const notes = [p.notes];
      for (const o of others) {
        for (const k of ['company_id', 'job_title', 'phone', 'phone_norm', 'email', 'email_norm', 'address', 'tax_id', 'owner', 'avatar']) if (!m[k] && o[k]) m[k] = o[k];
        parseTags(o.tags).forEach(t => tags.add(t)); if (o.notes) notes.push(o.notes);
        for (const t of ['leads', 'activities', 'history', 'quotes']) db.run(`UPDATE ${t} SET contact_id = ? WHERE contact_id = ?`, [primaryId, o.id]);
        db.run('UPDATE contacts SET company_id = ? WHERE company_id = ?', [primaryId, o.id]);
        db.run('DELETE FROM contacts WHERE id = ?', [o.id]);
      }
      db.run('UPDATE contacts SET company_id=?, job_title=?, phone=?, phone_norm=?, email=?, email_norm=?, address=?, tax_id=?, owner=?, avatar=?, tags=?, notes=?, updated_at=? WHERE id=?',
        [m.company_id === primaryId ? null : m.company_id, m.job_title, m.phone, m.phone_norm, m.email, m.email_norm, m.address, m.tax_id, m.owner, m.avatar, JSON.stringify([...tags]), [...new Set(notes.filter(Boolean))].join('\n---\n'), now(), primaryId]);
      hist(primaryId, null, 'merge', `Gộp ${others.length} liên hệ trùng: ${others.map(o => o.name).join(', ')}`);
    });
    return getContact(primaryId);
  }

  // ---------- Nhập / xuất ----------
  const HEADER_ALIASES = {
    name: ['ten', 'ho ten', 'ho va ten', 'ten khach hang', 'khach hang', 'name', 'full name', 'contact', 'ten lien he'],
    kind: ['loai', 'kieu', 'type', 'kind'], company: ['cong ty', 'ten cong ty', 'company', 'doanh nghiep', 'to chuc'], job_title: ['chuc vu', 'vi tri', 'title', 'job title', 'position'],
    phone: ['dien thoai', 'so dien thoai', 'sdt', 'dt', 'phone', 'mobile', 'di dong', 'tel'], email: ['email', 'e-mail', 'thu dien tu', 'mail'],
    address: ['dia chi', 'address', 'dc'], tax_id: ['mst', 'ma so thue', 'tax id', 'tax code', 'vat'], tags: ['the', 'nhan', 'tags', 'tag', 'nhom'],
    owner: ['phu trach', 'nguoi phu trach', 'nhan vien', 'owner', 'sale', 'salesperson'], notes: ['ghi chu', 'notes', 'note', 'mo ta'],
  };
  function mapHeaders(header) {
    const map = {}; header.forEach((h, i) => { const f = T.fold(h).replace(/[^a-z0-9 -]/g, '').trim(); for (const [k, al] of Object.entries(HEADER_ALIASES)) if (!(k in map) && al.includes(f)) { map[k] = i; break; } });
    return map;
  }
  function previewImport(rows) {
    if (!rows.length) throw new CrmError('Tệp không có dữ liệu.');
    const map = mapHeaders(rows[0].map(String)); if (!('name' in map)) throw new CrmError('Không thấy cột tên (vd. "Họ tên", "Tên khách hàng"). Hàng đầu tiên phải là tiêu đề cột.');
    const data = rows.slice(1); let dups = 0, invalid = 0;
    for (const r of data) { const ph = T.normPhone(r[map.phone]); const em = T.normEmail(r[map.email]); if (!String(r[map.name] || '').trim()) invalid++; else if ((ph && db.get('SELECT id FROM contacts WHERE phone_norm = ?', [ph])) || (em && db.get('SELECT id FROM contacts WHERE email_norm = ?', [em]))) dups++; }
    return { columns: Object.fromEntries(Object.entries(map).map(([k, i]) => [k, rows[0][i]])), rows: data.length, duplicates: dups, invalid, sample: data.slice(0, 5).map(r => Object.fromEntries(Object.entries(map).map(([k, i]) => [k, r[i] ?? '']))) };
  }
  function importContacts(rows, { onDuplicate = 'merge' } = {}) {
    const map = mapHeaders(rows[0].map(String)); if (!('name' in map)) throw new CrmError('Không thấy cột tên.');
    const res = { created: 0, merged: 0, skipped: 0, errors: [] };
    const cell = (r, k) => k in map ? String(r[map[k]] ?? '').trim() : '';
    db.tx(() => {
      rows.slice(1).forEach((r, i) => {
        const line = i + 2; const name = cell(r, 'name'); if (!name) { res.skipped++; return; }
        try {
          const kindRaw = T.fold(cell(r, 'kind')); const kind = /cong ty|company|doanh nghiep|to chuc/.test(kindRaw) ? 'company' : 'person';
          let company_id = null; const cname = cell(r, 'company');
          if (cname && kind === 'person') { const ex = db.get("SELECT id FROM contacts WHERE kind = 'company' AND name_norm = ?", [T.fold(cname)]); company_id = ex ? ex.id : saveContact({ kind: 'company', name: cname }).id; }
          let phone = cell(r, 'phone'); if (phone && !T.validPhone(T.normPhone(phone))) { res.errors.push(`Dòng ${line}: số điện thoại "${phone}" không hợp lệ, đã bỏ qua số này.`); phone = ''; }
          let email = cell(r, 'email'); if (email && !T.validEmail(T.normEmail(email))) { res.errors.push(`Dòng ${line}: email "${email}" không hợp lệ, đã bỏ qua.`); email = ''; }
          let tax = cell(r, 'tax_id'); if (tax && !T.validTax(T.normTax(tax))) { res.errors.push(`Dòng ${line}: MST "${tax}" không hợp lệ, đã bỏ qua.`); tax = ''; }
          const data = { kind, name, company_id, job_title: cell(r, 'job_title'), phone, email, address: cell(r, 'address'), tax_id: tax, tags: cell(r, 'tags').split(/[,;|]/), owner: cell(r, 'owner'), notes: cell(r, 'notes') };
          const ph = T.normPhone(phone), em = T.normEmail(email);
          const ex = (ph && db.get('SELECT * FROM contacts WHERE phone_norm = ?', [ph])) || (em && db.get('SELECT * FROM contacts WHERE email_norm = ?', [em])) || (tax && db.get('SELECT * FROM contacts WHERE tax_id = ?', [T.normTax(tax)]));
          if (ex) {
            if (onDuplicate === 'skip') { res.skipped++; return; }
            const patch = { id: ex.id }; for (const [k, v] of Object.entries(data)) if (k !== 'tags' && v && !ex[k]) patch[k] = v;
            patch.tags = [...new Set([...parseTags(ex.tags), ...data.tags.map(t => t.trim()).filter(Boolean)])];
            saveContact(patch); res.merged++;
          } else { saveContact(data); res.created++; }
        } catch (e) { res.errors.push(`Dòng ${line}: ${e.userMessage || e.message}`); res.skipped++; }
      });
    });
    return res;
  }
  function exportContacts() {
    const head = ['Loại', 'Họ tên', 'Công ty', 'Chức vụ', 'Điện thoại', 'Email', 'Địa chỉ', 'MST', 'Thẻ', 'Phụ trách', 'Ghi chú', 'Ngày tạo'];
    const rows = db.all('SELECT c.*, (SELECT name FROM contacts x WHERE x.id = c.company_id) AS company_name FROM contacts c ORDER BY c.kind DESC, c.name_norm').map(c => [KIND_VI[c.kind], c.name, c.company_name || '', c.job_title || '', c.phone || '', c.email || '', c.address || '', c.tax_id || '', parseTags(c.tags).join(', '), c.owner || '', c.notes || '', c.created_at ? new Date(c.created_at).toLocaleDateString('vi-VN') : '']);
    return [head, ...rows];
  }
  function exportLeads() {
    const head = ['Cơ hội', 'Khách hàng', 'Giai đoạn', 'Doanh thu dự kiến (VND)', 'Xác suất (%)', 'Ngày dự kiến chốt', 'Phụ trách', 'Ghi chú'];
    return [head, ...listLeads().rows.map(l => [l.title, l.contact_name || '', l.stage_vi, l.expected_revenue || 0, l.probability || 0, l.close_date || '', l.owner || '', l.notes || ''])];
  }

  // ---------- Cho AI: hồ sơ khách hàng dạng văn bản ----------
  function profileText(id, { maxHistory = 40 } = {}) {
    const c = getContact(id); const L = [];
    L.push(`${c.kind_vi}: ${c.name}${c.company ? ' (công ty ' + c.company.name + ')' : ''}${c.job_title ? ', ' + c.job_title : ''}`);
    if (c.phone) L.push('Điện thoại: ' + c.phone); if (c.email) L.push('Email: ' + c.email); if (c.address) L.push('Địa chỉ: ' + c.address); if (c.tax_id) L.push('MST: ' + c.tax_id);
    if (c.tags.length) L.push('Thẻ: ' + c.tags.join(', ')); if (c.owner) L.push('Phụ trách: ' + c.owner); if (c.notes) L.push('Ghi chú: ' + c.notes.slice(0, 800));
    if (c.members.length) L.push('Người liên hệ trong công ty: ' + c.members.map(m => m.name + (m.job_title ? ' (' + m.job_title + ')' : '')).join(', '));
    L.push(`Cơ hội (${c.leads.length}): ` + (c.leads.map(l => `"${l.title}" – ${l.stage_vi}, ${T.fmtVnd(l.expected_revenue)}, ${l.probability}%${l.close_date ? ', dự kiến chốt ' + l.close_date : ''}`).join('; ') || 'chưa có'));
    const open = c.activities.filter(a => !a.done_at); L.push(`Việc đang mở (${open.length}): ` + (open.map(a => `${a.type_vi} "${a.title}"${a.due_at ? ' hạn ' + fmtDate(a.due_at) : ''}${a.overdue ? ' (QUÁ HẠN)' : ''}`).join('; ') || 'không có'));
    if (c.quotes.length) L.push('Báo giá: ' + c.quotes.map(q => `${q.number} ${q.status_vi} ${T.fmtVnd(q.total)}`).join('; '));
    L.push('Lịch sử gần nhất (mới → cũ):'); for (const h of c.history.slice(0, maxHistory)) L.push(`- ${new Date(h.at).toLocaleDateString('vi-VN')}: ${h.text}`);
    return { contact: c, text: L.join('\n') };
  }
  // tìm theo tên/sđt/email, trả nhiều nhất n mục
  const find = (q, n = 5) => listContacts({ q, limit: n }).rows;

  return { STAGES, ACT_TYPES, QUOTE_STATUS, saveContact, listContacts, getContact, deleteContact, facets, saveLead, moveLead, listLeads, deleteLead,
    saveActivity, completeActivity, deleteActivity, listActivities, addNote, saveProduct, listProducts, deleteProduct, saveQuote, getQuote, listQuotes, deleteQuote,
    listViews, saveView, deleteView, dashboard, findDuplicates, merge, previewImport, importContacts, exportContacts, exportLeads, profileText, find, nextQuoteNumber };
}
module.exports = { createCrm, CrmError, STAGES, ACT_TYPES, QUOTE_STATUS };
