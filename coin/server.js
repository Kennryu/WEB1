// 풀노드: HTTP API + 간단한 P2P(블록/거래 전파, 최장 체인 동기화) + 채굴
//   PORT=3001 PEERS=http://localhost:3002 MINER_ADDRESS=D... node server.js
const http = require('http');
const path = require('path');
const { Blockchain, Miner, Transaction, config, formatCoin, isValidAddress, difficulty } = require('./src');

const PORT = Number(process.env.PORT || 3001);
const SELF = process.env.SELF_URL || `http://localhost:${PORT}`;
const chain = new Blockchain({ dataFile: process.env.DATA_FILE || path.join(__dirname, 'data', `chain-${PORT}.json`) });
const peers = new Set((process.env.PEERS || '').split(',').map((s) => s.trim()).filter(Boolean));
let miner = null;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2);

// ── P2P ─────────────────────────────────────────────────
async function post(url, body) {
  try {
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-peer': SELF }, body: json(body), signal: AbortSignal.timeout(5000) });
  } catch { /* 피어 오프라인 */ }
}
const broadcast = (route, body, except) => { for (const p of peers) if (p !== except) post(p + route, body); };

async function syncFrom(peer) {
  try {
    const res = await fetch(peer + '/blocks', { signal: AbortSignal.timeout(15000) });
    const blocks = await res.json();
    if (blocks.length - 1 > chain.height && chain.replaceChain(blocks)) log(`🔄 ${peer} 의 더 긴 체인으로 교체 → 높이 ${chain.height}`);
  } catch (e) { log(`동기화 실패 (${peer}): ${e.message}`); }
}

chain.on('block', (b) => log(`📦 블록 #${b.height} ${b.hash.slice(0, 16)}… 거래 ${b.transactions.length}개, 난이도 ${difficulty(b.bits)}`));

// ── HTTP API ────────────────────────────────────────────
const routes = {
  'GET /info': () => ({
    name: config.NAME, ticker: config.TICKER, height: chain.height, tip: chain.tip.hash,
    difficulty: difficulty(chain.tip.bits), nextBits: '0x' + chain.nextBits().toString(16),
    blockTime: config.BLOCK_TIME, mempool: chain.mempool.size, peers: [...peers],
    mining: !!miner?.running, hashrate: miner?.hashrate ?? 0, chainWork: chain.chainWork.toString(),
  }),
  'GET /blocks': () => chain.blocks.map((b) => b.toJSON()),
  'GET /block/:id': ({ id }) => chain.getBlock(id)?.toJSON() ?? { status: 404, error: '블록 없음' },
  'GET /tx/:txid': ({ txid }) => chain.findTx(txid) ?? { status: 404, error: '거래 없음' },
  'GET /mempool': () => [...chain.mempool.values()].map((t) => t.toJSON()),
  'GET /balance/:address': ({ address }) => {
    const b = chain.getBalance(address);
    return { address, spendable: formatCoin(b.spendable), immature: formatCoin(b.immature), total: formatCoin(b.total) };
  },
  // 지갑(CLI)이 서명에 쓸 UTXO: 성숙했고 멤풀에서 아직 쓰이지 않은 것 (미확인 잔돈 포함)
  'GET /utxos/:address': ({ address }) =>
    chain.getUtxos(address, { includeMempool: true }).filter((u) => chain.isMature(u)).map((u) => ({ ...u, value: u.value.toString() })),
  'GET /peers': () => [...peers],

  'POST /tx': (_, body, peer) => {
    const r = chain.addToMempool(Transaction.fromJSON(body));
    log(`💸 새 거래 ${r.txid.slice(0, 16)}… 수수료 ${formatCoin(r.fee)} ${config.TICKER}`);
    broadcast('/tx', body, peer);
    return r;
  },
  'POST /block': async (_, body, peer) => {
    if (chain.getBlock(body.hash)) return { ok: true, known: true };
    if (body.prevHash === chain.tip.hash) {
      chain.addBlock(body);
      broadcast('/block', body, peer);
      return { ok: true };
    }
    if (body.height > chain.height && peer) await syncFrom(peer); // 모르는 분기 → 전체 체인 요청
    return { ok: true, synced: true };
  },
  'POST /peers': (_, body) => {
    if (body.url && body.url !== SELF && !peers.has(body.url)) { peers.add(body.url); log(`🤝 피어 추가 ${body.url}`); syncFrom(body.url); }
    return [...peers];
  },
  'POST /mine/start': (_, body) => {
    const address = body.address || process.env.MINER_ADDRESS;
    if (!isValidAddress(address)) throw new Error('채굴 보상을 받을 올바른 주소가 필요합니다');
    miner?.stop();
    miner = new Miner(chain, address);
    miner.on('mined', (b) => { log(`⛏️  채굴 성공! #${b.height} 보상 ${formatCoin(b.transactions[0].totalOut())} ${config.TICKER}`); broadcast('/block', b.toJSON()); });
    miner.on('error', (e) => log('채굴 블록 거부:', e.message));
    miner.start();
    log(`⛏️  채굴 시작 → ${address}`);
    return { mining: true, address };
  },
  'POST /mine/stop': () => { miner?.stop(); return { mining: false }; },
};

function match(method, url) {
  for (const [key, fn] of Object.entries(routes)) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const names = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)')) + '$');
    const hit = url.match(re);
    if (hit) return { fn, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(hit[i + 1])])) };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const route = match(req.method, url);
  let status = 200, out;
  try {
    if (!route) { status = 404; out = { error: '없는 경로' }; }
    else {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 50e6) throw new Error('요청이 너무 큼'); }
      out = await route.fn(route.params, raw ? JSON.parse(raw) : {}, req.headers['x-peer']);
      if (out?.status) { status = out.status; delete out.status; }
    }
  } catch (e) { status = 400; out = { error: e.message }; }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(json(out));
});

server.listen(PORT, async () => {
  log(`🐕 ${config.NAME} 노드 시작 ${SELF} (높이 ${chain.height}, 목표 블록시간 ${config.BLOCK_TIME}초)`);
  for (const p of peers) { await post(p + '/peers', { url: SELF }); await syncFrom(p); }
  if (process.env.MINER_ADDRESS) routes['POST /mine/start']({}, {});
});
