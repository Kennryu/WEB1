// 코인 설정 — 도지코인 메인넷 값을 기본으로 사용합니다.
// 이름/티커/주소 버전 등을 바꾸면 나만의 코인이 됩니다.
const env = process.env;
const COIN = 100_000_000n; // 1 코인 = 1억 koinu (도지코인의 최소 단위 이름)

module.exports = {
  NAME: env.COIN_NAME || 'WowCoin',
  TICKER: env.COIN_TICKER || 'WOW',
  COIN,

  // ── 블록 생성 ────────────────────────────────────────────
  BLOCK_TIME: Number(env.BLOCK_TIME || 60), // 목표 블록 간격(초). 도지코인 = 1분

  // ── 발행량(보상) 스케줄 ───────────────────────────────────
  // 'dogecoin' : 도지코인 실제 스케줄 (초기 랜덤 보상 → 반감 → 600,000블록부터 10,000 고정)
  // 'fixed'    : 처음부터 블록당 10,000 고정 (무한 발행)
  REWARD_SCHEDULE: env.REWARD_SCHEDULE || 'dogecoin',
  FIXED_REWARD: 10_000n * COIN,

  // ── 작업증명(Scrypt) ─────────────────────────────────────
  // 도지코인/라이트코인과 같은 scrypt(N=1024, r=1, p=1, 32바이트)
  SCRYPT: { N: 1024, r: 1, p: 1, keylen: 32 },
  // 난이도 하한(가장 쉬운 난이도). 데모용으로 메인넷(0x1e0fffff)보다 쉽게 잡음
  POW_LIMIT_BITS: Number(env.POW_LIMIT_BITS || 0x1f0fffff),

  // ── 주소/키 ───────────────────────────────────────────────
  ADDRESS_VERSION: 0x1e, // P2PKH 주소 버전 → 'D'로 시작 (도지코인과 동일)
  WIF_VERSION: 0x9e,     // 개인키 WIF 버전 (도지코인과 동일)

  // ── 거래 규칙 ─────────────────────────────────────────────
  COINBASE_MATURITY: Number(env.COINBASE_MATURITY || 240), // 채굴 보상 사용 가능까지 필요한 확인 수
  MIN_FEE_PER_KB: COIN / 100n, // 0.01 코인 / kB (도지코인 권장 수수료)
  DUST_LIMIT: COIN / 100n,     // 0.01 코인 미만 출력 금지
  MAX_FUTURE_BLOCK_TIME: 2 * 60 * 60, // 2시간
  MAX_BLOCK_TXS: 2000,

  GENESIS: {
    time: 1386325540, // 도지코인 제네시스 블록 시각 (2013-12-06)
    message: 'Nintondo - Wow, such coin. Very JavaScript.',
    reward: 88n * COIN, // 도지코인 제네시스 보상 88 DOGE (사용 불가)
  },
};
