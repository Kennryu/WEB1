// 체인 상태: 블록 목록, UTXO 집합, 멤풀, 검증 규칙
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const config = require('./config');
const { Block } = require('./block');
const { Transaction } = require('./transaction');
const { pubKeyToAddress, isValidAddress } = require('./crypto');
const { getBlockSubsidy, digiShieldNextBits } = require('./consensus');
const { blockWork, now } = require('./utils');

const outKey = (txid, vout) => `${txid}:${vout}`;

// 기존 UTXO 집합 위에 변경 사항을 겹쳐 두는 뷰 (검증이 끝나면 commit)
class UTXOView {
  constructor(base) { this.base = base; this.added = new Map(); this.spent = new Set(); }
  get(k) { if (this.spent.has(k)) return undefined; return this.added.get(k) ?? this.base.get(k); }
  spend(k) { if (this.added.has(k)) this.added.delete(k); else this.spent.add(k); }
  add(k, v) { this.added.set(k, v); }
  commit() {
    for (const k of this.spent) this.base.delete(k);
    for (const [k, v] of this.added) this.base.set(k, v);
  }
  // 거래 하나를 적용 (입력 소비 + 출력 생성)
  applyTx(tx, height) {
    if (!tx.isCoinbase()) for (const i of tx.inputs) this.spend(outKey(i.txid, i.vout));
    const txid = tx.txid;
    tx.outputs.forEach((o, vout) =>
      this.add(outKey(txid, vout), { txid, vout, value: o.value, address: o.address, height, coinbase: tx.isCoinbase() })
    );
  }
}

let GENESIS = null;
function genesisBlock() {
  if (GENESIS) return GENESIS;
  const g = config.GENESIS;
  const burn = pubKeyToAddress(Buffer.alloc(33)); // 아무도 쓸 수 없는 주소
  const cb = Transaction.coinbase(0, burn, g.reward, g.message);
  const block = new Block({ prevHash: '0'.repeat(64), time: g.time, bits: config.POW_LIMIT_BITS, height: 0, transactions: [cb] });
  while (!block.checkProofOfWork()) block.nonce++; // 결정적이므로 모든 노드가 같은 제네시스를 얻음
  return (GENESIS = block);
}

class Blockchain extends EventEmitter {
  constructor({ dataFile = null } = {}) {
    super();
    this.dataFile = dataFile;
    this.blocks = [];
    this.utxo = new Map();
    this.mempool = new Map(); // txid → Transaction (도착 순서 = 의존 순서)
    this.chainWork = 0n;
    this._connectGenesis();
    if (dataFile && fs.existsSync(dataFile)) this._load();
  }

  _connectGenesis() {
    const g = genesisBlock();
    this.blocks = [g];
    this.utxo = new Map(); // 비트코인/도지코인처럼 제네시스 보상은 UTXO에 넣지 않음
    this.chainWork = blockWork(g.bits);
  }

  get tip() { return this.blocks[this.blocks.length - 1]; }
  get height() { return this.tip.height; }

  // 최근 11개 블록 시각의 중앙값
  medianTimePast() {
    const times = this.blocks.slice(-11).map((b) => b.time).sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)];
  }

  nextBits() {
    return digiShieldNextBits(this.tip, this.blocks[this.blocks.length - 2]);
  }

  // ── 거래 검증 ───────────────────────────────────────────
  // 성공 시 수수료(BigInt) 반환, 실패 시 예외
  validateTx(tx, view, height) {
    if (tx.isCoinbase()) throw new Error('코인베이스는 블록 첫 거래로만 허용');
    if (!tx.inputs.length || !tx.outputs.length) throw new Error('입력/출력이 비어 있음');

    for (const o of tx.outputs) {
      if (typeof o.value !== 'bigint' || o.value < config.DUST_LIMIT) throw new Error('더스트 이하 출력');
      if (!isValidAddress(o.address)) throw new Error(`잘못된 주소: ${o.address}`);
    }

    const seen = new Set();
    let totalIn = 0n;
    tx.inputs.forEach((input, idx) => {
      const k = outKey(input.txid, input.vout);
      if (seen.has(k)) throw new Error('같은 입력을 두 번 사용');
      seen.add(k);

      const prev = view.get(k);
      if (!prev) throw new Error(`존재하지 않거나 이미 사용된 출력: ${k}`);
      if (prev.coinbase && height - prev.height < config.COINBASE_MATURITY)
        throw new Error(`채굴 보상이 아직 성숙하지 않음 (${height - prev.height}/${config.COINBASE_MATURITY})`);

      // P2PKH: 공개키의 hash160 이 주소와 일치 + 서명 검증
      if (!input.pubKey || pubKeyToAddress(Buffer.from(input.pubKey, 'hex')) !== prev.address)
        throw new Error('공개키가 출력 주소와 일치하지 않음');
      if (!tx.verifyInput(idx)) throw new Error(`서명 검증 실패 (입력 ${idx})`);
      totalIn += prev.value;
    });

    const fee = totalIn - tx.totalOut();
    if (fee < 0n) throw new Error('출력 합계가 입력 합계보다 큼');
    if (fee < Transaction.minFee(tx.size)) throw new Error('수수료 부족');
    return fee;
  }

  // ── 블록 검증 ───────────────────────────────────────────
  validateBlock(block) {
    const tip = this.tip;
    if (block.prevHash !== tip.hash) throw new Error('이전 블록 해시 불일치');
    if (block.height !== tip.height + 1) throw new Error('높이 불일치');
    if (block.bits !== this.nextBits()) throw new Error('난이도(bits) 불일치');
    if (block.time <= this.medianTimePast()) throw new Error('블록 시각이 중앙 시각보다 이름');
    if (block.time > now() + config.MAX_FUTURE_BLOCK_TIME) throw new Error('블록 시각이 너무 미래');
    if (!block.checkProofOfWork()) throw new Error('작업증명 실패');
    if (block.merkleRoot !== Block.merkleRoot(block.transactions)) throw new Error('머클 루트 불일치');

    const txs = block.transactions;
    if (!txs.length || !txs[0].isCoinbase()) throw new Error('첫 거래는 코인베이스여야 함');
    if (txs.length > config.MAX_BLOCK_TXS) throw new Error('거래가 너무 많음');
    const cb = txs[0];
    if (!cb.inputs[0].coinbase.startsWith(`height:${block.height}`)) throw new Error('코인베이스 높이 표기 오류');
    for (const o of cb.outputs) if (!isValidAddress(o.address)) throw new Error('코인베이스 주소 오류');

    const view = new UTXOView(this.utxo);
    const ids = new Set();
    let fees = 0n;
    for (const tx of txs) {
      if (ids.has(tx.txid)) throw new Error('중복 거래');
      ids.add(tx.txid);
    }
    view.applyTx(cb, block.height);
    for (const tx of txs.slice(1)) {
      fees += this.validateTx(tx, view, block.height);
      view.applyTx(tx, block.height);
    }

    const maxReward = getBlockSubsidy(block.height, block.prevHash) + fees;
    if (cb.totalOut() > maxReward) throw new Error('코인베이스 보상 초과');
    return view;
  }

  addBlock(block, { save = true } = {}) {
    if (!(block instanceof Block)) block = Block.fromJSON(block);
    const view = this.validateBlock(block);
    view.commit();
    this.blocks.push(block);
    this.chainWork += blockWork(block.bits);
    for (const tx of block.transactions) this.mempool.delete(tx.txid);
    this._revalidateMempool();
    if (save) this.save();
    this.emit('block', block);
    return block;
  }

  // 더 많은 누적 작업량을 가진 체인으로 교체 (가장 긴 체인 규칙)
  replaceChain(blocksJson) {
    const blocks = blocksJson.map((b) => (b instanceof Block ? b : Block.fromJSON(b)));
    if (!blocks.length || blocks[0].hash !== genesisBlock().hash) throw new Error('제네시스 블록이 다름');

    const candidate = new Blockchain();
    for (const b of blocks.slice(1)) candidate.addBlock(b, { save: false });
    if (candidate.chainWork <= this.chainWork) return false;

    // 버려지는 블록의 거래와 기존 멤풀은 다시 멤풀에 넣어 봄
    const newHashes = new Set(candidate.blocks.map((b) => b.hash));
    const orphanTxs = this.blocks
      .filter((b) => !newHashes.has(b.hash))
      .flatMap((b) => b.transactions.slice(1));
    const pending = [...orphanTxs, ...this.mempool.values()];

    this.blocks = candidate.blocks;
    this.utxo = candidate.utxo;
    this.chainWork = candidate.chainWork;
    this.mempool = new Map();
    for (const tx of pending) { try { this.addToMempool(tx); } catch { /* 이미 포함됐거나 무효 */ } }
    this.save();
    this.emit('reorg', this.tip);
    this.emit('block', this.tip);
    return true;
  }

  // ── 멤풀 ───────────────────────────────────────────────
  mempoolView() {
    const view = new UTXOView(this.utxo);
    for (const tx of this.mempool.values()) view.applyTx(tx, this.height + 1);
    return view;
  }

  addToMempool(tx) {
    if (!(tx instanceof Transaction)) tx = Transaction.fromJSON(tx);
    const id = tx.txid;
    if (this.mempool.has(id)) throw new Error('이미 멤풀에 있는 거래');
    const fee = this.validateTx(tx, this.mempoolView(), this.height + 1);
    this.mempool.set(id, tx);
    this.emit('tx', tx);
    return { txid: id, fee };
  }

  _revalidateMempool() {
    const old = [...this.mempool.values()];
    this.mempool = new Map();
    for (const tx of old) {
      try { this.validateTx(tx, this.mempoolView(), this.height + 1); this.mempool.set(tx.txid, tx); } catch { /* 제거 */ }
    }
  }

  // ── 조회 ───────────────────────────────────────────────
  getUtxos(address, { includeMempool = false } = {}) {
    const result = [];
    if (includeMempool) {
      const view = this.mempoolView();
      const keys = new Set([...this.utxo.keys(), ...view.added.keys()]);
      for (const k of keys) { const u = view.get(k); if (u && u.address === address) result.push(u); }
    } else {
      for (const u of this.utxo.values()) if (u.address === address) result.push(u);
    }
    return result;
  }

  isMature(utxo, height = this.height + 1) {
    return !utxo.coinbase || height - utxo.height >= config.COINBASE_MATURITY;
  }

  getBalance(address) {
    let spendable = 0n, immature = 0n;
    for (const u of this.getUtxos(address)) {
      if (this.isMature(u)) spendable += u.value; else immature += u.value;
    }
    return { spendable, immature, total: spendable + immature };
  }

  getBlock(id) {
    if (/^\d+$/.test(String(id))) return this.blocks[Number(id)];
    return this.blocks.find((b) => b.hash === id);
  }

  findTx(txid) {
    for (const b of this.blocks) {
      const tx = b.transactions.find((t) => t.txid === txid);
      if (tx) return { tx, blockHash: b.hash, height: b.height, confirmations: this.height - b.height + 1 };
    }
    const m = this.mempool.get(txid);
    return m ? { tx: m, confirmations: 0 } : null;
  }

  // 주소의 거래 내역 (최신순). amount = 받은 금액 − 보낸 금액
  getHistory(address, limit = 50) {
    const outputs = new Map(); // txid → outputs (입력의 원래 주인을 찾기 위해)
    const entries = [];
    const visit = (tx, block) => {
      const id = tx.txid;
      outputs.set(id, tx.outputs);
      const received = tx.outputs.filter((o) => o.address === address).reduce((s, o) => s + o.value, 0n);
      let sent = 0n;
      if (!tx.isCoinbase()) {
        for (const i of tx.inputs) {
          const o = outputs.get(i.txid)?.[i.vout];
          if (o && o.address === address) sent += o.value;
        }
      }
      if (received === 0n && sent === 0n) return;
      const others = tx.outputs.filter((o) => o.address !== address).map((o) => o.address);
      entries.push({
        txid: id,
        type: tx.isCoinbase() ? 'mined' : sent > 0n ? 'sent' : 'received',
        amount: received - sent,
        counterparty: sent > 0n ? others[0] ?? address : null,
        height: block ? block.height : null,
        time: block ? block.time : null,
        confirmations: block ? this.height - block.height + 1 : 0,
        mature: !tx.isCoinbase() || (block && this.height + 1 - block.height >= config.COINBASE_MATURITY),
      });
    };
    for (const b of this.blocks.slice(1)) for (const tx of b.transactions) visit(tx, b);
    for (const tx of this.mempool.values()) visit(tx, null);
    return entries.reverse().slice(0, limit);
  }

  // ── 저장/불러오기 ───────────────────────────────────────
  save() {
    if (!this.dataFile) return;
    fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
    const tmp = this.dataFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.blocks.map((b) => b.toJSON())));
    fs.renameSync(tmp, this.dataFile);
  }

  _load() {
    const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
    if (data[0].hash !== genesisBlock().hash) throw new Error('저장된 체인의 제네시스가 현재 설정과 다릅니다');
    for (const b of data.slice(1)) this.addBlock(b, { save: false }); // 전부 재검증하며 UTXO 재구성
  }
}

module.exports = { Blockchain, UTXOView, genesisBlock, outKey };
