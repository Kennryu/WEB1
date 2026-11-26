// 아주 작은 QR 코드 생성기 (ES 모듈, 외부 의존성 없음)
// 바이트 모드 · 오류정정 레벨 M · 버전 1~10 (최대 213바이트) — 주소/결제 URI에 충분합니다.

// 버전별: 전체 코드워드 수, 블록당 오류정정 코드워드 수, 블록 수 (레벨 M)
const TOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const EC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const ALIGN = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const EC_LEVEL_M = 0b00;

// ── GF(256) / 리드-솔로몬 ───────────────────────────────
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < degree) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, divisor) {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ r.shift();
    r.push(0);
    divisor.forEach((d, i) => (r[i] ^= gfMul(d, factor)));
  }
  return r;
}

// ── 데이터 코드워드 ─────────────────────────────────────
function encodeData(bytes) {
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const capBits = (TOTAL[v] - EC_PER_BLOCK[v] * BLOCKS[v]) * 8;
    if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= capBits) { version = v; break; }
  }
  if (!version) throw new Error('QR에 담기에는 너무 긴 데이터입니다');

  const capacity = TOTAL[version] - EC_PER_BLOCK[version] * BLOCKS[version];
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4); // 바이트 모드
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacity * 8 - bits.length)); // 종료 패턴
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);

  // 블록 분할 → 각 블록 오류정정 → 인터리브
  const nb = BLOCKS[version], ecLen = EC_PER_BLOCK[version];
  const shortLen = Math.floor(capacity / nb);
  const numLong = capacity % nb;
  const divisor = rsDivisor(ecLen);
  const blocks = [];
  for (let i = 0, off = 0; i < nb; i++) {
    const len = shortLen + (i >= nb - numLong ? 1 : 0);
    const d = data.slice(off, off + len);
    off += len;
    blocks.push({ d, e: rsRemainder(d, divisor) });
  }
  const out = [];
  for (let i = 0; i <= shortLen; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.e[i]);
  return { version, codewords: out };
}

// ── 행렬 ────────────────────────────────────────────────
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function buildBase(version) {
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); } // 타이밍
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) { // 파인더 + 분리대
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d !== 2 && d !== 4);
    }
  }
  const pos = ALIGN[version]; // 정렬 패턴
  for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
      set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  drawFormat(m, fn, 0); // 자리 예약
  if (version >= 7) { // 버전 정보
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, bit); set(b, a, bit);
    }
  }
  return { size, m, fn };
}

function drawFormat(m, fn, mask) {
  const size = m.length;
  const data = (EC_LEVEL_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i) => ((bits >>> i) & 1) === 1;
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true); // 항상 어두운 모듈
}

function placeData(m, fn, codewords) {
  const size = m.length;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y][x] && i < codewords.length * 8) {
          m[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }
}

// 표준 벌점 규칙으로 가장 읽기 좋은 마스크 선택
function penalty(m) {
  const size = m.length;
  let p = 0;
  const lines = [];
  for (let y = 0; y < size; y++) lines.push(m[y]);
  for (let x = 0; x < size; x++) lines.push(m.map((row) => row[x]));
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else { if (run >= 5) p += run - 2; run = 1; }
    }
    const s = line.map((v) => (v ? 1 : 0)).join('');
    for (const pat of ['10111010000', '00001011101']) {
      for (let k = s.indexOf(pat); k !== -1; k = s.indexOf(pat, k + 1)) p += 40;
    }
  }
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
  }
  const dark = m.flat().filter(Boolean).length;
  p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  return p;
}

/** 텍스트 → 불리언 2차원 배열 (true = 어두운 모듈) */
export function qrMatrix(text) {
  const { version, codewords } = encodeData(new TextEncoder().encode(text));
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const { m, fn } = buildBase(version);
    placeData(m, fn, codewords);
    for (let y = 0; y < m.length; y++) for (let x = 0; x < m.length; x++)
      if (!fn[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x];
    drawFormat(m, fn, mask);
    const score = penalty(m);
    if (!best || score < best.score) best = { m, score };
  }
  return best.m;
}

/** 텍스트 → SVG 문자열 (흰 바탕 + 여백 4모듈) */
export function qrSvg(text, { dark = '#000', light = '#fff', margin = 4 } = {}) {
  const m = qrMatrix(text);
  const n = m.length + margin * 2;
  let d = '';
  m.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + margin} ${y + margin}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">`
    + `<rect width="${n}" height="${n}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
