# worker-mailer テスト戦略

## 更新状況（2025年更新）

> **現在のテストファイル**: 27ファイル
> **テスト数**: 374テスト（全パス）
> **テストランナー**: Vitest + @cloudflare/vitest-pool-workers
> **実行コマンド**: `bunx vitest run`

### 現在のテストファイル構成

| ファイル | テスト対象 |
|---|---|
| auth.test.ts | SMTP認証（PLAIN/LOGIN/CRAM-MD5） |
| batch.test.ts | バッチ送信 |
| builder.test.ts | MailBuilder フルエント API |
| calendar.test.ts | iCalendar生成 + CRLFセキュリティ |
| config.test.ts | ポート・TLS設定 |
| convenience.test.ts | fromEnv / preset ヘルパー |
| dkim.test.ts | DKIM署名 |
| email.test.ts | Email構築・MIMEヘッダー |
| encoding.test.ts | Base64/QP/UTF-8 + fromBase64安全化 |
| errors.test.ts | カスタムエラー型 |
| header.test.ts | RFC 2047/5322 ヘッダーエンコーディング |
| hooks.test.ts | 送信ライフサイクルフック |
| html-to-text.test.ts | HTML→テキスト変換 |
| logger.test.ts | ログレベル + 認証情報マスク |
| mailer.test.ts | WorkerMailer接続・送信フロー |
| mime.test.ts | MIME構造 + dot-stuffing |
| mock.test.ts | MockMailer API |
| pool.test.ts | コネクションプール |
| preview.test.ts | メールプレビュー |
| queue.test.ts | BlockingQueue |
| smtputf8.test.ts | SMTPUTF8拡張 |
| template.test.ts | テンプレートエンジン |
| testing.test.ts | テストヘルパー |
| thread.test.ts | スレッドヘッダー |
| transport.test.ts | SMTPトランスポート |
| unsubscribe.test.ts | List-Unsubscribe |
| validate.test.ts | メールアドレスバリデーション |

---

## 概要

worker-mailer のテスト品質を本番利用レベルまで引き上げるための3層テスト戦略。
現状のユニットテスト（1,992行）をベースに、Workerハンドラテスト・E2Eテストを追加する。

---

## 現状分析

> **⚠️ 注意**: 以下の4ファイル構成はプロジェクト初期（2024年）の記録です。
> 現在は27ファイル・374テストに拡大しています。最新の構成は冒頭の「更新状況」を参照してください。

### テストファイル構成（初期・4ファイル時点の記録）

| ファイル | 行数 | テスト対象 | カバレッジ評価 |
|---|---|---|---|
| `test/src/email.test.ts` | 694 | `Email`クラス、`encodeHeader` | ⚠️ 中 |
| `test/src/mailer.test.ts` | 701 | `WorkerMailer`（接続・認証・送信・切断） | ⚠️ 中 |
| `test/src/utils.test.ts` | 468 | `BlockingQueue`、QP、encode/decode | ✅ 高 |
| `test/src/logger.test.ts` | 129 | `Logger` 全レベル | ✅ 十分 |

### テスト実行環境

```
vitest.config.ts
  → @cloudflare/vitest-pool-workers/config
    → test/wrangler.toml (compatibility_flags = ["nodejs_compat"])
    → test/worker.ts (Workerエントリポイント)
```

- テストは **workerd（miniflare）ランタイム内**で実行される
- `cloudflare:sockets` は `vi.mock` で完全モック
- `test/worker.ts` は `main` として設定されているが、**テストから一切呼び出されていない**

### 現状の問題（初期時点の記録）

> **⚠️ 注意**: 以下の多くは現在解決済みです。auth.test.ts（PLAIN/LOGIN/CRAM-MD5）、
> email.test.ts（CRLF インジェクション、BCC 非出力）、transport.test.ts（プロトコル異常系）等で対応済み。

1. **セキュリティテストが皆無**: P0-1〜P0-5のすべてがテストされていない → ✅ 大部分が実装済み
2. **認証フローがPLAINのみ**: LOGIN、CRAM-MD5のテストがない → ✅ auth.test.ts で全方式テスト済み
3. **プロトコル異常系が薄い**: 4xxエラー、ストリーム終了、TLS失敗のテストなし → ⚠️ 一部実装済み（ストリーム終了、5xxエラー）
4. **`test/worker.ts`が未活用**: `SELF.fetch()` による統合テストなし
5. **E2E テストなし**: 実 SMTP サーバーとの通信検証がない
6. **BCC テストがバグを保護**: L126-149 が BCC ヘッダー出力を正常動作としてアサート → ✅ 修正済み

---

## 3層テスト戦略

### 層1: ユニットテスト（既存強化）

**目的**: ロジック・エンコーディング・セキュリティの個別関数検証

**実行環境**: `vitest-pool-workers` 内（`cloudflare:sockets` はモック）

**現状**: 374テスト（27ファイル） → **目標**: セキュリティ・プロトコル異常系・E2Eの追加

#### 追加すべきテスト一覧（26項目）

##### A. セキュリティテスト（P0対応・6項目）

| ID | テスト内容 | 対象ファイル | 関連Issue | 状況 |
|---|---|---|---|---|
| A1 | `responseTimeoutMs` オプションの動作検証 | `mailer.test.ts` | P0-1 | 未実装 |
| A2 | BCC ヘッダーが `getEmailData()` 出力に**含まれない**ことの検証 | `email.test.ts` | P0-2, T1 | ✅ 実装済み（email.test.ts, header.test.ts） |
| A3 | 非Latin-1パスワード（日本語等）でのPLAIN/LOGIN認証 | `mailer.test.ts` | P0-3 | 未実装 |
| A4 | CRLF入りメールアドレスでのSMTPコマンドインジェクション | `email.test.ts` + `mailer.test.ts` | P0-4 | ✅ 実装済み（email.test.ts, calendar.test.ts） |
| A5 | CRLF入りカスタムヘッダー値でのヘッダーインジェクション | `email.test.ts` | P0-5 | ✅ 実装済み（email.test.ts） |
| A6 | クォート/CRLF入り添付ファイル名のサニタイズ | `email.test.ts` | P1-5 | ✅ 実装済み（email.test.ts: パス走査 + CRLF拒否） |

**A1: `responseTimeoutMs` テスト例**:
```typescript
it('should use responseTimeoutMs instead of socketTimeoutMs for SMTP responses', async () => {
  // サーバー接続は即座に成功するが、EHLOへの応答が遅い
  mockSocket.opened = Promise.resolve()
  mockReader.read.mockResolvedValueOnce({
    value: new TextEncoder().encode('220 ready\r\n'),
  })
  // EHLO応答が返らない（タイムアウトさせる）
  mockReader.read.mockImplementationOnce(
    () => new Promise(() => {}), // 永遠に解決しない
  )

  await expect(
    WorkerMailer.connect({
      host: 'smtp.example.com',
      port: 587,
      socketTimeoutMs: 60_000,
      responseTimeoutMs: 100, // 短いタイムアウト
    }),
  ).rejects.toThrow() // P0-1修正前: socketTimeoutMs(60s)が使われるため100msでは失敗しない
})
```

**A2: BCC 非含有テスト例**:
```typescript
it('should NOT include BCC header in email data (RFC 5322)', () => {
  const email = new Email({
    from: 'sender@example.com',
    to: 'recipient@example.com',
    bcc: 'secret@example.com',
    subject: 'Test',
    text: 'Hello',
  })
  const data = email.getEmailData()
  // BCCヘッダーが出力されないことを検証
  expect(data).not.toContain('BCC:')
  expect(data).not.toContain('Bcc:')
  expect(data).not.toContain('bcc:')
  // ただしBCCアドレスはRCPT TOで使うため、email.bccには保持
  expect(email.bcc).toEqual([{ email: 'secret@example.com' }])
})
```

**A4: SMTPコマンドインジェクション テスト例**:
```typescript
it('should reject email addresses containing CRLF (SMTP injection)', () => {
  expect(() => new Email({
    from: 'sender@example.com',
    to: 'evil@test.com\r\nRCPT TO:<attacker@evil.com>',
    subject: 'Test',
    text: 'Hello',
  })).toThrow() // バリデーションエラー
})

it('should reject email addresses containing bare CR or LF', () => {
  expect(() => new Email({
    from: 'sender@example.com',
    to: 'evil@test.com\nRCPT TO:<attacker@evil.com>',
    subject: 'Test',
    text: 'Hello',
  })).toThrow()
})
```

**A5: ヘッダーインジェクション テスト例**:
```typescript
it('should sanitize CRLF in custom header values', () => {
  const email = new Email({
    from: 'sender@example.com',
    to: 'recipient@example.com',
    subject: 'Test',
    text: 'Hello',
    headers: {
      'X-Custom': 'value\r\nBcc: attacker@evil.com',
    },
  })
  const data = email.getEmailData()
  // CRLFがサニタイズされ、追加ヘッダーが注入されない
  expect(data).not.toContain('Bcc: attacker@evil.com')
})
```

##### B. 認証フローテスト（4項目）

| ID | テスト内容 | 対象ファイル | 状況 |
|---|---|---|---|
| B1 | LOGIN認証の多段チャレンジ/レスポンスフロー | `mailer.test.ts` | ✅ 実装済み（auth.test.ts） |
| B2 | CRAM-MD5認証のHMAC-MD5チャレンジ/レスポンス | `mailer.test.ts` | ✅ 実装済み（auth.test.ts） |
| B3 | 認証メソッドネゴシエーション（希望方式非サポート時のフォールバック） | `mailer.test.ts` | ✅ 実装済み（auth.test.ts） |
| B4 | 認証なし接続（`credentials` 未指定） | `mailer.test.ts` | ✅ 実装済み（mailer.test.ts） |

**B1: LOGIN認証テスト例**:
```typescript
it('should authenticate with LOGIN auth (multi-step)', async () => {
  mockReader.read
    .mockResolvedValueOnce({
      value: new TextEncoder().encode('220 ready\r\n'),
    })
    .mockResolvedValueOnce({
      value: new TextEncoder().encode('250-smtp.example.com\r\n250 AUTH LOGIN\r\n'),
    })
    // AUTH LOGIN → 334 VXNlcm5hbWU6 (Username:)
    .mockResolvedValueOnce({
      value: new TextEncoder().encode('334 VXNlcm5hbWU6\r\n'),
    })
    // ユーザー名送信 → 334 UGFzc3dvcmQ6 (Password:)
    .mockResolvedValueOnce({
      value: new TextEncoder().encode('334 UGFzc3dvcmQ6\r\n'),
    })
    // パスワード送信 → 235 OK
    .mockResolvedValueOnce({
      value: new TextEncoder().encode('235 Authentication successful\r\n'),
    })

  const mailer = await WorkerMailer.connect({
    host: 'smtp.example.com',
    port: 587,
    credentials: { username: 'user@example.com', password: 'pass' },
    authType: ['login'],
  })
  expect(mailer).toBeInstanceOf(WorkerMailer)
})
```

**B2: CRAM-MD5認証テスト例**:
```typescript
it('should authenticate with CRAM-MD5 auth', async () => {
  const challenge = Buffer.from('<unique-challenge@server>').toString('base64')
  mockReader.read
    .mockResolvedValueOnce({
      value: new TextEncoder().encode('220 ready\r\n'),
    })
    .mockResolvedValueOnce({
      value: new TextEncoder().encode('250-smtp.example.com\r\n250 AUTH CRAM-MD5\r\n'),
    })
    // AUTH CRAM-MD5 → 334 <challenge>
    .mockResolvedValueOnce({
      value: new TextEncoder().encode(`334 ${challenge}\r\n`),
    })
    // response → 235 OK
    .mockResolvedValueOnce({
      value: new TextEncoder().encode('235 Authentication successful\r\n'),
    })

  const mailer = await WorkerMailer.connect({
    host: 'smtp.example.com',
    port: 587,
    credentials: { username: 'user@example.com', password: 'secret' },
    authType: ['cram-md5'],
  })
  expect(mailer).toBeInstanceOf(WorkerMailer)
  // HMAC-MD5のレスポンスがWeb Crypto APIで正しく計算されたか検証
})
```

##### C. プロトコル異常系テスト（6項目）

| ID | テスト内容 | 対象ファイル | 関連Issue | 状況 |
|---|---|---|---|---|
| C1 | `read()` でストリーム終了（`done: true`）時の挙動 | `mailer.test.ts` | P1-2 | ✅ 実装済み（transport.test.ts） |
| C2 | EHLO応答がパーシャル（`\r\n`で終わらない）ケース | `mailer.test.ts` | — | ✅ 実装済み（transport.test.ts: マルチチャンク応答パース） |
| C3 | SMTPサーバーの4xx一時エラー応答 | `mailer.test.ts` | — | 未実装 |
| C4 | `start()`ループ内のRSET成功/失敗フロー | `mailer.test.ts` | T2 | 未実装 |
| C5 | 同一接続での複数メール連続送信 | `mailer.test.ts` | — | 未実装 |
| C6 | TLS証明書エラー（`startTls` 失敗） | `mailer.test.ts` | — | 未実装 |

**C1: ストリーム終了テスト例**:
```typescript
it('should throw error when stream ends (done: true)', async () => {
  mockReader.read
    .mockResolvedValueOnce({
      value: new TextEncoder().encode('220 ready\r\n'),
    })
    // EHLOへの応答途中でストリーム終了
    .mockResolvedValueOnce({ value: undefined, done: true })

  await expect(
    WorkerMailer.connect({
      host: 'smtp.example.com',
      port: 587,
      responseTimeoutMs: 5000,
    }),
  ).rejects.toThrow() // P1-2修正前: 無限ループでタイムアウト
})
```

**C5: 複数メール連続送信テスト例**:
```typescript
it('should send multiple emails on the same connection', async () => {
  // 接続+認証レスポンス
  mockReader.read
    .mockResolvedValueOnce({ value: encode('220 ready\r\n') })
    .mockResolvedValueOnce({ value: encode('250-OK\r\n250 AUTH PLAIN\r\n') })
    .mockResolvedValueOnce({ value: encode('235 Auth OK\r\n') })
    // 1通目
    .mockResolvedValueOnce({ value: encode('250 Sender OK\r\n') })
    .mockResolvedValueOnce({ value: encode('250 Recipient OK\r\n') })
    .mockResolvedValueOnce({ value: encode('354 Go\r\n') })
    .mockResolvedValueOnce({ value: encode('250 OK\r\n') })
    // 1通目成功後のRSET
    .mockResolvedValueOnce({ value: encode('250 Reset OK\r\n') })
    // 2通目
    .mockResolvedValueOnce({ value: encode('250 Sender OK\r\n') })
    .mockResolvedValueOnce({ value: encode('250 Recipient OK\r\n') })
    .mockResolvedValueOnce({ value: encode('354 Go\r\n') })
    .mockResolvedValueOnce({ value: encode('250 OK\r\n') })
    // close
    .mockResolvedValueOnce({ value: encode('221 Bye\r\n') })

  const mailer = await WorkerMailer.connect({ ... })
  await mailer.send({ from: '...', to: '...', subject: 'Mail 1', text: 'a' })
  await mailer.send({ from: '...', to: '...', subject: 'Mail 2', text: 'b' })
  await mailer.close()
})
```

##### D. エンコーディング/RFC準拠テスト（4項目）

| ID | テスト内容 | 対象ファイル | 関連Issue | 状況 |
|---|---|---|---|---|
| D1 | `encodeHeader` 75文字超 encoded-word の分割 | `email.test.ts` | P1-3 | ✅ 実装済み（header.test.ts, mime.test.ts: dot-stuffing含む） |
| D2 | ヘッダー行の78文字 folding | `email.test.ts` | P1-4 | ✅ 実装済み（header.test.ts: foldHeaderLine） |
| D3 | 制御文字（`\x00`-`\x1F`、`\x7F`）のエンコード | `email.test.ts` | P2-5 | ⚠️ 一部実装（email.test.ts: null byte拒否） |
| D4 | Message-ID ヘッダーのRFC 5322準拠フォーマット | `email.test.ts` | — | 未実装 |

**D1: 75文字制限テスト例**:
```typescript
it('should split long encoded-word into multiple (RFC 2047 75-char limit)', () => {
  // 日本語10文字 = UTF-8で30バイト = QP で90文字 → 75文字超
  const input = '会議のお知らせです本日'
  const result = encodeHeader(input)
  // 75文字超の場合、複数のencoded-wordに分割されるべき
  const encodedWords = result.match(/=\?UTF-8\?Q\?[^?]+\?=/g)
  if (encodedWords && encodedWords.length > 1) {
    // 各encoded-wordが75文字以下であること
    for (const word of encodedWords) {
      expect(word.length).toBeLessThanOrEqual(75)
    }
  }
  // 分割後もデコード結果が元と一致すること
  // （デコードロジックは別途実装が必要）
})
```

##### E. アーキテクチャ/状態管理テスト（4項目）

| ID | テスト内容 | 対象ファイル | 関連Issue | 状況 |
|---|---|---|---|---|
| E1 | `BlockingQueue.clear()` 後のpending `dequeue()` Promise | `utils.test.ts` | P2-2 | ✅ 実装済み（queue.test.ts） |
| E2 | `close()` と `send()` の同時実行（競合状態） | `mailer.test.ts` | P2-4 | 未実装 |
| E3 | `start()` 内部での例外伝播 | `mailer.test.ts` | P2-3 | 未実装 |
| E4 | 接続切断後の `send()` 呼び出し | `mailer.test.ts` | — | 未実装 |

**E1: BlockingQueue clear() テスト例**:
```typescript
it('should reject pending dequeue promises on clear()', async () => {
  const queue = new BlockingQueue<number>()
  const pending = queue.dequeue() // 値がないので待機状態
  queue.clear()
  // P2-2修正後: clear()がpending Promiseをrejectすべき
  await expect(pending).rejects.toThrow('Queue cleared')
})
```

##### F. 構造/MIMEテスト（2項目）

| ID | テスト内容 | 対象ファイル | 状況 |
|---|---|---|---|
| F1 | HTMLのみ（textなし）のメール生成とMIME構造 | `email.test.ts` | ✅ 実装済み（email.test.ts, mime.test.ts） |
| F2 | MIME boundary 一意性の検証（連続生成時） | `email.test.ts` | 未実装 |

---

### 層2: Workerハンドラテスト（新規）

**目的**: `test/worker.ts` のHTTPエントリポイント検証

**実行環境**: `vitest-pool-workers` 内（`SELF.fetch()` 使用）

**新規ファイル**: `test/src/worker.test.ts`

**目標**: ~200行

#### テスト内容

| ID | テスト内容 | 想定結果 |
|---|---|---|
| W1 | POST + 有効なconfig/emailでメール送信成功 | `200 Email sent successfully` |
| W2 | GET メソッドの拒否 | `405 Bad request` |
| W3 | 不正なJSONボディ | `400 Error: ...` or `500` |
| W4 | config欠落（host/portなし） | `400 Error: ...` |
| W5 | email欠落（from/to/subjectなし） | `400 Error: ...` |
| W6 | SMTP接続失敗時のエラーレスポンス | `400 Error: ...` |

#### テスト例

```typescript
import { SELF } from 'cloudflare:test'
import { describe, it, expect, vi } from 'vitest'

// cloudflare:sockets のモックは vitest.config.ts の設定で自動適用

describe('Worker Handler', () => {
  it('should reject non-POST methods', async () => {
    const response = await SELF.fetch('http://localhost', { method: 'GET' })
    expect(response.status).toBe(405)
  })

  it('should return 400 for invalid JSON body', async () => {
    const response = await SELF.fetch('http://localhost', {
      method: 'POST',
      body: 'not json',
    })
    expect(response.status).toBe(400)
  })

  it('should send email and return 200', async () => {
    // cloudflare:sockets モックで成功レスポンスを設定
    const response = await SELF.fetch('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          host: 'smtp.test',
          port: 587,
          credentials: { username: 'user', password: 'pass' },
          authType: ['plain'],
        },
        email: {
          from: 'sender@test.com',
          to: 'recipient@test.com',
          subject: 'Test',
          text: 'Hello',
        },
      }),
    })
    expect(response.status).toBe(200)
  })
})
```

**注意**: `SELF.fetch()` テストと `cloudflare:sockets` モックの組み合わせには、`vitest-pool-workers` 固有の設定が必要な場合がある。具体的には `test/wrangler.toml` の `[vars]` や `vitest.config.ts` の `poolOptions.workers.miniflare` を調整する可能性あり。

---

### 層3: E2Eテスト（新規・実SMTP）

**目的**: `cloudflare:sockets` の実TCP接続を通じたSMTP完全E2E検証

**実行環境**: `vitest-pool-workers` 内（`cloudflare:sockets` **モックなし**）

**SMTPサーバー**: [Mailpit](https://mailpit.axllent.dev/)（ローカル/CI用テストSMTP）

**新規ファイル**: `test/e2e/smtp.test.ts`

**目標**: ~300行

#### 前提条件

```bash
# ローカル開発時
docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit

# CI (GitHub Actions)
services:
  mailpit:
    image: axllent/mailpit
    ports:
      - 1025:1025
      - 8025:8025
```

#### Vitest設定（E2E用）

E2Eテストは `cloudflare:sockets` をモックしないため、別のVitest設定が必要:

```typescript
// vitest.e2e.config.ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    include: ['test/e2e/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './test/wrangler.toml' },
        main: './test/worker.ts',
      },
    },
  },
})
```

**重要な課題**: `vitest-pool-workers` の miniflare 環境で `cloudflare:sockets` が実際の TCP 接続を確立できるかは**未検証**。miniflare は workerd のサブセットであり、TCP ソケットの外部接続が制限されている可能性がある。

- **成功する場合**: E2Eテストをそのまま実装
- **失敗する場合**: 代替案として以下を検討
  1. `wrangler dev` で Worker を起動し、外部から HTTP リクエストでテスト
  2. Node.js ベースの統合テスト（`net.Socket` でSMTPプロトコルをシミュレート）
  3. `unstable_dev` API を使用

#### テスト内容

| ID | テスト内容 | 検証方法 |
|---|---|---|
| E2E-1 | プレーンテキストメールの送受信 | Mailpit API で受信確認 |
| E2E-2 | HTML + テキストの multipart メール | Mailpit API で両パート確認 |
| E2E-3 | 日本語件名のエンコード/デコード | Mailpit API でSubject確認 |
| E2E-4 | BCC宛先にメールが届くがヘッダーに漏れない | Mailpit API でヘッダー確認 |
| E2E-5 | 添付ファイル付きメール | Mailpit API で添付確認 |
| E2E-6 | 複数宛先（TO + CC）への送信 | Mailpit API で全宛先確認 |
| E2E-7 | STARTTLS接続（Mailpitが対応する場合） | 接続成功確認 |
| E2E-8 | 同一接続での複数メール連続送信 | Mailpit API で全メール確認 |
| E2E-9 | 大きな本文（長文メール）の送信 | Mailpit API で内容確認 |
| E2E-10 | 日本語パスワードでの認証（Mailpit対応時） | 接続成功/失敗確認 |

#### テスト例

```typescript
describe('E2E: SMTP via Mailpit', () => {
  const MAILPIT_SMTP_PORT = 1025
  const MAILPIT_API = 'http://localhost:8025/api/v1'

  beforeEach(async () => {
    // Mailpit の全メッセージを削除
    await fetch(`${MAILPIT_API}/messages`, { method: 'DELETE' })
  })

  it('should send and receive a plain text email', async () => {
    const mailer = await WorkerMailer.connect({
      host: 'localhost',
      port: MAILPIT_SMTP_PORT,
      startTls: false,
    })

    await mailer.send({
      from: { name: 'テスト送信者', email: 'sender@test.local' },
      to: 'recipient@test.local',
      subject: 'テストメール件名',
      text: 'これはテストメールです。',
    })
    await mailer.close()

    // Mailpit APIで受信確認
    const response = await fetch(`${MAILPIT_API}/messages`)
    const data = await response.json()
    expect(data.messages).toHaveLength(1)

    const message = data.messages[0]
    expect(message.Subject).toBe('テストメール件名')
    expect(message.From.Address).toBe('sender@test.local')
    expect(message.To[0].Address).toBe('recipient@test.local')
  })

  it('should not leak BCC in headers (RFC 5322)', async () => {
    const mailer = await WorkerMailer.connect({
      host: 'localhost',
      port: MAILPIT_SMTP_PORT,
      startTls: false,
    })

    await mailer.send({
      from: 'sender@test.local',
      to: 'to@test.local',
      bcc: 'secret@test.local',
      subject: 'BCC Test',
      text: 'BCC should not appear in headers',
    })
    await mailer.close()

    // Mailpit APIで受信確認
    const response = await fetch(`${MAILPIT_API}/messages`)
    const data = await response.json()

    // BCC宛先にもメールが届くが...
    expect(data.messages.length).toBeGreaterThanOrEqual(1)

    // メッセージのrawヘッダーにBCCが含まれない
    for (const msg of data.messages) {
      const rawResponse = await fetch(`${MAILPIT_API}/message/${msg.ID}/raw`)
      const raw = await rawResponse.text()
      expect(raw).not.toMatch(/^BCC:/im)
    }
  })

  it('should send email with Japanese subject decoded correctly', async () => {
    const mailer = await WorkerMailer.connect({
      host: 'localhost',
      port: MAILPIT_SMTP_PORT,
      startTls: false,
    })

    const japaneseSubject = '【重要】本日の会議資料について'
    await mailer.send({
      from: 'sender@test.local',
      to: 'recipient@test.local',
      subject: japaneseSubject,
      text: 'テスト本文',
    })
    await mailer.close()

    const response = await fetch(`${MAILPIT_API}/messages`)
    const data = await response.json()
    expect(data.messages[0].Subject).toBe(japaneseSubject)
  })
})
```

#### Mailpit API リファレンス

| エンドポイント | 用途 |
|---|---|
| `GET /api/v1/messages` | メッセージ一覧取得 |
| `GET /api/v1/message/{id}` | 個別メッセージ取得（パース済み） |
| `GET /api/v1/message/{id}/raw` | Rawメッセージ取得（ヘッダー検証用） |
| `GET /api/v1/message/{id}/attachments` | 添付ファイル一覧 |
| `DELETE /api/v1/messages` | 全メッセージ削除 |

---

## TDD戦略（P0修正との連携）

P0修正は以下のTDDサイクルで進める:

### サイクル

```
1. Red:   バグを再現するテストを書く（失敗確認）
2. Green: 最小限の修正コードでテストを通す
3. Refactor: コードを整理しつつテストが通り続けることを確認
```

### P0修正順序とテスト

| 修正順 | Issue | Redテスト | Greenの修正内容 |
|---|---|---|---|
| 1 | P0-1 | A1: `responseTimeoutMs` の独立動作確認 | `mailer.ts` L106 の `socketTimeoutMs` → `responseTimeoutMs` |
| 2 | P0-4 + P1-6 | A4: CRLFアドレスでのインジェクション | `email.ts` にバリデーション関数追加 |
| 3 | P0-5 | A5: CRLFヘッダーでのインジェクション | `email.ts` L148-153 にサニタイズ追加 |
| 4 | P0-2 + T1 | A2: BCC非含有確認 + 既存テスト反転 | `email.ts` L327-339 の `resolveBCC()` を修正 |
| 5 | P0-3 | A3: 非Latin-1パスワード | `mailer.ts` L363/380/387 の `btoa()` → `TextEncoder` ベース |

**P0-4 を P0-1 より先に修正しない理由**: P0-1は1行修正、P0-4はバリデーション関数の設計が必要。P0-1で TDD サイクルに慣れてから複雑な修正に進む。

---

## CI統合

### GitHub Actions ワークフロー

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run test

  e2e:
    runs-on: ubuntu-latest
    services:
      mailpit:
        image: axllent/mailpit
        ports:
          - 1025:1025
          - 8025:8025
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run test:e2e
```

### package.json スクリプト追加

```json
{
  "scripts": {
    "test": "vitest",
    "test:e2e": "vitest --config vitest.e2e.config.ts",
    "test:all": "vitest && vitest --config vitest.e2e.config.ts"
  }
}
```

---

## テスト追加ロードマップ

| フェーズ | 内容 | テスト追加数 | 関連修正 |
|---|---|---|---|
| **フェーズ1** | セキュリティテスト（A1-A6） + P0修正TDD | ~20 | P0-1〜P0-5, P1-5, P1-6, T1 |
| **フェーズ2** | 認証フロー（B1-B4） + プロトコル異常系（C1-C6） | ~25 | P1-1, P1-2, P1-7 |
| **フェーズ3** | エンコーディング（D1-D4） + RFC準拠修正 | ~15 | P1-3, P1-4, P2-5 |
| **フェーズ4** | Worker ハンドラ（W1-W6） + アーキテクチャ（E1-E4） | ~15 | P2-2, P2-3, P2-4 |
| **フェーズ5** | E2E テスト（E2E-1〜E2E-10） | ~15 | — |
| **フェーズ6** | MIME（F1-F2） + エッジケース追加 | ~10 | — |

**合計**: 約100テスト追加（現状 ~60テスト → 目標 ~160テスト）

> **2025年更新**: 現在374テスト達成。上記フェーズ1〜3の大部分が実装済み。
> 残りの主な未実装項目: A1（responseTimeoutMs）、A3（非Latin-1パスワード）、C3-C6（プロトコル異常系）、
> D4（Message-ID）、E2-E4（競合状態・例外伝播）、F2（boundary一意性）、E2Eテスト全般。

---

## miniflare TCP ソケット互換性の事前検証

E2Eテスト実装前に、以下の検証が必須:

```typescript
// test/e2e/socket-check.test.ts
import { connect } from 'cloudflare:sockets'

it('should establish TCP connection via cloudflare:sockets in miniflare', async () => {
  // Mailpit の SMTP ポートに接続を試みる
  const socket = connect(
    { hostname: 'localhost', port: 1025 },
    { secureTransport: 'off', allowHalfOpen: false },
  )
  await socket.opened
  const reader = socket.readable.getReader()
  const { value } = await reader.read()
  const greeting = new TextDecoder().decode(value)
  expect(greeting).toMatch(/^220 /)
  socket.close()
})
```

この検証が失敗する場合、E2Eテストは `wrangler dev` 経由に切り替える。

---

## PartyKit 互換性テスト（Atchecks固有）

worker-mailer の修正がすべて完了した後、PartyKit環境での互換性確認が必要:

1. PartyKit プロジェクト内で worker-mailer を import
2. `cloudflare:sockets` の TCP 接続が PartyKit の DO 内で動作するか
3. STARTTLS が PartyKit Workers で動作するか
4. メモリ制限・CPU時間制限内で完了するか

これは worker-mailer のテスト範囲外だが、Atchecks の統合テストとして実装予定。
