// DOMMatrix 2D tối giản cho pdf.js khi chạy trong Node/Electron main (chỉ cần cho trích xuất chữ, không vẽ hình).
class DOMMatrixLite {
  constructor(init) {
    let [a, b, c, d, e, f] = [1, 0, 0, 1, 0, 0];
    if (Array.isArray(init) || ArrayBuffer.isView(init)) {
      if (init.length === 6) [a, b, c, d, e, f] = init;
      else if (init.length === 16) [a, b, c, d, e, f] = [init[0], init[1], init[4], init[5], init[12], init[13]];
    } else if (init && typeof init === 'object') ({ a = 1, b = 0, c = 0, d = 1, e = 0, f = 0 } = init);
    Object.assign(this, { a, b, c, d, e, f });
  }
  get m11() { return this.a; } get m12() { return this.b; } get m21() { return this.c; } get m22() { return this.d; } get m41() { return this.e; } get m42() { return this.f; }
  get is2D() { return true; }
  get isIdentity() { return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0; }
  _set(a, b, c, d, e, f) { Object.assign(this, { a, b, c, d, e, f }); return this; }
  multiplySelf(m) { m = m instanceof DOMMatrixLite ? m : new DOMMatrixLite(m); const { a, b, c, d, e, f } = this;
    return this._set(a * m.a + c * m.b, b * m.a + d * m.b, a * m.c + c * m.d, b * m.c + d * m.d, a * m.e + c * m.f + e, b * m.e + d * m.f + f); }
  preMultiplySelf(m) { m = m instanceof DOMMatrixLite ? m : new DOMMatrixLite(m); const t = new DOMMatrixLite(m).multiplySelf(this); return this._set(t.a, t.b, t.c, t.d, t.e, t.f); }
  multiply(m) { return new DOMMatrixLite(this).multiplySelf(m); }
  translateSelf(x = 0, y = 0) { return this.multiplySelf([1, 0, 0, 1, x, y]); }
  translate(x, y) { return new DOMMatrixLite(this).translateSelf(x, y); }
  scaleSelf(sx = 1, sy = sx) { return this.multiplySelf([sx, 0, 0, sy, 0, 0]); }
  scale(sx, sy) { return new DOMMatrixLite(this).scaleSelf(sx, sy); }
  rotateSelf(deg = 0) { const r = deg * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r); return this.multiplySelf([cs, sn, -sn, cs, 0, 0]); }
  invertSelf() { const { a, b, c, d, e, f } = this; const det = a * d - b * c;
    if (!det) return this._set(NaN, NaN, NaN, NaN, NaN, NaN);
    return this._set(d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det); }
  inverse() { return new DOMMatrixLite(this).invertSelf(); }
  transformPoint(p = {}) { const x = p.x || 0, y = p.y || 0; return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 }; }
  toFloat64Array() { return Float64Array.from([this.a, this.b, 0, 0, this.c, this.d, 0, 0, 0, 0, 1, 0, this.e, this.f, 0, 1]); }
  static fromMatrix(m) { return new DOMMatrixLite(m); }
}
if (typeof globalThis.DOMMatrix === 'undefined') globalThis.DOMMatrix = DOMMatrixLite;
if (typeof globalThis.Path2D === 'undefined') globalThis.Path2D = class Path2D { addPath() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {} closePath() {} rect() {} };
if (typeof globalThis.ImageData === 'undefined') globalThis.ImageData = class ImageData { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } };
module.exports = DOMMatrixLite;
