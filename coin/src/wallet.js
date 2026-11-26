// 지갑: secp256k1 키쌍, 'D'로 시작하는 주소, 거래 생성/서명
const config = require('./config');
const { generatePrivateKey, getPublicKey, pubKeyToAddress, privateKeyToWIF, wifToPrivateKey } = require('./crypto');
const { Transaction } = require('./transaction');

class Wallet {
  constructor(privateKey) {
    this.privateKey = Buffer.from(privateKey);
    this.publicKey = getPublicKey(this.privateKey, true);
    this.address = pubKeyToAddress(this.publicKey);
  }

  static generate() { return new Wallet(generatePrivateKey()); }
  static fromWIF(wif) { return new Wallet(wifToPrivateKey(wif)); }
  get wif() { return privateKeyToWIF(this.privateKey); }

  /**
   * 보낼 거래를 만들고 서명합니다.
   * utxos: 사용 가능한 UTXO 목록 [{ txid, vout, value }] (성숙/미사용 확인된 것)
   * fee 를 생략하면 거래 크기에 맞는 최소 수수료를 자동 계산합니다.
   */
  createTransaction(utxos, toAddress, amount, { fee } = {}) {
    amount = BigInt(amount);
    if (amount < config.DUST_LIMIT) throw new Error('송금액이 더스트 한도보다 작습니다');
    const sorted = [...utxos].sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));

    let curFee = fee !== undefined ? BigInt(fee) : config.MIN_FEE_PER_KB;
    for (let attempt = 0; attempt < 10; attempt++) {
      const selected = [];
      let total = 0n;
      for (const u of sorted) {
        if (total >= amount + curFee) break;
        selected.push(u); total += u.value;
      }
      if (total < amount + curFee) throw new Error('잔액이 부족합니다');

      const outputs = [{ value: amount, address: toAddress }];
      const change = total - amount - curFee;
      if (change >= config.DUST_LIMIT) outputs.push({ value: change, address: this.address }); // 잔돈은 나에게

      const tx = new Transaction({ inputs: selected.map((u) => ({ txid: u.txid, vout: u.vout })), outputs });
      tx.inputs.forEach((_, i) => tx.signInput(i, this));

      if (fee !== undefined) return tx;
      const need = Transaction.minFee(tx.size);
      if (need <= curFee) return tx;
      curFee = need; // 크기가 커져서 수수료가 더 필요 → 다시 계산
    }
    throw new Error('수수료 계산 실패');
  }

  toJSON() { return { address: this.address, wif: this.wif, publicKey: this.publicKey.toString('hex') }; }
}

module.exports = { Wallet };
