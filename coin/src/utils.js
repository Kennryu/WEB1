const { COIN } = require('./config');

// "12.345" → 1234500000n (koinu)
function parseCoin(str) {
  const s = String(str).trim();
  if (!/^\d+(\.\d{1,8})?$/.test(s)) throw new Error(`잘못된 금액: ${str}`);
  const [whole, frac = ''] = s.split('.');
  return BigInt(whole) * COIN + BigInt(frac.padEnd(8, '0'));
}

// 1234500000n → "12.345"
function formatCoin(koinu) {
  const v = BigInt(koinu);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const frac = (a % COIN).toString().padStart(8, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + (a / COIN).toString() + (frac ? '.' + frac : '');
}

// 압축 난이도 표기(bits) ↔ 256비트 목표값
function bitsToTarget(bits) {
  const exp = bits >>> 24;
  const mant = BigInt(bits & 0x007fffff);
  return exp <= 3 ? mant >> BigInt(8 * (3 - exp)) : mant << BigInt(8 * (exp - 3));
}

function targetToBits(target) {
  if (target <= 0n) return 0;
  let size = Math.ceil(target.toString(16).length / 2);
  let mant = size <= 3 ? Number(target << BigInt(8 * (3 - size))) : Number(target >> BigInt(8 * (size - 3)));
  if (mant & 0x00800000) { mant >>= 8; size++; }
  return ((size << 24) | mant) >>> 0;
}

// 블록 하나의 기대 작업량 = 2^256 / (target + 1)
const blockWork = (bits) => (1n << 256n) / (bitsToTarget(bits) + 1n);

const now = () => Math.floor(Date.now() / 1000);

module.exports = { parseCoin, formatCoin, bitsToTarget, targetToBits, blockWork, now };
