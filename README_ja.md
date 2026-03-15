# worker-mailer

[English](./README.md) | [日本語](./README_ja.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Worker Mailer** は [Cloudflare Workers](https://workers.cloudflare.com/) 上で動作する軽量SMTPメーラーライブラリです。[Cloudflare TCP Sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) を利用しており、外部依存はゼロです。

## 特徴

- 🚀 Cloudflare Workers ランタイム上で完全動作。外部依存ゼロ
- 📝 TypeScript による完全な型サポート
- 📧 プレーンテキスト・HTML メールおよび添付ファイルに対応
- 🔒 複数のSMTP認証方式をサポート: `plain`, `login`, `cram-md5`
- 📅 DSN（配信状態通知）対応
- 🔄 コネクションプールによる高効率な接続管理
- 📦 バッチ送信（逐次・並行）
- 🧪 送信テスト用ヘルパー（`createTestEmail`）
- 🌐 環境変数からのゼロコンフィグ接続
- 📮 Gmail / Outlook / SendGrid のプロバイダプリセット
- ✅ メールアドレスバリデーション
- ♻️ `await using` による非同期リソース自動管理
- 🛡️ 自動リトライ・自動再接続

## 動作要件

- Cloudflare Workers ランタイム
- `wrangler.toml` に以下の設定が必要:

```toml
compatibility_flags = ["nodejs_compat"]
# または compatibility_flags = ["nodejs_compat_v2"]
```

## 目次

- [インストール](#インストール)
- [クイックスタート](#クイックスタート)
- [環境変数一覧](#環境変数一覧)
- [API リファレンス](#api-リファレンス)
- [メールオプション](#メールオプション)
- [送信結果 (SendResult)](#送信結果-sendresult)
- [テストヘルパー](#テストヘルパー)
- [DSN（配信状態通知）](#dsn配信状態通知)
- [エラーハンドリング](#エラーハンドリング)
- [コネクションプール](#コネクションプール)
- [バッチ送信](#バッチ送信)
- [非同期リソース管理](#非同期リソース管理)
- [メールアドレスバリデーション](#メールアドレスバリデーション)
- [制限事項](#制限事項)
- [ライセンス](#ライセンス)

## インストール

```bash
bun add worker-mailer
# または
npm install worker-mailer
```

## クイックスタート

### 環境変数でゼロコンフィグ（`sendOnce`）

最もシンプルな方法です。環境変数を設定するだけで、接続・送信・切断を1回の呼び出しで完了できます。

```typescript
import { sendOnce } from "worker-mailer"

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 環境変数から自動的にSMTP設定を読み取り、送信後に接続を閉じる
    const result = await sendOnce(env, {
      from: { name: "通知", email: "noreply@example.com" },
      to: "user@example.com",
      subject: "ようこそ",
      html: "<h1>ご登録ありがとうございます</h1>",
    })

    return Response.json({ messageId: result.messageId })
  },
}
```

### プロバイダプリセット（Gmail の例）

Gmail / Outlook / SendGrid 向けの事前設定済みプリセットを使えます。環境変数 `SMTP_USER` と `SMTP_PASS` のみ設定が必要です。

```typescript
import { WorkerMailer, gmailPreset } from "worker-mailer"

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Gmail の推奨設定を自動適用
    const options = gmailPreset(env)
    const mailer = await WorkerMailer.connect(options)

    const result = await mailer.send({
      from: { name: "My App", email: "myapp@gmail.com" },
      to: "user@example.com",
      subject: "Gmail から送信",
      text: "プリセットを使った送信テストです。",
    })

    await mailer.close()
    return Response.json(result)
  },
}
```

### 標準的な使い方（connect → send → close）

接続設定を手動で指定する基本パターンです。

```typescript
import { WorkerMailer } from "worker-mailer"

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // SMTPサーバーに接続
    const mailer = await WorkerMailer.connect({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      startTls: true,
      credentials: {
        username: "user@example.com",
        password: "password",
      },
      authType: "plain",
    })

    // メールを送信
    const result = await mailer.send({
      from: { name: "送信者", email: "sender@example.com" },
      to: [
        { name: "受信者A", email: "a@example.com" },
        { name: "受信者B", email: "b@example.com" },
      ],
      cc: "cc@example.com",
      subject: "テストメール",
      text: "プレーンテキスト本文",
      html: "<h1>HTML本文</h1><p>これはHTMLメールです。</p>",
    })

    // 接続を閉じる
    await mailer.close()

    return Response.json({
      messageId: result.messageId,
      accepted: result.accepted,
    })
  },
}
```

## 環境変数一覧

`fromEnv` / `createFromEnv` / `sendOnce` が読み取る環境変数です。プレフィックスはデフォルトで `SMTP_` ですが、第2引数で変更できます。

| 変数名 | 必須 | 説明 |
|---|---|---|
| `SMTP_HOST` | ✅ | SMTPサーバーのホスト名 |
| `SMTP_PORT` | ✅ | SMTPサーバーのポート番号 |
| `SMTP_USER` | | 認証ユーザー名 |
| `SMTP_PASS` | | 認証パスワード |
| `SMTP_SECURE` | | SSL接続を使用する（`true` / `false`） |
| `SMTP_START_TLS` | | STARTTLSを使用する（`true` / `false`） |
| `SMTP_AUTH_TYPE` | | 認証タイプ（カンマ区切り、例: `plain,login`） |
| `SMTP_EHLO_HOSTNAME` | | EHLOコマンドで使用するホスト名 |
| `SMTP_LOG_LEVEL` | | ログレベル（`NONE`, `ERROR`, `WARN`, `INFO`, `DEBUG`） |
| `SMTP_MAX_RETRIES` | | 送信失敗時の最大リトライ回数 |

## API リファレンス

### `WorkerMailer.connect(options)`

SMTPサーバーへの接続を確立し、`WorkerMailer` インスタンスを返します。

```typescript
import { WorkerMailer } from "worker-mailer"

const mailer = await WorkerMailer.connect({
  host: "smtp.example.com",
  port: 587,
})
```

#### `WorkerMailerOptions`

| プロパティ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `host` | `string` | — | SMTPサーバーのホスト名（必須） |
| `port` | `number` | — | SMTPサーバーのポート番号（必須） |
| `secure` | `boolean` | `false` | SSL/TLS接続を使用する |
| `startTls` | `boolean` | `true` | サーバーが対応していればSTARTTLSでアップグレード |
| `credentials` | `{ username: string; password: string }` | — | SMTP認証の資格情報 |
| `authType` | `AuthType \| AuthType[]` | — | 認証方式: `"plain"`, `"login"`, `"cram-md5"` |
| `logLevel` | `LogLevel` | `LogLevel.INFO` | ログレベル（`NONE`, `ERROR`, `WARN`, `INFO`, `DEBUG`） |
| `dsn` | `object` | — | DSN（配信状態通知）のグローバル設定 |
| `socketTimeoutMs` | `number` | `60000` | ソケット接続タイムアウト（ミリ秒） |
| `responseTimeoutMs` | `number` | `30000` | サーバー応答タイムアウト（ミリ秒） |
| `ehloHostname` | `string` | `options.host` | EHLOコマンドで使用するホスト名 |
| `maxRetries` | `number` | `3` | 送信失敗時の最大リトライ回数 |
| `autoReconnect` | `boolean` | `false` | 接続切断時に自動再接続する |
| `onError` | `(error: Error) => void` | — | 致命的エラー発生時のコールバック |

### `mailer.send(options)`

メールを送信し、送信結果を返します。

```typescript
const result = await mailer.send({
  from: "sender@example.com",
  to: "recipient@example.com",
  subject: "件名",
  text: "本文",
})
```

### `mailer.close()`

SMTP接続を安全に切断します。

```typescript
await mailer.close()
```

### `WorkerMailer.send(options, email)`

接続・送信・切断を1回の呼び出しで行うスタティックメソッドです。

```typescript
const result = await WorkerMailer.send(
  {
    host: "smtp.example.com",
    port: 587,
    credentials: { username: "user", password: "pass" },
  },
  {
    from: "sender@example.com",
    to: "recipient@example.com",
    subject: "テスト",
    text: "こんにちは",
  },
)
```

### `fromEnv(env, prefix?)`

環境変数から `WorkerMailerOptions` を生成します。

```typescript
import { fromEnv } from "worker-mailer"

// デフォルトプレフィックス "SMTP_"
const options = fromEnv(env)

// カスタムプレフィックス
const options2 = fromEnv(env, "MAIL_")
```

### `createFromEnv(env, prefix?)`

環境変数からオプションを生成し、接続済みの `WorkerMailer` を返します。

```typescript
import { createFromEnv } from "worker-mailer"

const mailer = await createFromEnv(env)
```

### `sendOnce(env, email, prefix?)`

環境変数からの接続→送信→切断を1回で行います。

```typescript
import { sendOnce } from "worker-mailer"

const result = await sendOnce(env, {
  from: "noreply@example.com",
  to: "user@example.com",
  subject: "ワンショット送信",
  text: "送信後に自動切断されます。",
})
```

### プロバイダプリセット

各プリセットは環境変数 `SMTP_USER` / `SMTP_PASS` から認証情報を読み取ります。

```typescript
import { gmailPreset, outlookPreset, sendgridPreset } from "worker-mailer"

// Gmail（smtp.gmail.com:587, STARTTLS, plain認証）
const gmailOptions = gmailPreset(env)

// Outlook（smtp.office365.com:587, STARTTLS, plain認証）
const outlookOptions = outlookPreset(env)

// SendGrid（smtp.sendgrid.net:587, STARTTLS, plain認証）
const sendgridOptions = sendgridPreset(env)
```

## メールオプション

`mailer.send()` に渡す `EmailOptions` の完全な型定義です。

```typescript
type User = { name?: string; email: string }

type EmailOptions = {
  // 送信者（必須）
  from: string | User

  // 宛先（必須）
  to: string | string[] | User | User[]

  // 返信先
  reply?: string | User

  // CC（カーボンコピー）
  cc?: string | string[] | User | User[]

  // BCC（ブラインドカーボンコピー）
  bcc?: string | string[] | User | User[]

  // 件名（必須）
  subject: string

  // プレーンテキスト本文
  text?: string

  // HTML本文
  html?: string

  // カスタムメールヘッダー
  headers?: Record<string, string>

  // 添付ファイル
  attachments?: {
    filename: string
    content: string | Uint8Array | ArrayBuffer  // 文字列の場合はBase64エンコード
    mimeType?: string  // 未指定時はファイル名から推測
  }[]

  // DSN（配信状態通知）のメール単位上書き
  dsnOverride?: {
    envelopeId?: string
    RET?: { HEADERS?: boolean; FULL?: boolean }
    NOTIFY?: { DELAY?: boolean; FAILURE?: boolean; SUCCESS?: boolean }
  }
}
```

### 添付ファイルの例

```typescript
await mailer.send({
  from: "sender@example.com",
  to: "recipient@example.com",
  subject: "添付ファイル付きメール",
  text: "ファイルを添付しました。",
  attachments: [
    {
      filename: "report.pdf",
      content: base64EncodedString,
      mimeType: "application/pdf",
    },
    {
      filename: "image.png",
      content: uint8ArrayData,
      // mimeType 未指定 → ファイル名から "image/png" と推測
    },
  ],
})
```

## 送信結果 (SendResult)

`mailer.send()` が返すオブジェクトの型です。

```typescript
type SendResult = {
  messageId: string    // 生成されたメッセージID
  accepted: string[]   // 受理されたメールアドレス一覧
  rejected: string[]   // 拒否されたメールアドレス一覧
  responseTime: number // 送信にかかった時間（ミリ秒）
  response: string     // SMTPサーバーからのレスポンス文字列
}
```

### 使用例

```typescript
const result = await mailer.send({
  from: "sender@example.com",
  to: ["a@example.com", "b@example.com"],
  subject: "テスト",
  text: "本文",
})

console.log(`メッセージID: ${result.messageId}`)
console.log(`受理: ${result.accepted.join(", ")}`)
console.log(`拒否: ${result.rejected.join(", ")}`)
console.log(`応答時間: ${result.responseTime}ms`)
```

## テストヘルパー

`createTestEmail()` は、SMTP接続の動作確認用メールを生成します。

```typescript
import { createTestEmail } from "worker-mailer"

const testEmail = createTestEmail({
  from: "sender@example.com",
  to: "recipient@example.com",
  smtpHost: "smtp.gmail.com", // 省略可 — メール本文に表示
})

await mailer.send(testEmail)
```

生成されるメールにはタイムスタンプと接続情報が含まれ、配信成功をひと目で確認できます。

## DSN（配信状態通知）

DSN（Delivery Status Notification）を使うと、メールの配信状態をSMTPサーバーから受け取れます。

### 接続レベルの設定

すべての送信に適用されるグローバルDSN設定です。

```typescript
const mailer = await WorkerMailer.connect({
  host: "smtp.example.com",
  port: 587,
  credentials: { username: "user", password: "pass" },
  dsn: {
    RET: { FULL: true },                    // 完全なメッセージを返送
    NOTIFY: { FAILURE: true, DELAY: true },  // 失敗・遅延時に通知
  },
})
```

### メール単位の上書き

個別のメールで接続レベルのDSN設定を上書きできます。

```typescript
await mailer.send({
  from: "sender@example.com",
  to: "recipient@example.com",
  subject: "重要なメール",
  text: "本文",
  dsnOverride: {
    envelopeId: "unique-tracking-id-001",
    RET: { HEADERS: true },                              // ヘッダーのみ返送
    NOTIFY: { SUCCESS: true, FAILURE: true, DELAY: true }, // 成功・失敗・遅延すべて通知
  },
})
```

## エラーハンドリング

### `onError` コールバック

致命的なエラー（接続切断、再接続失敗など）が発生した場合に呼び出されます。

```typescript
const mailer = await WorkerMailer.connect({
  host: "smtp.example.com",
  port: 587,
  onError: (error) => {
    console.error("SMTP致命的エラー:", error.message)
    // エラーログの送信やアラートの発火など
  },
})
```

### `maxRetries` — 自動リトライ

送信失敗時に自動的にリトライします。指数バックオフで再試行間隔が延びます。

```typescript
const mailer = await WorkerMailer.connect({
  host: "smtp.example.com",
  port: 587,
  maxRetries: 5, // 最大5回リトライ（デフォルト: 3）
})
```

### `autoReconnect` — 自動再接続

リトライ中にSMTP接続が切断された場合、自動的に再接続を試みます。

```typescript
const mailer = await WorkerMailer.connect({
  host: "smtp.example.com",
  port: 587,
  maxRetries: 3,
  autoReconnect: true, // 接続切断時に自動再接続（デフォルト: false）
})
```

## コネクションプール

`WorkerMailerPool` を使うと、複数のSMTP接続をプールし、ラウンドロビン方式で負荷を分散できます。

```typescript
import { WorkerMailerPool } from "worker-mailer"

// 5つの接続を持つプールを作成
const pool = new WorkerMailerPool({
  host: "smtp.example.com",
  port: 587,
  credentials: { username: "user", password: "pass" },
  poolSize: 5, // デフォルト: 3
})

// すべての接続を確立
await pool.connect()

// 送信（自動的に接続がラウンドロビンで選択される）
const result = await pool.send({
  from: "sender@example.com",
  to: "recipient@example.com",
  subject: "プール経由の送信",
  text: "本文",
})

// すべての接続を閉じる
await pool.close()
```

## バッチ送信

`sendBatch` を使って複数のメールを一括送信できます。

```typescript
import { WorkerMailer, sendBatch } from "worker-mailer"

const mailer = await WorkerMailer.connect({
  host: "smtp.example.com",
  port: 587,
  credentials: { username: "user", password: "pass" },
})

const emails = [
  {
    from: "noreply@example.com",
    to: "user1@example.com",
    subject: "お知らせ #1",
    text: "ユーザー1 への通知です。",
  },
  {
    from: "noreply@example.com",
    to: "user2@example.com",
    subject: "お知らせ #2",
    text: "ユーザー2 への通知です。",
  },
  {
    from: "noreply@example.com",
    to: "user3@example.com",
    subject: "お知らせ #3",
    text: "ユーザー3 への通知です。",
  },
]

// バッチ送信（並行数3、エラー時も続行）
const results = await sendBatch(mailer, emails, {
  concurrency: 3,       // 並行送信数（デフォルト: 1 = 逐次）
  continueOnError: true, // エラー時も残りを送信（デフォルト: true）
})

// 結果を確認
for (const batch of results) {
  if (batch.success) {
    console.log(`送信成功: ${batch.result?.messageId}`)
  } else {
    console.error(`送信失敗: ${batch.error?.message}`)
  }
}

await mailer.close()
```

### `BatchResult` 型

```typescript
type BatchResult = {
  success: boolean
  email: EmailOptions      // 送信に使用したメールオプション
  result?: SendResult      // 成功時の送信結果
  error?: Error            // 失敗時のエラー
}
```

### `BatchOptions` 型

```typescript
type BatchOptions = {
  continueOnError?: boolean // エラー発生時に残りの送信を続行する（デフォルト: true）
  concurrency?: number      // 並行送信数（デフォルト: 1）
}
```

## 非同期リソース管理

`WorkerMailer` と `WorkerMailerPool` は `Symbol.asyncDispose` を実装しています。`await using` 構文を使うことで、スコープ終了時に自動的に接続が閉じられます。

```typescript
import { WorkerMailer } from "worker-mailer"

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // スコープ終了時に自動的に mailer.close() が呼ばれる
    await using mailer = await WorkerMailer.connect({
      host: "smtp.example.com",
      port: 587,
      credentials: { username: "user", password: "pass" },
    })

    const result = await mailer.send({
      from: "sender@example.com",
      to: "recipient@example.com",
      subject: "await using のテスト",
      text: "スコープ終了時に自動切断されます。",
    })

    return Response.json(result)
    // ← ここで自動的に mailer.close() が呼ばれる
  },
}
```

## メールアドレスバリデーション

送信前にメールアドレスの形式を検証できます。

### `validateEmail(address)`

単一のメールアドレスを検証します。

```typescript
import { validateEmail } from "worker-mailer"

const result = validateEmail("user@example.com")
if (result.valid) {
  console.log("有効なメールアドレスです")
} else {
  console.log(`無効: ${result.reason}`)
}
```

### `validateEmailBatch(addresses)`

複数のメールアドレスを一括検証します。

```typescript
import { validateEmailBatch } from "worker-mailer"

const results = validateEmailBatch([
  "valid@example.com",
  "invalid-email",
  "another@test.org",
])

for (const [address, result] of results) {
  console.log(`${address}: ${result.valid ? "有効" : `無効 (${result.reason})`}`)
}
```

### `ValidationResult` 型

```typescript
type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string }
```

## 制限事項

- **ポート制限:** Cloudflare Workers はポート25への送信接続ができません。ポート587や465を使用してください。
- **接続数制限:** 各Workerインスタンスには同時TCP接続数の上限があります。使用後は必ず接続を閉じてください。

## 謝辞

本プロジェクトは [zou-yu/worker-mailer](https://github.com/zou-yu/worker-mailer) のフォークです。Cloudflare Workers 上でのSMTP実装の基盤を構築してくださったオリジナルの開発者に感謝いたします。

## ライセンス

MIT License
