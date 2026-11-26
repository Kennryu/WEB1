// UTXO 기반 거래 (비트코인/도지코인과 같은 모델)
const { sha256d, sign, verify } = require('./crypto');
const config = require('./config');

const NULL_TXID = '0'.repeat(64);
const COINBASE_VOUT = 0xffffffff;

class Transaction {
  /**
   * inputs : [{ txid, vout, pubKey, signature }]  (코인베이스는 { txid: 0…0, vout: 0xffffffff, coinbase })
   * outputs: [{ value: BigInt(koinu), address }]
   */
  constructor({ version = 1, inputs = [], outputs = [], lockTime = 0 } = {}) {
    this.version = version;
    this.inputs = inputs.map((i) => ({ ...i }));
    this.outputs = outputs.map((o) => ({ value: BigInt(o.value), address: o.address }));
    this.lockTime = lockTime;
  }

  // 결정적 직렬화. stripSigs=true이면 서명을 비운 형태(서명 대상 메시지용)
  serialize(stripSigs = false) {
    return JSON.stringify({
      v: this.version,
      in: this.inputs.map((i) =>
        i.coinbase !== undefined
          ? { txid: i.txid, vout: i.vout, coinbase: i.coinbase }
          : { txid: i.txid, vout: i.vout, pubKey: i.pubKey, sig: stripSigs ? '' : i.signature || '' }
      ),
      out: this.outputs.map((o) => ({ value: o.value.toString(), address: o.address })),
      lock: this.lockTime,
    });
  }

  get txid() {
    return sha256d(Buffer.from(this.serialize())).toString('hex');
  }

  get size() {
    return Buffer.byteLength(this.serialize());
  }

  isCoinbase() {
    return this.inputs.length === 1 && this.inputs[0].txid === NULL_TXID && this.inputs[0].vout === COINBASE_VOUT;
  }

  totalOut() {
    return this.outputs.reduce((s, o) => s + o.value, 0n);
  }

  // 입력별 서명 해시 (SIGHASH_ALL과 비슷: 서명 제외 전체 거래 + 입력 인덱스)
  sighash(index) {
    return sha256d(Buffer.from(this.serialize(true) + ':' + index));
  }

  signInput(index, wallet) {
    this.inputs[index].pubKey = wallet.publicKey.toString('hex');
    this.inputs[index].signature = sign(wallet.privateKey, this.sighash(index)).toString('hex');
  }

  verifyInput(index) {
    const i = this.inputs[index];
    if (!i.pubKey || !i.signature) return false;
    return verify(Buffer.from(i.pubKey, 'hex'), this.sighash(index), Buffer.from(i.signature, 'hex'));
  }

  // 최소 수수료: 시작된 kB마다 MIN_FEE_PER_KB (도지코인의 kB 단위 수수료 방식)
  static minFee(size) {
    return BigInt(Math.ceil(size / 1000)) * config.MIN_FEE_PER_KB;
  }

  static coinbase(height, address, value, extra = '') {
    return new Transaction({
      inputs: [{ txid: NULL_TXID, vout: COINBASE_VOUT, coinbase: `height:${height}${extra ? ':' + extra : ''}` }],
      outputs: [{ value, address }],
    });
  }

  toJSON() {
    return {
      txid: this.txid,
      version: this.version,
      inputs: this.inputs,
      outputs: this.outputs.map((o) => ({ value: o.value.toString(), address: o.address })),
      lockTime: this.lockTime,
    };
  }

  static fromJSON(j) {
    return new Transaction(j);
  }
}

module.exports = { Transaction, NULL_TXID, COINBASE_VOUT };
