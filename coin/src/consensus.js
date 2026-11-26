// 도지코인 합의 규칙: 블록 보상 스케줄 + DigiShield 난이도 조정
const config = require('./config');
const { sha256 } = require('./crypto');
const { bitsToTarget, targetToBits } = require('./utils');

const C = config.COIN;

/**
 * 도지코인 블록 보상 스케줄
 *   1 ~ 99,999        : 0 ~ 1,000,000 랜덤 (이전 블록 해시로 시드)
 *   100,000 ~ 144,999 : 0 ~   500,000 랜덤
 *   145,000 ~ 199,999 : 250,000
 *   200,000 ~ 299,999 : 125,000
 *   300,000 ~ 399,999 :  62,500
 *   400,000 ~ 499,999 :  31,250
 *   500,000 ~ 599,999 :  15,625
 *   600,000 ~         :  10,000 고정 (영원히 — 상한 없는 인플레이션 코인)
 */
function getBlockSubsidy(height, prevHash) {
  if (config.REWARD_SCHEDULE === 'fixed') return config.FIXED_REWARD;

  if (height < 145_000) {
    const max = height < 100_000 ? 1_000_000n : 500_000n;
    // 도지코인 1.x: 이전 블록 해시를 시드로 한 난수 → 1 ~ max 코인
    const r = BigInt('0x' + sha256(Buffer.from(prevHash, 'hex')).toString('hex'));
    return (1n + (r % max)) * C;
  }
  if (height < 200_000) return 250_000n * C;
  if (height < 300_000) return 125_000n * C;
  if (height < 400_000) return 62_500n * C;
  if (height < 500_000) return 31_250n * C;
  if (height < 600_000) return 15_625n * C;
  return config.FIXED_REWARD;
}

/**
 * DigiShield v3 (도지코인 145,000 블록부터 사용)
 * - 매 블록마다 난이도 재조정
 * - 실제 간격과 목표 간격의 차이를 1/8만 반영 (진동 완화)
 * - 한 번에 조정 폭을 [-25%, +50%] 로 제한
 */
function digiShieldNextBits(lastBlock, prevBlock) {
  const powLimit = bitsToTarget(config.POW_LIMIT_BITS);
  if (!prevBlock) return config.POW_LIMIT_BITS;

  const T = BigInt(config.BLOCK_TIME);
  const actual = BigInt(lastBlock.time - prevBlock.time);

  let modulated = T + (actual - T) / 8n;
  const min = T - T / 4n;
  const max = T + T / 2n;
  if (modulated < min) modulated = min;
  if (modulated > max) modulated = max;

  let target = (bitsToTarget(lastBlock.bits) * modulated) / T;
  if (target > powLimit) target = powLimit;
  return targetToBits(target);
}

// 난이도 숫자 (1 = 가장 쉬운 난이도 대비 배수)
const difficulty = (bits) =>
  Number((bitsToTarget(config.POW_LIMIT_BITS) * 1000n) / bitsToTarget(bits)) / 1000;

module.exports = { getBlockSubsidy, digiShieldNextBits, difficulty };
