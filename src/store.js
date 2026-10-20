const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(file, defaults) { this.file = file; this.defaults = defaults; this.data = this._read(); }
  _read() {
    try { return Object.assign(structuredClone(this.defaults), JSON.parse(fs.readFileSync(this.file, 'utf8'))); }
    catch { return structuredClone(this.defaults); }
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
module.exports = { JsonStore };
