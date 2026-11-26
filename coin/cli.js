// 지갑 CLI — 개인키는 로컬에서만 서명에 쓰이고 노드에는 서명된 거래만 보냅니다.
//   node cli.js new                       새 지갑 만들기 (wallet.json)
//   node cli.js address                   내 주소
//   node cli.js balance [주소]            잔액
//   node cli.js send <주소> <금액>        송금
//   node cli.js mine [start|stop]         노드 채굴 제어
//   NODE_URL=http://localhost:3001 (기본값)
const fs = require('fs');
const path = require('path');
const { Wallet, parseCoin, formatCoin, isValidAddress, config } = require('./src');

const NODE = process.env.NODE_URL || 'http://localhost:3001';
const FILE = process.env.WALLET_FILE || path.join(__dirname, 'wallet.json');

async function api(route, body) {
  const res = await fetch(NODE + route, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

function loadWallet() {
  if (!fs.existsSync(FILE)) throw new Error(`지갑이 없습니다. 먼저 "node cli.js new" 를 실행하세요`);
  return Wallet.fromWIF(JSON.parse(fs.readFileSync(FILE, 'utf8')).wif);
}

const commands = {
  new() {
    if (fs.existsSync(FILE)) throw new Error(`${FILE} 이 이미 있습니다 (덮어쓰지 않음)`);
    const w = Wallet.generate();
    fs.writeFileSync(FILE, JSON.stringify(w.toJSON(), null, 2), { mode: 0o600 });
    console.log(`새 지갑 생성 → ${FILE}\n주소: ${w.address}\nWIF : ${w.wif}  (절대 공유하지 마세요)`);
  },
  address() { console.log(loadWallet().address); },
  async balance(addr) {
    const b = await api('/balance/' + (addr || loadWallet().address));
    console.log(`${b.address}\n  사용 가능: ${b.spendable} ${config.TICKER}\n  미성숙   : ${b.immature} ${config.TICKER}`);
  },
  async send(to, amount) {
    if (!isValidAddress(to)) throw new Error('받는 주소가 올바르지 않습니다');
    const w = loadWallet();
    const utxos = (await api('/utxos/' + w.address)).map((u) => ({ ...u, value: BigInt(u.value) }));
    const tx = w.createTransaction(utxos, to, parseCoin(amount));
    const r = await api('/tx', tx.toJSON());
    console.log(`전송 완료! txid ${r.txid}\n수수료 ${formatCoin(BigInt(r.fee))} ${config.TICKER}`);
  },
  async mine(action = 'start') {
    console.log(await api('/mine/' + action, action === 'start' ? { address: loadWallet().address } : {}));
  },
  async info() { console.log(await api('/info')); },
};

const [cmd, ...args] = process.argv.slice(2);
Promise.resolve()
  .then(() => (commands[cmd] || (() => console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 8).join('\n'))))(...args))
  .catch((e) => { console.error('오류:', e.message); process.exit(1); });
