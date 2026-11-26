# 🐕 WowCoin — 도지코인 메커니즘 자바스크립트 구현

도지코인(Dogecoin)의 핵심 규칙을 그대로 따라 만든 학습·실험용 암호화폐입니다.
**외부 라이브러리 없이** Node.js(18+) 내장 `crypto`만 사용합니다.

## 도지코인과 같은 점

| 항목 | 도지코인 | 이 구현 |
|---|---|---|
| 작업증명 | Scrypt (N=1024, r=1, p=1) | 동일 (`src/crypto.js`) |
| 블록 ID | SHA-256d(80바이트 헤더) | 동일 (`src/block.js`) |
| 블록 시간 | 1분 | 기본 60초 (`BLOCK_TIME`) |
| 난이도 조정 | DigiShield v3, 매 블록 · 1/8 감쇠 · −25%/+50% 제한 | 동일 (`src/consensus.js`) |
| 보상 | 초기 랜덤(최대 100만) → 반감 → **600,000블록부터 10,000 고정(무한 발행)** | 동일 |
| 거래 모델 | UTXO, P2PKH | 동일 (`src/transaction.js`) |
| 서명 | ECDSA secp256k1 | 동일 |
| 주소 | Base58Check, 버전 0x1E → `D…` | 동일 |
| 개인키 | WIF 버전 0x9E | 동일 |
| 채굴 보상 성숙 | 240 확인 | 기본 240 (`COINBASE_MATURITY`) |
| 수수료 | 0.01 / kB, 더스트 0.01 | 동일 |
| 제네시스 | 2013-12-06, 88 DOGE | 같은 시각/보상, 메시지만 다름 |
| 체인 선택 | 누적 작업량 최대 체인 | 동일 (reorg 지원) |

단순화한 부분: 스크립트 언어 대신 P2PKH만 지원, 거래 직렬화는 결정적 JSON,
P2P는 HTTP 기반, 머지마이닝(AuxPoW)은 없음. 난이도 하한은 데모를 위해 메인넷보다 쉽게 설정.

## 실행

```bash
cd coin
npm run demo   # 한 프로세스에서 채굴·송금·난이도 상승 보기
npm test       # 규칙 테스트

# 노드 실행
PORT=3001 node server.js
PORT=3002 PEERS=http://localhost:3001 node server.js   # 두 번째 노드

# 지갑 CLI (개인키는 로컬에서만 서명)
node cli.js new
node cli.js mine start         # 노드가 내 주소로 채굴
node cli.js balance
node cli.js send D주소 100.5
NODE_URL=http://localhost:3002 node cli.js info
```

### 👛 웹 지갑

노드를 실행하고 브라우저에서 **http://localhost:3001/** 을 열면 됩니다.

- 새 지갑 만들기 / 개인키(WIF) 가져오기
- 잔액(사용 가능 · 성숙 대기), 주소 복사
- 받기: **QR 코드** 표시, 요청 금액을 넣으면 결제 링크(`wowcoin:D주소?amount=12.5`) QR로 바뀜
- 보내기 칸에 결제 링크를 붙여 넣으면 주소·금액 자동 입력, 지원 브라우저(안드로이드 크롬 등)에서는 📷 카메라 스캔
- 보내기: 수수료 자동 계산, "최대" 버튼, 확인 단계
- 거래 내역(받음·보냄·채굴), 최근 블록, 네트워크 상태
- 채굴 켜기/끄기 (보상은 내 주소로)
- 설정: 접속할 노드 주소 변경, 개인키 백업 보기, 지갑 삭제

개인키는 브라우저 안에서만 쓰입니다. `public/wallet-lib.js`가 secp256k1 서명(RFC6979)·SHA-256·RIPEMD-160을
순수 JS로 구현해 브라우저에서 거래에 서명하고, 노드에는 서명된 거래만 보냅니다.
개인키는 localStorage에 **암호화 없이** 저장되니 학습·테스트용으로만 쓰세요.

테스트할 때는 `COINBASE_MATURITY=2 BLOCK_TIME=20` 처럼 환경변수로 낮추면 빠릅니다.

## 설정 (`src/config.js` 또는 환경변수)

`COIN_NAME`, `COIN_TICKER`, `BLOCK_TIME`, `COINBASE_MATURITY`,
`REWARD_SCHEDULE` (`dogecoin` | `fixed`), `POW_LIMIT_BITS`.
주소 버전(`ADDRESS_VERSION`)을 바꾸면 주소 앞글자가 바뀝니다.

## HTTP API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/info` | 높이, 난이도, 해시레이트 등 |
| GET | `/blocks`, `/block/:높이또는해시` | 블록 조회 |
| GET | `/tx/:txid`, `/mempool` | 거래 조회 |
| GET | `/balance/:주소`, `/utxos/:주소` | 잔액 / 사용 가능한 UTXO |
| GET | `/history/:주소`, `/recent-blocks` | 거래 내역 / 최근 블록 10개 |
| POST | `/tx` | 서명된 거래 제출 |
| POST | `/block` | (피어용) 새 블록 전파 |
| POST | `/peers` | 피어 등록 `{ "url": "http://..." }` |
| POST | `/mine/start`, `/mine/stop` | 채굴 제어 `{ "address": "D..." }` |

## 파일 구조

```
src/config.js       코인 파라미터
src/crypto.js       SHA256d, scrypt, RIPEMD160, Base58Check, ECDSA, 주소/WIF
src/consensus.js    보상 스케줄, DigiShield
src/transaction.js  UTXO 거래, 서명 해시
src/block.js        80바이트 헤더, 머클 루트, PoW 확인
src/blockchain.js   검증, UTXO 집합, 멤풀, reorg, 저장
src/wallet.js       키 생성, 코인 선택, 잔돈, 수수료 계산
src/miner.js        블록 템플릿, nonce 탐색
server.js           풀노드 + P2P + API
cli.js              지갑 CLI
public/index.html   웹 지갑 화면
public/wallet-lib.js 브라우저용 키·서명·거래 생성 (의존성 없음)
public/qr.js        QR 코드 생성기 (바이트 모드, 오류정정 M, 버전 1~10, 의존성 없음)
```

> ⚠️ 학습용 구현입니다. 실제 자산을 다루는 메인넷 용도로는 보안 감사 없이 사용하지 마세요.
