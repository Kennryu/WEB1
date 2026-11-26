// Scrypt 채굴기: 블록 템플릿 생성 → nonce 탐색
const EventEmitter = require('events');
const config = require('./config');
const { Block } = require('./block');
const { Transaction } = require('./transaction');
const { getBlockSubsidy } = require('./consensus');
const { UTXOView } = require('./blockchain');
const { now } = require('./utils');

class Miner extends EventEmitter {
  constructor(chain, address) {
    super();
    this.chain = chain;
    this.address = address;
    this.running = false;
    this.hashes = 0;
    this.hashrate = 0;
    this.extraNonce = 0;
  }

  // 멤풀 거래를 담은 새 블록 템플릿
  createTemplate() {
    const chain = this.chain;
    const height = chain.height + 1;
    const view = new UTXOView(chain.utxo);
    const txs = [];
    let fees = 0n;
    for (const tx of chain.mempool.values()) {
      if (txs.length >= config.MAX_BLOCK_TXS - 1) break;
      try { fees += chain.validateTx(tx, view, height); view.applyTx(tx, height); txs.push(tx); } catch { /* 건너뜀 */ }
    }
    const reward = getBlockSubsidy(height, chain.tip.hash) + fees;
    const cb = Transaction.coinbase(height, this.address, reward, `${this.extraNonce++}`);
    return new Block({
      prevHash: chain.tip.hash,
      time: Math.max(now(), chain.medianTimePast() + 1),
      bits: chain.nextBits(),
      height,
      transactions: [cb, ...txs],
    });
  }

  // 블록 하나를 동기적으로 채굴 (테스트/데모용)
  mineBlockSync() {
    let block = this.createTemplate();
    while (!block.checkProofOfWork()) {
      if (++block.nonce > 0xffffffff) block = this.createTemplate();
    }
    return this.chain.addBlock(block);
  }

  // 이벤트 루프를 막지 않도록 조금씩 나눠 채굴
  start() {
    if (this.running) return;
    this.running = true;
    let block = this.createTemplate();
    let mempoolSize = this.chain.mempool.size;
    let t0 = Date.now(), h0 = 0;

    const loop = () => {
      if (!this.running) return;
      // 팁이 바뀌었거나 새 거래가 들어오면 템플릿 갱신
      if (block.prevHash !== this.chain.tip.hash || mempoolSize !== this.chain.mempool.size) {
        block = this.createTemplate();
        mempoolSize = this.chain.mempool.size;
      }
      for (let i = 0; i < 200; i++) {
        this.hashes++; h0++;
        if (block.checkProofOfWork()) {
          try {
            this.chain.addBlock(block);
            this.emit('mined', block);
          } catch (e) {
            this.emit('error', e);
          }
          block = this.createTemplate();
          mempoolSize = this.chain.mempool.size;
          break;
        }
        if (++block.nonce > 0xffffffff) { block = this.createTemplate(); break; }
      }
      const dt = Date.now() - t0;
      if (dt > 2000) { this.hashrate = Math.round((h0 * 1000) / dt); t0 = Date.now(); h0 = 0; }
      setImmediate(loop);
    };
    setImmediate(loop);
  }

  stop() { this.running = false; }
}

module.exports = { Miner };
