// 브라우저 지갑 라이브러리 (ES 모듈, 외부 의존성 없음)
// secp256k1 ECDSA(RFC6979) · SHA-256 · RIPEMD-160 · Base58Check · 거래 생성/서명
// 노드(src/transaction.js)와 바이트 단위로 같은 직렬화/서명 해시를 사용합니다.

// ── 바이트 유틸 ──────────────────────────────────────────
const enc = new TextEncoder();
export const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h) => new Uint8Array(h.match(/../g)?.map((x) => parseInt(x, 16)) ?? []);
const concat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};
const bytesToInt = (b) => (b.length ? BigInt('0x' + toHex(b)) : 0n);
const intToBytes = (n, len = 32) => fromHex(n.toString(16).padStart(len * 2, '0'));

// ── SHA-256 ─────────────────────────────────────────────
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

export function sha256(msg) {
  const len = msg.length;
  const padded = new Uint8Array((((len + 9) + 63) >> 6) << 6);
  padded.set(msg);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor((len * 8) / 2 ** 32));
  dv.setUint32(padded.length - 4, (len * 8) >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      W[i] = W[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + W[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  H.forEach((v, i) => odv.setUint32(i * 4, v));
  return out;
}
export const sha256d = (b) => sha256(sha256(b));

function hmacSha256(key, msg) {
  if (key.length > 64) key = sha256(key);
  const k = new Uint8Array(64); k.set(key);
  return sha256(concat(k.map((x) => x ^ 0x5c), sha256(concat(k.map((x) => x ^ 0x36), msg))));
}

// ── RIPEMD-160 ──────────────────────────────────────────
const RL = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8,3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12,1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2,4,0,5,9,7,12,2,10,14,1,3,8,11,6,15,13];
const RR = [5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12,6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2,15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13,8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14,12,15,10,4,1,5,8,7,6,2,13,14,0,3,9,11];
const SL = [11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8,7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12,11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5,11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12,9,15,5,11,6,8,13,12,5,12,13,14,11,8,5,6];
const SR = [8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6,9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11,9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5,15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8,8,5,12,9,12,5,14,6,8,13,6,5,15,13,11,11];
const KL = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
const KR = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];
const rotl = (x, n) => (x << n) | (x >>> (32 - n));
const rf = (j, x, y, z) =>
  j < 16 ? x ^ y ^ z : j < 32 ? (x & y) | (~x & z) : j < 48 ? (x | ~y) ^ z : j < 64 ? (x & z) | (y & ~z) : x ^ (y | ~z);

export function ripemd160(msg) {
  const len = msg.length;
  const padded = new Uint8Array((((len + 9) + 63) >> 6) << 6);
  padded.set(msg);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, (len * 8) >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor((len * 8) / 2 ** 32), true);
  let h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const X = new Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) X[i] = dv.getUint32(off + i * 4, true);
    let [al, bl, cl, dl, el] = h;
    let [ar, br, cr, dr, er] = h;
    for (let j = 0; j < 80; j++) {
      let t = (rotl((al + rf(j, bl, cl, dl) + X[RL[j]] + KL[j >> 4]) | 0, SL[j]) + el) | 0;
      al = el; el = dl; dl = rotl(cl, 10); cl = bl; bl = t;
      t = (rotl((ar + rf(79 - j, br, cr, dr) + X[RR[j]] + KR[j >> 4]) | 0, SR[j]) + er) | 0;
      ar = er; er = dr; dr = rotl(cr, 10); cr = br; br = t;
    }
    h = [(h[1] + cl + dr) | 0, (h[2] + dl + er) | 0, (h[3] + el + ar) | 0, (h[4] + al + br) | 0, (h[0] + bl + cr) | 0];
  }
  const out = new Uint8Array(20);
  const odv = new DataView(out.buffer);
  h.forEach((v, i) => odv.setUint32(i * 4, v >>> 0, true));
  return out;
}
export const hash160 = (b) => ripemd160(sha256(b));

// ── secp256k1 ───────────────────────────────────────────
const P = 2n ** 256n - 2n ** 32n - 977n;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [
  0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
];
const mod = (a, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };
function inv(a, m = P) {
  let [lo, hi, x0, x1] = [mod(a, m), m, 1n, 0n];
  while (lo > 1n) { const q = hi / lo; [lo, hi] = [hi - q * lo, lo]; [x0, x1] = [x1 - q * x0, x0]; }
  return mod(x0, m);
}
// 야코비안 좌표 (역원 계산을 마지막 한 번만)
function jDouble([X, Y, Z]) {
  if (Y === 0n) return [0n, 1n, 0n];
  const S = mod(4n * X * Y * Y), M = mod(3n * X * X);
  const X3 = mod(M * M - 2n * S);
  return [X3, mod(M * (S - X3) - 8n * Y ** 4n), mod(2n * Y * Z)];
}
function jAdd(p, q) {
  if (p[2] === 0n) return q;
  if (q[2] === 0n) return p;
  const [X1, Y1, Z1] = p, [X2, Y2, Z2] = q;
  const U1 = mod(X1 * Z2 * Z2), U2 = mod(X2 * Z1 * Z1);
  const S1 = mod(Y1 * Z2 ** 3n), S2 = mod(Y2 * Z1 ** 3n);
  if (U1 === U2) return S1 === S2 ? jDouble(p) : [0n, 1n, 0n];
  const H = mod(U2 - U1), R = mod(S2 - S1);
  const H2 = mod(H * H), H3 = mod(H * H2);
  const X3 = mod(R * R - H3 - 2n * U1 * H2);
  return [X3, mod(R * (U1 * H2 - X3) - S1 * H3), mod(H * Z1 * Z2)];
}
function mulG(k) {
  let R = [0n, 1n, 0n], A = [G[0], G[1], 1n];
  while (k > 0n) { if (k & 1n) R = jAdd(R, A); A = jDouble(A); k >>= 1n; }
  const zi = inv(R[2]);
  return [mod(R[0] * zi * zi), mod(R[1] * zi ** 3n)];
}

export function getPublicKey(priv) {
  const [x, y] = mulG(bytesToInt(priv));
  return concat(new Uint8Array([y & 1n ? 3 : 2]), intToBytes(x));
}

export function generatePrivateKey() {
  for (;;) {
    const k = crypto.getRandomValues(new Uint8Array(32));
    const d = bytesToInt(k);
    if (d > 0n && d < N) return k;
  }
}

function derInt(n) {
  let b = fromHex(n.toString(16).padStart(n.toString(16).length + (n.toString(16).length % 2), '0'));
  if (b[0] & 0x80) b = concat(new Uint8Array([0]), b);
  return concat(new Uint8Array([0x02, b.length]), b);
}

// msg 를 SHA-256 한 뒤 ECDSA 서명 (노드의 crypto.sign('sha256', msg) 와 동일), DER 인코딩
export function sign(priv, msg) {
  const h = sha256(msg);
  const d = bytesToInt(priv);
  const z = mod(bytesToInt(h), N);
  const x = intToBytes(d), h1 = intToBytes(z);
  // RFC6979 결정적 nonce
  let V = new Uint8Array(32).fill(1), K = new Uint8Array(32);
  K = hmacSha256(K, concat(V, [0], x, h1)); V = hmacSha256(K, V);
  K = hmacSha256(K, concat(V, [1], x, h1)); V = hmacSha256(K, V);
  for (;;) {
    V = hmacSha256(K, V);
    const k = bytesToInt(V);
    if (k > 0n && k < N) {
      const r = mod(mulG(k)[0], N);
      let s = mod(inv(k, N) * (z + r * d), N);
      if (r !== 0n && s !== 0n) {
        if (s > N / 2n) s = N - s; // low-S
        const body = concat(derInt(r), derInt(s));
        return concat(new Uint8Array([0x30, body.length]), body);
      }
    }
    K = hmacSha256(K, concat(V, [0])); V = hmacSha256(K, V);
  }
}

// ── Base58Check / 주소 / WIF ─────────────────────────────
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(b) {
  let n = bytesToInt(b), s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const x of b) { if (x) break; s = '1' + s; }
  return s;
}
function b58decode(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error('잘못된 문자'); n = n * 58n + BigInt(i); }
  const hex = n === 0n ? '' : n.toString(16);
  const lead = s.match(/^1*/)[0].length;
  return concat(new Uint8Array(lead), fromHex(hex.length % 2 ? '0' + hex : hex));
}
const b58checkEncode = (ver, payload) => { const d = concat([ver], payload); return b58encode(concat(d, sha256d(d).slice(0, 4))); };
function b58checkDecode(s) {
  const b = b58decode(s);
  if (b.length < 5) throw new Error('너무 짧음');
  const d = b.slice(0, -4);
  if (toHex(sha256d(d).slice(0, 4)) !== toHex(b.slice(-4))) throw new Error('체크섬 불일치');
  return { version: d[0], payload: d.slice(1) };
}

// 노드의 /info 에서 받아 덮어씁니다
export const params = {
  addressVersion: 0x1e, wifVersion: 0x9e, coin: 100000000n,
  minFeePerKb: 1000000n, dust: 1000000n, ticker: 'WOW',
};
export const setParams = (p) => Object.assign(params, p);

export const pubKeyToAddress = (pub) => b58checkEncode(params.addressVersion, hash160(pub));
export function isValidAddress(a) {
  try { const { version, payload } = b58checkDecode(a); return version === params.addressVersion && payload.length === 20; } catch { return false; }
}
export const privToWIF = (priv) => b58checkEncode(params.wifVersion, concat(priv, [1]));
export function wifToPriv(wif) {
  const { version, payload } = b58checkDecode(wif.trim());
  if (version !== params.wifVersion) throw new Error('이 코인의 개인키(WIF)가 아닙니다');
  return payload.slice(0, 32);
}

// ── 금액 ────────────────────────────────────────────────
export function parseCoin(str) {
  const s = String(str).trim();
  if (!/^\d+(\.\d{1,8})?$/.test(s)) throw new Error('금액 형식이 올바르지 않습니다 (소수점 8자리까지)');
  const [w, f = ''] = s.split('.');
  return BigInt(w) * params.coin + BigInt(f.padEnd(8, '0'));
}
export function formatCoin(v, { group = false } = {}) {
  v = BigInt(v);
  const neg = v < 0n, a = neg ? -v : v;
  let whole = (a / params.coin).toString();
  if (group) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = (a % params.coin).toString().padStart(8, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + whole + (frac ? '.' + frac : '');
}

// ── 지갑 / 거래 ─────────────────────────────────────────
export class Wallet {
  constructor(priv) {
    this.privateKey = priv;
    this.publicKey = getPublicKey(priv);
    this.address = pubKeyToAddress(this.publicKey);
  }
  static generate() { return new Wallet(generatePrivateKey()); }
  static fromWIF(wif) { return new Wallet(wifToPriv(wif)); }
  get wif() { return privToWIF(this.privateKey); }
}

// src/transaction.js 의 serialize() 와 동일한 키 순서
function serialize(tx, stripSigs) {
  return JSON.stringify({
    v: tx.version,
    in: tx.inputs.map((i) => ({ txid: i.txid, vout: i.vout, pubKey: i.pubKey, sig: stripSigs ? '' : i.signature || '' })),
    out: tx.outputs.map((o) => ({ value: o.value.toString(), address: o.address })),
    lock: tx.lockTime,
  });
}
export const txSize = (tx) => enc.encode(serialize(tx, false)).length;
export const txid = (tx) => toHex(sha256d(enc.encode(serialize(tx, false))));
export const minFee = (size) => BigInt(Math.ceil(size / 1000)) * params.minFeePerKb;

function buildAndSign(wallet, selected, to, amount, fee) {
  const total = selected.reduce((s, u) => s + u.value, 0n);
  const outputs = [{ value: amount, address: to }];
  const change = total - amount - fee;
  if (change >= params.dust) outputs.push({ value: change, address: wallet.address });
  const tx = { version: 1, inputs: selected.map((u) => ({ txid: u.txid, vout: u.vout })), outputs, lockTime: 0 };
  const pub = toHex(wallet.publicKey);
  for (const i of tx.inputs) i.pubKey = pub;
  tx.inputs.forEach((input, idx) => {
    const sighash = sha256d(enc.encode(serialize(tx, true) + ':' + idx));
    input.signature = toHex(sign(wallet.privateKey, sighash));
  });
  return { tx, fee: total - amount - (change >= params.dust ? change : 0n) };
}

/** utxos: [{txid, vout, value: BigInt}] → { tx, fee, json } */
export function createTransaction(wallet, utxos, to, amount) {
  if (!isValidAddress(to)) throw new Error('받는 주소가 올바르지 않습니다');
  if (amount < params.dust) throw new Error(`최소 ${formatCoin(params.dust)} ${params.ticker} 이상 보내야 합니다`);
  const sorted = [...utxos].sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));
  let fee = params.minFeePerKb;
  for (let attempt = 0; attempt < 10; attempt++) {
    const selected = [];
    let total = 0n;
    for (const u of sorted) { if (total >= amount + fee) break; selected.push(u); total += u.value; }
    if (total < amount + fee) throw new Error('잔액이 부족합니다 (수수료 포함)');
    const r = buildAndSign(wallet, selected, to, amount, fee);
    const need = minFee(txSize(r.tx));
    if (need <= fee) {
      return {
        ...r,
        txid: txid(r.tx),
        json: { ...r.tx, outputs: r.tx.outputs.map((o) => ({ value: o.value.toString(), address: o.address })) },
      };
    }
    fee = need;
  }
  throw new Error('수수료 계산 실패');
}
