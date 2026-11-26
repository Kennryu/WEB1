// 해시, 서명, 주소 인코딩 — Node 내장 crypto만 사용합니다.
const crypto = require('crypto');
const config = require('./config');

const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const sha256d = (b) => sha256(sha256(b));
const hash160 = (b) => crypto.createHash('ripemd160').update(sha256(b)).digest();

// 도지코인 PoW 해시: scrypt(header, salt=header, N=1024, r=1, p=1)
function scryptHash(header) {
  const { N, r, p, keylen } = config.SCRYPT;
  return crypto.scryptSync(header, header, keylen, { N, r, p });
}

// 32바이트 해시(리틀엔디언)를 정수로 해석
const hashToBigInt = (buf) => BigInt('0x' + Buffer.from(buf).reverse().toString('hex'));

// ── Base58Check ──────────────────────────────────────────
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(buf) {
  let n = buf.length ? BigInt('0x' + buf.toString('hex')) : 0n;
  let s = '';
  while (n > 0n) { s = ALPHABET[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b !== 0) break; s = '1' + s; }
  return s;
}

function base58Decode(str) {
  let n = 0n;
  for (const c of str) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error('잘못된 base58 문자');
    n = n * 58n + BigInt(i);
  }
  let hex = n === 0n ? '' : n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let lead = 0;
  for (const c of str) { if (c !== '1') break; lead++; }
  return Buffer.concat([Buffer.alloc(lead), Buffer.from(hex, 'hex')]);
}

function base58CheckEncode(version, payload) {
  const data = Buffer.concat([Buffer.from([version]), payload]);
  return base58Encode(Buffer.concat([data, sha256d(data).subarray(0, 4)]));
}

function base58CheckDecode(str) {
  const buf = base58Decode(str);
  if (buf.length < 5) throw new Error('너무 짧은 base58check 문자열');
  const data = buf.subarray(0, -4);
  if (!sha256d(data).subarray(0, 4).equals(buf.subarray(-4))) throw new Error('체크섬 불일치');
  return { version: data[0], payload: data.subarray(1) };
}

// ── secp256k1 키 / ECDSA ─────────────────────────────────
function generatePrivateKey() {
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.generateKeys();
  const k = ecdh.getPrivateKey();
  return Buffer.concat([Buffer.alloc(32 - k.length), k]);
}

function getPublicKey(priv, compressed = true) {
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(priv);
  return ecdh.getPublicKey(null, compressed ? 'compressed' : 'uncompressed');
}

function jwkFromUncompressed(pub, priv) {
  const jwk = {
    kty: 'EC', crv: 'secp256k1',
    x: pub.subarray(1, 33).toString('base64url'),
    y: pub.subarray(33, 65).toString('base64url'),
  };
  if (priv) jwk.d = priv.toString('base64url');
  return jwk;
}

function sign(priv, msg) {
  const key = crypto.createPrivateKey({ key: jwkFromUncompressed(getPublicKey(priv, false), priv), format: 'jwk' });
  return crypto.sign('sha256', msg, key); // DER 서명
}

function verify(pubCompressed, msg, sig) {
  try {
    const un = crypto.ECDH.convertKey(pubCompressed, 'secp256k1', undefined, undefined, 'uncompressed');
    const key = crypto.createPublicKey({ key: jwkFromUncompressed(Buffer.from(un)), format: 'jwk' });
    return crypto.verify('sha256', msg, key, sig);
  } catch {
    return false;
  }
}

// ── 주소 / WIF ───────────────────────────────────────────
const pubKeyToAddress = (pub) => base58CheckEncode(config.ADDRESS_VERSION, hash160(pub));

function isValidAddress(addr) {
  try {
    const { version, payload } = base58CheckDecode(addr);
    return version === config.ADDRESS_VERSION && payload.length === 20;
  } catch {
    return false;
  }
}

const privateKeyToWIF = (priv) =>
  base58CheckEncode(config.WIF_VERSION, Buffer.concat([priv, Buffer.from([0x01])])); // 압축 공개키 표시

function wifToPrivateKey(wif) {
  const { version, payload } = base58CheckDecode(wif);
  if (version !== config.WIF_VERSION) throw new Error('이 코인의 WIF가 아닙니다');
  return payload.subarray(0, 32);
}

module.exports = {
  sha256, sha256d, hash160, scryptHash, hashToBigInt,
  base58Encode, base58Decode, base58CheckEncode, base58CheckDecode,
  generatePrivateKey, getPublicKey, sign, verify,
  pubKeyToAddress, isValidAddress, privateKeyToWIF, wifToPrivateKey,
};
