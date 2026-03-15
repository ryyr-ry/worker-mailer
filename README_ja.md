# worker-mailer

[English](./README.md) | [日本語](./README_ja.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Worker Mailer** は [Cloudflare Workers](https://workers.cloudflare.com/) 上で動作する軽量SMTPメーラーライブラリです。[Cloudflare TCP Sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) を利用しており、外部依存はゼロです。

## 特徴

- 🚀 **外部依存ゼロ** — Cloudflare Workers ランタイム上でネイティブ動作
- 📝 **完全なTypeScriptサポート** — すべてのAPIが型付き
- 📧 **プレーンテキスト・HTML・添付ファイル** — MIMEタイプの自動推論付き
- 🖼️ **インライン画像** — CID埋め込みによるHTMLメール内の画像表示
- 📅 **カレンダー招待** — iCalendar (.ics) 生成とMIME統合
- 🔏 **DKIM署名** — Web Crypto API によるRSA-SHA256署名
- 🔒 **SMTP認証** — `plain`, `login`, `CRAM-MD5`
- 🪝 **送信フック** — `beforeSend` / `afterSend` / ライフサイクルイベントフック
- 🧪 **モックメーラー** — テスト用アサーションヘルパー付き `MockMailer`
- 👁️ **メールプレビュー** — 送信せずにMIME内容を確認する `previewEmail()`
- 🏓 **ヘルスチェック** — SMTP NOOPコマンドによる `ping()`
- ⚡ **ゼロコンフィグヘルパー** — `sendOnce()`, `fromEnv()`, `createFromEnv()` で環境変数を自動読み取り
- 🏷️ **プロバイダプリセット** — `preset()` によるGmail, Outlook, SendGrid のワンライナー設定
- 📦 **バッチ送信** — 並行数制御とエラーハンドリング付き `sendBatch()`
- 🔄 **コネクションプール** — ラウンドロビン分配の `WorkerMailerPool`
- ✅ **メールバリデーション** — `validateEmail()` と `validateEmailBatch()`
- 📬 **DSN** — 配信状態通知（Delivery Status Notification）サポート
- 🔁 **自動リトライ・自動再接続** — 設定可能なリトライと再接続
- 📊 **構造化された結果** — 詳細なレスポンス情報付き `SendResult`
- 🧹 **非同期リソース管理** — `Symbol.asyncDispose` / `await using` サポート

## 動作要件

- Cloudflare Workers ランタイム
- `wrangler.toml` に以下の設定が必要:

```toml
compatibility_flags = ["nodejs_compat"]
```

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
import { WorkerMailer, preset } from "worker-mailer"

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const mailer = await WorkerMailer.connect(preset("gmail", env))

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

利用可能なプロバイダ: `"gmail"`, `"outlook"`, `"sendgrid"`

### 標準的な使い方（connect → send → close）

接続設定を手動で指定する基本パターンです。

```typescript
import { WorkerMailer } from "worker-mailer"

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const mailer = await WorkerMailer.connect({
			host: "smtp.example.com",
			port: 587,
			username: "user@example.com",
			password: "password",
			authType: ["plain"],
		})

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

		await mailer.close()

		return Response.json({
			messageId: result.messageId,
			accepted: result.accepted,
		})
	},
}
```

> **備考:** ポート番号に基づいてTLSモードが自動推論されます:
>
> - ポート465 → `secure: true, startTls: false`（暗黙的TLS）
> - その他のポート → `secure: false, startTls: true`（STARTTLS）
> - 不正な組み合わせ（例: ポート587 + `secure: true`、ポート465 + `startTls: true`）は即座にエラーになります。

## モックメーラー（テスト）

`MockMailer` はネットワーク接続なしで `Mailer` インターフェースを実装します。ユニットテストに最適です:

```typescript
import { MockMailer } from "worker-mailer"

const mock = new MockMailer()

await mock.send({
	from: "test@example.com",
	to: "user@example.com",
	subject: "テスト",
	text: "こんにちは",
})

console.log(mock.sendCount) // 1
console.log(mock.lastEmail?.subject) // "テスト"
console.log(mock.hasSentTo("user@example.com")) // true
console.log(mock.hasSentWithSubject("テスト")) // true
console.log(mock.sentEmails) // 送信済みメールの読み取り専用配列

mock.clear() // 状態をリセット
```

### エラーと遅延のシミュレーション

```typescript
const failingMock = new MockMailer({
	simulateError: new Error("SMTP接続に失敗しました"),
})

const slowMock = new MockMailer({
	simulateDelay: 500, // 送信ごとに500msの遅延
})
```

## DKIM署名

Web Crypto API によるRSA-SHA256で送信メールにDKIM署名を付与できます:

```typescript
const mailer = await WorkerMailer.connect({
	host: "smtp.example.com",
	port: 587,
	username: "user@example.com",
	password: "password",
	authType: ["plain"],
	dkim: {
		domainName: "example.com",
		keySelector: "mail",
		privateKey: env.DKIM_PRIVATE_KEY, // PKCS#8 PEM文字列 または CryptoKey
	},
})
```

DKIMは環境変数（`SMTP_DKIM_DOMAIN`, `SMTP_DKIM_SELECTOR`, `SMTP_DKIM_PRIVATE_KEY`）でも設定できます。

### DKIMオプションの全型

```typescript
type DkimOptions = {
	domainName: string
	keySelector: string
	privateKey: string | CryptoKey
	headerFieldNames?: string[] // 署名対象のヘッダー（デフォルト: from, to, subject, date, message-id）
	canonicalization?: "relaxed/relaxed" | "relaxed/simple" | "simple/relaxed" | "simple/simple"
}
```

## インライン画像

CID参照を使ってHTMLメールに画像を直接埋め込めます:

```typescript
await mailer.send({
	from: "sender@example.com",
	to: "recipient@example.com",
	subject: "画像付きメール",
	html: '<p>ロゴはこちら:</p><img src="cid:logo123" />',
	inlineAttachments: [
		{
			cid: "logo123",
			filename: "logo.png",
			content: pngUint8Array,
			mimeType: "image/png",
		},
	],
})
```

### `InlineAttachment` 型

```typescript
type InlineAttachment = {
	cid: string // HTMLで参照するContent-ID（例: "cid:logo123"）
	filename: string
	content: string | Uint8Array | ArrayBuffer
	mimeType?: string
}
```

## カレンダー招待

iCalendar (.ics) 形式の招待状を生成してメールに添付できます:

```typescript
import { createCalendarEvent } from "worker-mailer"

const event = createCalendarEvent({
	summary: "チーム会議",
	start: new Date("2025-02-01T10:00:00Z"),
	end: new Date("2025-02-01T11:00:00Z"),
	organizer: { name: "Alice", email: "alice@example.com" },
	attendees: [
		{ name: "Bob", email: "bob@example.com", rsvp: true },
	],
	location: "会議室A",
	description: "週次ミーティング",
})

await mailer.send({
	from: "alice@example.com",
	to: "bob@example.com",
	subject: "会議の招待: チーム会議",
	text: "会議に招待されています。",
	calendarEvent: event,
})
```

### `CalendarEventOptions` 型

```typescript
type CalendarEventOptions = {
	summary: string
	start: Date
	end: Date
	organizer: { name?: string; email: string }
	attendees?: { name?: string; email: string; rsvp?: boolean }[]
	location?: string
	description?: string
	uid?: string
	reminderMinutes?: number
	method?: "REQUEST" | "CANCEL" | "REPLY"
	url?: string
}

type CalendarEventPart = {
	content: string
	method: "REQUEST" | "CANCEL" | "REPLY"
}
```

## 送信フック

メール送信のライフサイクルにフックを設定して、送信の傍受や監視が行えます:

```typescript
const mailer = await WorkerMailer.connect({
	host: "smtp.example.com",
	port: 587,
	username: "user@example.com",
	password: "password",
	authType: ["plain"],
	hooks: {
		beforeSend: async (email) => {
			// 送信前にメールを変更
			return { ...email, subject: `[PREFIX] ${email.subject}` }
			// `false` を返すと送信をスキップ、`undefined` を返すとそのまま送信
		},
		afterSend: (email, result) => {
			console.log(`送信完了: ${result.messageId} → ${result.accepted.join(", ")}`)
		},
		onSendError: (email, error) => {
			console.error(`送信失敗 (${email.to}):`, error.message)
		},
		onConnected: (info) => {
			console.log(`接続完了: ${info.host}:${info.port}`)
		},
		onDisconnected: (info) => {
			console.log("切断:", info.reason)
		},
		onReconnecting: (info) => {
			console.log(`再接続中（試行 ${info.attempt}）...`)
		},
		onFatalError: (error) => {
			console.error("致命的SMTPエラー:", error.message)
		},
	},
})
```

### `SendHooks` 型

```typescript
type SendHooks = {
	beforeSend?: (email: EmailOptions) => Promise<EmailOptions | false | undefined> | EmailOptions | false | undefined
	afterSend?: (email: EmailOptions, result: SendResult) => Promise<void> | void
	onSendError?: (email: EmailOptions, error: Error) => Promise<void> | void
	onConnected?: (info: { host: string; port: number }) => void
	onDisconnected?: (info: { reason?: string }) => void
	onReconnecting?: (info: { attempt: number }) => void
	onFatalError?: (error: Error) => void
}
```

## メールプレビュー

メールを送信せずに、生のMIMEメッセージをレンダリングします。デバッグやテストに便利です:

```typescript
import { previewEmail } from "worker-mailer"

const mime = previewEmail({
	from: "sender@example.com",
	to: "recipient@example.com",
	subject: "プレビューテスト",
	html: "<h1>こんにちは</h1>",
})

console.log(mime) // 完全なMIMEメッセージ文字列
```

## ヘルスチェック（ping）

SMTP `NOOP` コマンドを使って接続が生きているか確認します:

```typescript
const isAlive = await mailer.ping()
console.log(isAlive) // true または false
```

`WorkerMailer` と `WorkerMailerPool` の両方で `ping()` が利用できます。

## 環境変数一覧

`fromEnv` / `createFromEnv` / `sendOnce` が読み取る環境変数です。プレフィックスはデフォルトで `SMTP_` ですが、第2引数で変更できます。

| 変数名 | 必須 | 説明 |
|---|---|---|
| `SMTP_HOST` | ✅ | SMTPサーバーのホスト名 |
| `SMTP_PORT` | ✅ | SMTPサーバーのポート番号 |
| `SMTP_USER` | | 認証ユーザー名 |
| `SMTP_PASS` | | 認証パスワード |
| `SMTP_SECURE` | | SSL接続を使用する（`true` / `false` / `1` / `0` / `yes` / `no`） |
| `SMTP_START_TLS` | | STARTTLSを使用する（`true` / `false` / `1` / `0` / `yes` / `no`） |
| `SMTP_AUTH_TYPE` | | 認証タイプ（カンマ区切り、例: `plain,login`） |
| `SMTP_EHLO_HOSTNAME` | | EHLOコマンドで使用するホスト名 |
| `SMTP_LOG_LEVEL` | | ログレベル（`NONE`, `ERROR`, `WARN`, `INFO`, `DEBUG`） |
| `SMTP_MAX_RETRIES` | | 送信失敗時の最大リトライ回数 |
| `SMTP_DKIM_DOMAIN` | | DKIM署名ドメイン |
| `SMTP_DKIM_SELECTOR` | | DKIMキーセレクター |
| `SMTP_DKIM_PRIVATE_KEY` | | DKIM秘密鍵（PKCS#8 PEM形式） |

カスタムプレフィックスの例 — `fromEnv(env, "MAIL_")` は `MAIL_HOST`, `MAIL_PORT` などを読み取ります。

## API リファレンス

### WorkerMailer

```typescript
// 接続済みインスタンスを作成
static connect(options: WorkerMailerOptions): Promise<WorkerMailer>

// メールを送信
send(options: EmailOptions): Promise<SendResult>

// 接続を閉じる
close(): Promise<void>

// SMTP NOOPによるヘルスチェック
ping(): Promise<boolean>

// 非同期リソース管理（await using）
[Symbol.asyncDispose](): Promise<void>
```

### WorkerMailerPool

ラウンドロビン方式のコネクションプール。`send()` 呼び出しを複数の接続に分散します。

```typescript
// プールを作成（デフォルト poolSize: 3）
new WorkerMailerPool(options: WorkerMailerOptions & { poolSize?: number })

// すべての接続を確立
connect(): Promise<this>

// 次の接続でメールを送信（ラウンドロビン）
send(options: EmailOptions): Promise<SendResult>

// すべての接続をヘルスチェック
ping(): Promise<boolean>

// すべての接続を閉じる
close(): Promise<void>

// 非同期リソース管理
[Symbol.asyncDispose](): Promise<void>
```

### fromEnv / createFromEnv / sendOnce

```typescript
// 環境変数から WorkerMailerOptions を生成
fromEnv(env: Record<string, unknown>, prefix?: string): WorkerMailerOptions

// 環境変数からオプションを生成し、接続済みの WorkerMailer を返す
createFromEnv(env: Record<string, unknown>, prefix?: string): Promise<WorkerMailer>

// 環境変数からの接続→送信→切断を1回で実行
sendOnce(env: Record<string, unknown>, email: EmailOptions, prefix?: string): Promise<SendResult>
```

### プロバイダプリセット

プロバイダのホスト/ポート/TLS設定が事前に設定された `WorkerMailerOptions` を返します。
認証情報は環境変数 `SMTP_USER` / `SMTP_PASS` から読み取られます。

```typescript
preset(provider: SmtpProvider, env: Record<string, unknown>): WorkerMailerOptions

type SmtpProvider = "gmail" | "outlook" | "sendgrid"

// Gmail   → smtp.gmail.com:587, STARTTLS, auth: plain
// Outlook → smtp.office365.com:587, STARTTLS, auth: plain
// SendGrid → smtp.sendgrid.net:587, STARTTLS, auth: plain
```

### sendBatch

```typescript
sendBatch(
	mailer: Mailer,
	emails: EmailOptions[],
	options?: BatchOptions,
): Promise<BatchResult[]>
```

```typescript
type BatchOptions = {
	continueOnError?: boolean // エラー発生時に残りの送信を続行する（デフォルト: true）
	concurrency?: number // 並行送信数（デフォルト: 1）
}

type BatchResult = {
	success: boolean
	email: EmailOptions // 送信に使用したメールオプション
	result?: SendResult // 成功時の送信結果
	error?: Error // 失敗時のエラー
}
```

### validateEmail / validateEmailBatch

```typescript
validateEmail(address: string): ValidationResult
validateEmailBatch(addresses: string[]): Map<string, ValidationResult>

type ValidationResult = { valid: true } | { valid: false; reason: string }
```

## メールオプション

`mailer.send()` に渡す `EmailOptions` の完全な型定義です。

```typescript
type User = { name?: string; email: string }

type EmailOptions = {
	from: string | User
	to: string | string[] | User | User[]
	reply?: string | User
	cc?: string | string[] | User | User[]
	bcc?: string | string[] | User | User[]
	subject: string
	text?: string
	html?: string
	headers?: Record<string, string>
	attachments?: Attachment[]
	inlineAttachments?: InlineAttachment[]
	calendarEvent?: CalendarEventPart
	dsnOverride?: DsnOptions
}

type Attachment = {
	filename: string
	content: string | Uint8Array | ArrayBuffer
	mimeType?: string // 例: "text/plain", "application/pdf"
}

type InlineAttachment = {
	cid: string
	filename: string
	content: string | Uint8Array | ArrayBuffer
	mimeType?: string
}

type CalendarEventPart = {
	content: string
	method: "REQUEST" | "CANCEL" | "REPLY"
}
```

> **備考:** 添付ファイルのcontentには、Base64エンコードされた `string`、`Uint8Array`、または `ArrayBuffer` を指定できます。
> `mimeType` を省略した場合、ファイル名の拡張子から自動推論されます。

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
			// mimeType 未指定 → ファイル名から "image/png" と推論
		},
	],
})
```

## 送信結果 (SendResult)

`mailer.send()` が返すオブジェクトの型です。

```typescript
type SendResult = {
	messageId: string // 生成されたメッセージID
	accepted: string[] // 受理されたメールアドレス一覧
	rejected: string[] // 拒否されたメールアドレス一覧
	responseTime: number // 送信にかかった時間（ミリ秒）
	response: string // SMTPサーバーからのレスポンス文字列
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
	username: "user@example.com",
	password: "password",
	authType: ["plain"],
	dsn: {
		RET: { FULL: true }, // 完全なメッセージを返送
		NOTIFY: { FAILURE: true, DELAY: true }, // 失敗・遅延時に通知
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
		RET: { HEADERS: true }, // ヘッダーのみ返送
		NOTIFY: { SUCCESS: true, FAILURE: true, DELAY: true }, // 成功・失敗・遅延すべて通知
	},
})
```

## エラーハンドリング

### `hooks.onFatalError` コールバック

致命的なエラー（接続切断、再接続失敗など）が発生した場合に呼び出されます。try/catchで囲まなくてもエラーを受け取れます:

```typescript
const mailer = await WorkerMailer.connect({
	host: "smtp.example.com",
	port: 587,
	username: "user@example.com",
	password: "password",
	authType: ["plain"],
	hooks: {
		onFatalError: (error) => {
			console.error("SMTP致命的エラー:", error.message)
		},
		onSendError: (email, error) => {
			console.error(`送信失敗 (${email.subject}):`, error.message)
		},
	},
})
```

### `maxRetries` — 自動リトライ

送信失敗時に自動的にリトライします。指数バックオフで再試行間隔が延びます。

```typescript
const mailer = await WorkerMailer.connect({
	host: "smtp.example.com",
	port: 587,
	username: "user@example.com",
	password: "password",
	authType: ["plain"],
	maxRetries: 5, // 最大5回リトライ（デフォルト: 3）
})
```

### `autoReconnect` — 自動再接続

リトライ中にSMTP接続が切断された場合、自動的に再接続を試みます。

```typescript
const mailer = await WorkerMailer.connect({
	host: "smtp.example.com",
	port: 587,
	username: "user@example.com",
	password: "password",
	authType: ["plain"],
	autoReconnect: true, // 接続切断時に自動再接続（デフォルト: false）
})
```

## コネクションプール

`WorkerMailerPool` を使うと、複数のSMTP接続をプールし、ラウンドロビン方式で負荷を分散できます。

```typescript
import { WorkerMailerPool } from "worker-mailer"

const pool = new WorkerMailerPool({
	host: "smtp.example.com",
	port: 587,
	username: "user@example.com",
	password: "password",
	authType: ["plain"],
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
	username: "user@example.com",
	password: "password",
	authType: ["plain"],
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
	concurrency: 3, // 並行送信数（デフォルト: 1 = 逐次）
	continueOnError: true, // エラー時も残りを送信（デフォルト: true）
})

// 結果を確認
for (const batch of results) {
	if (batch.success) {
		console.log(`✅ 送信成功: ${batch.result?.messageId}`)
	} else {
		console.error(`❌ 送信失敗: ${batch.error?.message}`)
	}
}

await mailer.close()
```

## 非同期リソース管理

`WorkerMailer` と `WorkerMailerPool` は `Symbol.asyncDispose` を実装しています。`await using` 構文を使うことで、スコープ終了時に自動的に接続が閉じられます。

```typescript
import { WorkerMailer } from "worker-mailer"

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		await using mailer = await WorkerMailer.connect({
			host: "smtp.example.com",
			port: 587,
			username: "user@example.com",
			password: "password",
			authType: ["plain"],
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

## WorkerMailerOptions

接続オプションの完全なリファレンスです。

```typescript
type WorkerMailerOptions = {
	host: string // SMTPサーバーのホスト名
	port: number // SMTPサーバーのポート番号（587, 465 など）
	secure?: boolean // SSL/TLS接続を使用する（デフォルト: false）
	startTls?: boolean // STARTTLSでアップグレード（デフォルト: true）
	username?: string // SMTP認証ユーザー名
	password?: string // SMTP認証パスワード
	authType?: AuthType[] // ["plain"] | ["login"] | ["cram-md5"] — 常に配列
	logLevel?: LogLevel // NONE, ERROR, WARN, INFO, DEBUG
	dsn?: Omit<DsnOptions, "envelopeId"> // 接続レベルのDSN設定
	socketTimeoutMs?: number // ソケットタイムアウト（ミリ秒、デフォルト: 60000）
	responseTimeoutMs?: number // サーバー応答タイムアウト（ミリ秒、デフォルト: 30000）
	ehloHostname?: string // EHLOコマンドで使用するホスト名（デフォルト: host）
	maxRetries?: number // リトライ回数（デフォルト: 3）
	autoReconnect?: boolean // 自動再接続（デフォルト: false）
	hooks?: SendHooks // 送信・ライフサイクルフック
	dkim?: DkimOptions // DKIM署名設定
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
- **接続数制限:** 各Workerインスタンスには同時TCP接続数の上限があります。使用後は必ず接続を閉じるか、`await using` を使って自動管理してください。

## 謝辞

本プロジェクトは [zou-yu/worker-mailer](https://github.com/zou-yu/worker-mailer) のフォークです。Cloudflare Workers 上でのSMTP実装の基盤を構築してくださったオリジナルの開発者に感謝いたします。

## ライセンス

[MIT](./LICENSE)
