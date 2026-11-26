// 블록 헤더(80바이트, 비트코인/도지코인과 같은 레이아웃)와 블록
const { sha256d, scryptHash, hashToBigInt } = require('./crypto');
const { Transaction } = require('./transaction');
const { bitsToTarget } = require('./utils');

class Block {
  constructor({ version = 1, prevHash, merkleRoot, time, bits, nonce = 0, height, transactions = [] }) {
    this.version = version;
    this.prevHash = prevHash;
    this.time = time;
    this.bits = bits;
    this.nonce = nonce;
    this.height = height;
    this.transactions = transactions.map((t) => (t instanceof Transaction ? t : Transaction.fromJSON(t)));
    this.merkleRoot = merkleRoot || Block.merkleRoot(this.transactions);
  }

  header() {
    const b = Buffer.alloc(80);
    b.writeInt32LE(this.version, 0);
    Buffer.from(this.prevHash, 'hex').reverse().copy(b, 4);
    Buffer.from(this.merkleRoot, 'hex').reverse().copy(b, 36);
    b.writeUInt32LE(this.time >>> 0, 68);
    b.writeUInt32LE(this.bits >>> 0, 72);
    b.writeUInt32LE(this.nonce >>> 0, 76);
    return b;
  }

  // 블록 ID = SHA256d(header)  /  작업증명 = scrypt(header)  ← 도지코인 방식
  get hash() {
    return Buffer.from(sha256d(this.header())).reverse().toString('hex');
  }

  powHash() {
    return scryptHash(this.header());
  }

  checkProofOfWork() {
    return hashToBigInt(this.powHash()) <= bitsToTarget(this.bits);
  }

  static merkleRoot(transactions) {
    if (transactions.length === 0) return '0'.repeat(64);
    let level = transactions.map((t) => Buffer.from(t.txid, 'hex'));
    while (level.length > 1) {
      if (level.length % 2) level.push(level[level.length - 1]);
      const next = [];
      for (let i = 0; i < level.length; i += 2) next.push(sha256d(Buffer.concat([level[i], level[i + 1]])));
      level = next;
    }
    return level[0].toString('hex');
  }

  toJSON() {
    return {
      hash: this.hash,
      height: this.height,
      version: this.version,
      prevHash: this.prevHash,
      merkleRoot: this.merkleRoot,
      time: this.time,
      bits: this.bits,
      nonce: this.nonce,
      transactions: this.transactions.map((t) => t.toJSON()),
    };
  }

  static fromJSON(j) {
    return new Block(j);
  }
}

module.exports = { Block };
