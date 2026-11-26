// node demo.js — 한 프로세스 안에서 채굴·송금·난이도 조정을 보여 줍니다.
process.env.COINBASE_MATURITY ??= '3'; // 데모용 (실제 도지코인 240)
process.env.BLOCK_TIME ??= '30';       // 데모용 (실제 도지코인 60초)
const { Blockchain, Miner, Wallet, config, parseCoin, formatCoin, difficulty } = require('./src');

const chain = new Blockchain();
const alice = Wallet.generate();
const bob = Wallet.generate();
const T = config.TICKER;
console.log(`🐕 ${config.NAME} (${T}) 데모 — 목표 블록시간 ${config.BLOCK_TIME}초, 보상 성숙 ${config.COINBASE_MATURITY}블록`);
console.log(`제네시스 ${chain.tip.hash}`);
console.log(`Alice ${alice.address}\nBob   ${bob.address}\n`);

const miner = new Miner(chain, alice.address);
for (let i = 0; i < 8; i++) {
  const t = Date.now();
  const b = miner.mineBlockSync();
  console.log(`⛏️  #${b.height}  보상 ${formatCoin(b.transactions[0].totalOut()).padStart(9)} ${T}  난이도 ${difficulty(b.bits).toFixed(3)}  (${((Date.now() - t) / 1000).toFixed(1)}초)`);
}

const show = (name, w) => {
  const b = chain.getBalance(w.address);
  console.log(`  ${name}: 사용 가능 ${formatCoin(b.spendable)} ${T} / 미성숙 ${formatCoin(b.immature)} ${T}`);
};
console.log('\n잔액'); show('Alice', alice); show('Bob  ', bob);

const utxos = chain.getUtxos(alice.address, { includeMempool: true }).filter((u) => chain.isMature(u));
const tx = alice.createTransaction(utxos, bob.address, parseCoin('1234.5'));
const { txid, fee } = chain.addToMempool(tx);
console.log(`\n💸 Alice → Bob 1234.5 ${T} (txid ${txid.slice(0, 16)}…, 수수료 ${formatCoin(fee)} ${T})`);

const b = new Miner(chain, bob.address).mineBlockSync();
console.log(`⛏️  #${b.height} Bob이 채굴 — 거래 ${b.transactions.length - 1}건 포함, 수수료까지 보상으로 받음 (${formatCoin(b.transactions[0].totalOut())} ${T})`);
console.log('\n잔액'); show('Alice', alice); show('Bob  ', bob);
console.log(`\n체인 높이 ${chain.height}, 누적 작업량 ${chain.chainWork}`);
