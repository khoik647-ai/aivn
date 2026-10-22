'use strict';
// B172: bản nháp chưa gửi, theo từng trang, trong phiên làm việc.
// Không có chữ hiện ra cho người dùng — app.js đọc/ghi các ô đã có sẵn.
(function (root) {
  const COMPOSER_FIELDS = {
    chat: ['input'],
    agent: ['input'],
    schedule: ['sfTitle', 'sfMsg', 'sfPrompt'],
    memory: ['memNew'],
  };
  const FILE_PAGES = { chat: true, agent: true };

  function createDrafts() {
    const text = Object.create(null);
    const files = Object.create(null);

    function bucket(page) {
      if (!text[page]) text[page] = Object.create(null);
      return text[page];
    }
    function note(page, field, value) {
      bucket(page)[field] = value == null ? '' : String(value);
    }
    // live chỉ ghi đè đúng các ô có mặt. fileList bỏ qua khi không truyền (undefined) hoặc trang không có tệp.
    // Mảng rỗng là bản nháp hợp lệ. null từ take() nghĩa là chưa từng cất tệp.
    function stash(page, live, fileList) {
      const fields = COMPOSER_FIELDS[page];
      if (fields && live && typeof live === 'object') {
        const b = bucket(page);
        for (const id of fields) {
          if (Object.prototype.hasOwnProperty.call(live, id)) b[id] = live[id] == null ? '' : String(live[id]);
        }
      }
      if (fileList !== undefined && FILE_PAGES[page] && Array.isArray(fileList)) files[page] = fileList.slice();
    }
    function take(page) {
      const fields = COMPOSER_FIELDS[page] || [];
      const b = text[page] || {};
      const apply = {};
      for (const id of fields) apply[id] = Object.prototype.hasOwnProperty.call(b, id) ? b[id] : '';
      return { apply, files: Object.prototype.hasOwnProperty.call(files, page) ? files[page].slice() : null };
    }
    function clear(page) {
      delete text[page];
      delete files[page];
    }
    function get(page, field) {
      const b = text[page];
      if (!b || !Object.prototype.hasOwnProperty.call(b, field)) return undefined;
      return b[field];
    }
    // B175: tệp đã cất không còn nằm trong mảng pending đang hiện. Tìm theo id, không theo “còn trong mảng”.
    function fileLists() {
      const out = [];
      for (const page of Object.keys(FILE_PAGES)) {
        if (Array.isArray(files[page])) out.push({ page, list: files[page] });
      }
      return out;
    }
    function hasFile(id) {
      return fileLists().some(({ list }) => list.some(a => a && a.id === id));
    }
    function patchFile(id, patch) {
      if (!patch || typeof patch !== 'object') return null;
      let page = null;
      for (const { page: name, list } of fileLists()) {
        for (const item of list) {
          if (item && item.id === id) { Object.assign(item, patch); page = name; }
        }
      }
      return page;
    }
    function removeFile(id) {
      let page = null;
      for (const { page: name, list } of fileLists()) {
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i] && list[i].id === id) { list.splice(i, 1); page = name; }
        }
      }
      return page;
    }
    function clearFiles(page) {
      if (!FILE_PAGES[page]) return false;
      files[page] = [];
      return true;
    }
    return { note, stash, take, clear, get, hasFile, patchFile, removeFile, clearFiles };
  }

  // Khung chat đang display:none thì scrollHeight = 0. Trả null để caller không gán height: 0px (chữ còn đó nhưng bị cắt).
  function nextHeight(viewActive, scrollHeight, max) {
    if (max == null) max = 180;
    if (!viewActive || !(scrollHeight > 0)) return null;
    return Math.min(max, scrollHeight);
  }

  const api = { COMPOSER_FIELDS, FILE_PAGES, createDrafts, nextHeight };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AIVN_DRAFTS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
