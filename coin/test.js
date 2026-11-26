// node test.js — 핵심 규칙 검증
process.env.COINBASE_MATURITY = '2';
process.env.BLOCK_TIME = '60';
const test = require('node:test');
const assert = require('node:assert');
const {
  Blockchain, Miner, Wallet, Transaction, Block, config, parseCoin, formatCoin,
  getBlockSubsidy, digiShieldNextBits, bitsToTarget, targetToBits, isValidAddress, sign, verify, generatePrivateKey, getPublicKey,
} = require('./src');

test('주소는 D로 시작하고 WIF 왕복이 된다', () => {
  const w = Wallet.generate();
  assert.match(w.address, /^D/);
  assert.ok(isValidAddress(w.address));
  assert.strictEqual(Wallet.fromWIF(w.wif).address, w.address);
  assert.ok(!isValidAddress(w.address.slice(0, -1) + (w.address.endsWith('a') ? 'b' : 'a')));
});

test('ECDSA 서명/검증', () => {
  const k = generatePrivateKey();
  const msg = Buffer.from('much wow');
  const sig = sign(k, msg);
  assert.ok(verify(getPublicKey(k), msg, sig));
  assert.ok(!verify(getPublicKey(k), Buffer.from('such fail'), sig));
});

test('bits ↔ target 변환', () => {
  for (const b of [0x1e0fffff, 0x1f0fffff, 0x1d00ffff, 0x1b0404cb]) assert.strictEqual(targetToBits(bitsToTarget(b)), b);
});

test('금액 파싱/표시', () => {
  assert.strictEqual(parseCoin('12.5'), 1_250_000_000n);
  assert.strictEqual(formatCoin(1_250_000_000n), '12.5');
});

test('도지코인 보상 스케줄', () => {
  const h = 'ab'.repeat(32);
  const r = getBlockSubsidy(50, h);
  assert.ok(r >= config.COIN && r <= 1_000_000n * config.COIN);
  assert.strictEqual(getBlockSubsidy(50, h), r, '같은 이전 해시 → 같은 보상');
  assert.strictEqual(getBlockSubsidy(150_000, h), 250_000n * config.COIN);
  assert.strictEqual(getBlockSubsidy(550_000, h), 15_625n * config.COIN);
  assert.strictEqual(getBlockSubsidy(600_000, h), 10_000n * config.COIN);
  assert.strictEqual(getBlockSubsidy(99_000_000, h), 10_000n * config.COIN);
});

test('DigiShield: 빠르면 어려워지고 느리면 쉬워진다 (폭 제한)', () => {
  const bits = 0x1e0fffff;
  const T = config.BLOCK_TIME;
  const tgt = (dt) => bitsToTarget(digiShieldNextBits({ time: 1000 + dt, bits }, { time: 1000, bits }));
  const base = bitsToTarget(bits);
  assert.ok(tgt(1) < base);         // 빠른 블록 → 목표값 감소(난이도 상승)
  assert.ok(tgt(T * 5) > base);     // 느린 블록 → 난이도 하락
  assert.ok(tgt(0) >= (base * 74n) / 100n);   // 최대 -25%
  assert.ok(tgt(T * 100) <= (base * 151n) / 100n); // 최대 +50%
});

test('채굴 → 성숙 → 송금 → 잔액', () => {
  const chain = new Blockchain();
  const alice = Wallet.generate(), bob = Wallet.generate();
  const miner = new Miner(chain, alice.address);
  for (let i = 0; i < 3; i++) miner.mineBlockSync();
  assert.strictEqual(chain.height, 3);

  const before = chain.getBalance(alice.address);
  assert.ok(before.spendable > 0n && before.immature > 0n);

  const utxos = chain.getUtxos(alice.address, { includeMempool: true }).filter((u) => chain.isMature(u));
  const tx = alice.createTransaction(utxos, bob.address, parseCoin('1000'));
  chain.addToMempool(tx);
  assert.throws(() => chain.addToMempool(tx), /이미/);

  // 같은 UTXO 를 이중 사용하는 거래는 거부
  const dbl = alice.createTransaction(utxos, bob.address, parseCoin('5'));
  assert.throws(() => chain.addToMempool(dbl), /이미 사용된|존재하지/);

  new Miner(chain, bob.address).mineBlockSync();
  assert.strictEqual(chain.getBalance(bob.address).spendable, parseCoin('1000'));
  assert.strictEqual(chain.mempool.size, 0);
});

test('위조 서명, 미성숙 보상, 보상 초과는 거부', () => {
  const chain = new Blockchain();
  const alice = Wallet.generate(), mallory = Wallet.generate();
  const miner = new Miner(chain, alice.address);
  miner.mineBlockSync();

  // 미성숙 코인베이스 사용
  const u = chain.getUtxos(alice.address);
  assert.throws(() => chain.addToMempool(alice.createTransaction(u, mallory.address, parseCoin('1'))), /성숙/);

  miner.mineBlockSync(); miner.mineBlockSync();
  // 남의 UTXO 를 내 키로 서명
  const stolen = mallory.createTransaction(chain.getUtxos(alice.address).filter((x) => chain.isMature(x)), mallory.address, parseCoin('1'));
  assert.throws(() => chain.addToMempool(stolen), /공개키/);

  // 코인베이스 보상 부풀리기
  const b = miner.createTemplate();
  b.transactions[0].outputs[0].value += 1n;
  b.merkleRoot = Block.merkleRoot(b.transactions);
  while (!b.checkProofOfWork()) b.nonce++;
  assert.throws(() => chain.addBlock(b), /보상 초과/);
});

test('더 많은 작업량의 체인으로 재조직(reorg)', () => {
  const a = new Blockchain(), b = new Blockchain();
  const w = Wallet.generate();
  new Miner(a, w.address).mineBlockSync();
  const mb = new Miner(b, w.address);
  mb.mineBlockSync(); mb.mineBlockSync();
  assert.ok(a.replaceChain(b.blocks));
  assert.strictEqual(a.height, 2);
  assert.strictEqual(a.tip.hash, b.tip.hash);
  assert.ok(!b.replaceChain(a.blocks.slice(0, 2)));
});

test('웹 지갑(public/wallet-lib.js)이 만든 거래를 노드가 받아들인다', async () => {
  const L = await import('./public/wallet-lib.js');
  const nodeCrypto = require('crypto');
  for (const n of [0, 55, 56, 64, 200]) {
    const m = nodeCrypto.randomBytes(n);
    assert.strictEqual(L.toHex(L.sha256(m)), nodeCrypto.createHash('sha256').update(m).digest('hex'));
    assert.strictEqual(L.toHex(L.ripemd160(m)), nodeCrypto.createHash('ripemd160').update(m).digest('hex'));
  }
  const chain = new Blockchain();
  const web = L.Wallet.generate();
  assert.strictEqual(Wallet.fromWIF(web.wif).address, web.address);
  const miner = new Miner(chain, web.address);
  for (let i = 0; i < 3; i++) miner.mineBlockSync();
  const bob = Wallet.generate();
  const utxos = chain.getUtxos(web.address, { includeMempool: true }).filter((u) => chain.isMature(u));
  const r = L.createTransaction(web, utxos, bob.address, parseCoin('321.5'));
  const { txid } = chain.addToMempool(Transaction.fromJSON(r.json));
  assert.strictEqual(txid, r.txid);
  new Miner(chain, bob.address).mineBlockSync();
  assert.strictEqual(chain.getBalance(bob.address).spendable, parseCoin('321.5'));
});
