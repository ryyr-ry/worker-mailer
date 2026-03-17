# worker-mailer

[English](./README.md) | [日本語](./README_ja.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A lightweight, zero-dependency SMTP mailer for **Cloudflare Workers**.
Built entirely on the [`cloudflare:sockets`](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) TCP API — no Node.js polyfills required beyond the compatibility flag.

## Features

- 🚀 **Zero dependencies** — runs natively on the Cloudflare Workers runtime
- 📝 **Full TypeScript support** — every API is fully typed
- 📧 **Plain text, HTML & attachments** — with automatic MIME type inference
- 🖼️ **Inline images** — CID-embedded images in HTML emails
- 📅 **Calendar invites** — iCalendar (.ics) generation with MIME integration
- 🔏 **DKIM signing** — RSA-SHA256 via Web Crypto API
- 🔒 **SMTP auth** — `plain`, `login`, and `CRAM-MD5`
- 🪝 **Send hooks** — `beforeSend` / `afterSend` / lifecycle event hooks
- 🧪 **Mock mailer** — `MockMailer` for testing with assertion helpers
- 👁️ **Email preview** — `previewEmail()` for MIME inspection without sending
- 🏓 **Health check** — `ping()` via SMTP NOOP command
- ⚡ **Zero-config helpers** — `sendOnce()`, `fromEnv()`, `createFromEnv()` read env vars automatically
- 🏷️ **Provider presets** — Gmail, Outlook, SendGrid one-liner via `preset()`
- 📦 **Batch sending** — `sendBatch()` with concurrency control and error handling
- 🔄 **Connection pool** — `WorkerMailerPool` with round-robin distribution
- ✅ **Email validation** — `validateEmail()` and `validateEmailBatch()`
- 📬 **DSN** — Delivery Status Notification support
- 🔁 **Auto-reconnect & retries** — configurable retry and reconnection
- 📊 **Structured results** — `SendResult` with detailed response info
- 🧹 **Async disposal** — `Symbol.asyncDispose` / `await using` support
- 🌐 **SMTPUTF8** — international email addresses (RFC 6531)
- 🔗 **Reply threading** — `threadHeaders()` for In-Reply-To / References
- 🎨 **Template engine** — Mustache-like `{{variable}}` rendering with HTML escaping
- 📝 **HTML → Text** — automatic plain text generation from HTML
- 🚫 **List-Unsubscribe** — RFC 8058 one-click unsubscribe headers
- 🔨 **Mail builder** — fluent `MailBuilder` API with method chaining

## Requirements

- **Cloudflare Workers** runtime
- `wrangler.toml`:
  ```toml
  compatibility_flags = ["nodejs_compat"]
  ```

## Installation

```bash
bun add worker-mailer
# or
npm install worker-mailer
```

## Quick Start

### Zero-config with environment variables

The fastest way to send an email. Set your `SMTP_*` env vars in `wrangler.toml` (or the dashboard) and call `sendOnce()`:

```typescript
import { sendOnce } from "worker-mailer"

export default {
	async fetch(request, env) {
		const result = await sendOnce(env, {
			from: "noreply@example.com",
			to: "user@example.com",
			subject: "Welcome!",
			text: "Thanks for signing up.",
		})

		return Response.json(result)
	},
}
```

### Provider presets

Pre-configured settings for popular providers. Just supply `SMTP_USER` and `SMTP_PASS`:

```typescript
import { WorkerMailer, preset } from "worker-mailer"

const mailer = await WorkerMailer.connect(preset("gmail", env))

await mailer.send({
	from: "you@gmail.com",
	to: "friend@example.com",
	subject: "Sent via Gmail",
	text: "Hello from Cloudflare Workers!",
})

await mailer.close()
```

Available providers: `"gmail"`, `"outlook"`, `"sendgrid"`.

### Standard usage

Full control over the connection lifecycle:

```typescript
import { WorkerMailer } from "worker-mailer"

const mailer = await WorkerMailer.connect({
	host: "smtp.example.com",
	port: 587,
	username: "user@example.com",
	password: "app-password",
	authType: ["plain"],
})

const result = await mailer.send({
	from: { name: "App", email: "noreply@example.com" },
	to: [
		{ name: "Alice", email: "alice@example.com" },
		"bob@example.com",
	],
	subject: "Hello from Worker Mailer",
	text: "Plain text body",
	html: "<h1>Hello</h1><p>HTML body</p>",
})

console.log(result.messageId) // "<...@example.com>"
console.log(result.accepted) // ["alice@example.com", "bob@example.com"]
console.log(result.responseTime) // 230  (ms)

await mailer.close()
```

> **Note:** Port auto-inference sets TLS mode automatically:
>
> - Port 465 → `secure: true, startTls: false` (implicit TLS)
> - Other ports → `secure: false, startTls: true` (STARTTLS)
> - Invalid combinations (e.g. port 587 + `secure: true`, port 465 + `startTls: true`) throw immediately.

## Mock Mailer (Testing)

`MockMailer` implements the `Mailer` interface without making any network connections. Use it for unit tests:

```typescript
import { MockMailer } from "worker-mailer"

const mock = new MockMailer()

await mock.send({
	from: "test@example.com",
	to: "user@example.com",
	subject: "Test",
	text: "Hello",
})

console.log(mock.sendCount) // 1
console.log(mock.lastEmail?.subject) // "Test"
console.log(mock.hasSentTo("user@example.com")) // true
console.log(mock.hasSentWithSubject("Test")) // true
console.log(mock.sentEmails) // ReadonlyArray of all sent emails

mock.clear() // reset state
```

### Simulating errors and delays

```typescript
const failingMock = new MockMailer({
	simulateError: new Error("SMTP connection failed"),
})

const slowMock = new MockMailer({
	simulateDelay: 500, // 500ms delay per send
})
```

## DKIM Signing

Sign outgoing emails with DKIM (RSA-SHA256 via Web Crypto API):

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
		privateKey: env.DKIM_PRIVATE_KEY, // PKCS#8 PEM string or CryptoKey
	},
})
```

DKIM can also be configured via environment variables (`SMTP_DKIM_DOMAIN`, `SMTP_DKIM_SELECTOR`, `SMTP_DKIM_PRIVATE_KEY`).

### Full DKIM options

```typescript
type DkimOptions = {
	domainName: string
	keySelector: string
	privateKey: string | CryptoKey
	headerFieldNames?: string[] // headers to sign (default: from, to, subject, date, message-id)
	canonicalization?: "relaxed/relaxed" | "relaxed/simple" | "simple/relaxed" | "simple/simple"
}
```

## Inline Images

Embed images directly in HTML emails using CID references:

```typescript
await mailer.send({
	from: "sender@example.com",
	to: "recipient@example.com",
	subject: "Check out this image",
	html: '<p>Here is the logo:</p><img src="cid:logo123" />',
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

### `InlineAttachment` type

```typescript
type InlineAttachment = {
	cid: string // Content-ID referenced in HTML (e.g. "cid:logo123")
	filename: string
	content: string | Uint8Array | ArrayBuffer
	mimeType?: string
}
```

## Calendar Invites

Generate iCalendar (.ics) invitations and attach them to emails:

```typescript
import { createCalendarEvent } from "worker-mailer"

const event = createCalendarEvent({
	summary: "Team Meeting",
	start: new Date("2025-02-01T10:00:00Z"),
	end: new Date("2025-02-01T11:00:00Z"),
	organizer: { name: "Alice", email: "alice@example.com" },
	attendees: [
		{ name: "Bob", email: "bob@example.com", rsvp: true },
	],
	location: "Conference Room A",
	description: "Weekly sync",
})

await mailer.send({
	from: "alice@example.com",
	to: "bob@example.com",
	subject: "Meeting Invite: Team Meeting",
	text: "You are invited to a meeting.",
	calendarEvent: event,
})
```

### `CalendarEventOptions` type

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

## Send Hooks

Attach lifecycle hooks to intercept and observe email sending:

```typescript
const mailer = await WorkerMailer.connect({
	host: "smtp.example.com",
	port: 587,
	username: "user@example.com",
	password: "password",
	authType: ["plain"],
	hooks: {
		beforeSend: async (email) => {
			// Modify the email before sending
			return { ...email, subject: `[PREFIX] ${email.subject}` }
			// Return `false` to skip sending, or `undefined` to send as-is
		},
		afterSend: (email, result) => {
			console.log(`Sent ${result.messageId} to ${result.accepted.join(", ")}`)
		},
		onSendError: (email, error) => {
			console.error(`Failed to send to ${email.to}:`, error.message)
		},
		onConnected: (info) => {
			console.log(`Connected to ${info.host}:${info.port}`)
		},
		onDisconnected: (info) => {
			console.log("Disconnected:", info.reason)
		},
		onReconnecting: (info) => {
			console.log(`Reconnecting (attempt ${info.attempt})...`)
		},
		onFatalError: (error) => {
			console.error("Fatal SMTP error:", error.message)
		},
	},
})
```

### `SendHooks` type

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

## Email Preview

Render the raw MIME message of an email without sending it. Useful for debugging and testing:

```typescript
import { previewEmail } from "worker-mailer"

const mime = previewEmail({
	from: "sender@example.com",
	to: "recipient@example.com",
	subject: "Preview this",
	html: "<h1>Hello</h1>",
})

console.log(mime) // Full MIME message string
```

## Health Check (ping)

Check whether the SMTP connection is alive using the SMTP `NOOP` command:

```typescript
const isAlive = await mailer.ping()
console.log(isAlive) // true or false
```

Both `WorkerMailer` and `WorkerMailerPool` support `ping()`.

## Environment Variables

`fromEnv()` (and helpers that use it) reads the following variables. The default prefix is `SMTP_` but can be customized:

| Variable | Required | Description |
|---|---|---|
| `SMTP_HOST` | ✅ | SMTP server hostname |
| `SMTP_PORT` | ✅ | SMTP server port |
| `SMTP_USER` | | Username for authentication |
| `SMTP_PASS` | | Password for authentication |
| `SMTP_SECURE` | | Use TLS from the start (`true`/`false`/`1`/`0`/`yes`/`no`) |
| `SMTP_START_TLS` | | Upgrade to TLS via STARTTLS (`true`/`false`/`1`/`0`/`yes`/`no`) |
| `SMTP_AUTH_TYPE` | | Auth methods, comma-separated (`plain,login,cram-md5`) |
| `SMTP_EHLO_HOSTNAME` | | Custom EHLO hostname |
| `SMTP_LOG_LEVEL` | | Log level (`NONE` / `ERROR` / `WARN` / `INFO` / `DEBUG`) |
| `SMTP_MAX_RETRIES` | | Maximum retry count on transient failures |
| `SMTP_DKIM_DOMAIN` | | DKIM signing domain |
| `SMTP_DKIM_SELECTOR` | | DKIM key selector |
| `SMTP_DKIM_PRIVATE_KEY` | | DKIM private key (PKCS#8 PEM) |

Custom prefix example — `fromEnv(env, "MAIL_")` reads `MAIL_HOST`, `MAIL_PORT`, etc.

## API Reference

### WorkerMailer

```typescript
// Create a connected instance
static connect(options: WorkerMailerOptions): Promise<WorkerMailer>

// Send an email
send(options: EmailOptions): Promise<SendResult>

// Close the connection
close(): Promise<void>

// Health check via SMTP NOOP
ping(): Promise<boolean>

// Async disposal (await using)
[Symbol.asyncDispose](): Promise<void>
```

### WorkerMailerPool

Round-robin connection pool. Distributes `send()` calls across multiple connections.

```typescript
// Create a pool (default poolSize: 3)
new WorkerMailerPool(options: WorkerMailerOptions & { poolSize?: number })

// Open all connections
connect(): Promise<this>

// Send via the next connection (round-robin)
send(options: EmailOptions): Promise<SendResult>

// Health check — pings all connections
ping(): Promise<boolean>

// Close all connections
close(): Promise<void>

// Async disposal
[Symbol.asyncDispose](): Promise<void>
```

### fromEnv / createFromEnv / sendOnce

```typescript
// Parse env vars into WorkerMailerOptions
fromEnv(env: Record<string, unknown>, prefix?: string): WorkerMailerOptions

// Parse env vars and connect in one step
createFromEnv(env: Record<string, unknown>, prefix?: string): Promise<WorkerMailer>

// Parse, connect, send, and close — all in one call
sendOnce(env: Record<string, unknown>, email: EmailOptions, prefix?: string): Promise<SendResult>
```

### Provider Presets

Returns a `WorkerMailerOptions` with the provider's host/port/TLS pre-filled.
Credentials are read from `SMTP_USER` and `SMTP_PASS` in the env object.

```typescript
preset(provider: SmtpProvider, env: Record<string, unknown>): WorkerMailerOptions

type SmtpProvider = "gmail" | "outlook" | "sendgrid"

// Gmail  → smtp.gmail.com:587, STARTTLS, auth: plain
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
	continueOnError?: boolean // default: true
	concurrency?: number // default: 1 (sequential)
}

type BatchResult = {
	success: boolean
	email: EmailOptions
	result?: SendResult
	error?: Error
}
```

### validateEmail / validateEmailBatch

```typescript
validateEmail(address: string): ValidationResult
validateEmailBatch(addresses: string[]): Map<string, ValidationResult>

type ValidationResult = { valid: true } | { valid: false; reason: string }
```

## Email Options

Full `EmailOptions` type:

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
	mimeType?: string // e.g. "text/plain", "application/pdf"
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

> **Note:** Attachment content can be a base64-encoded `string`, `Uint8Array`, or `ArrayBuffer`.
> If `mimeType` is omitted, it will be inferred from the filename extension.

Example with an attachment:

```typescript
await mailer.send({
	from: "sender@example.com",
	to: "recipient@example.com",
	subject: "Invoice attached",
	text: "Please find the invoice attached.",
	attachments: [
		{
			filename: "invoice.pdf",
			content: base64EncodedString,
			mimeType: "application/pdf",
		},
	],
})
```

## Send Result

Every `send()` call returns a `SendResult`:

```typescript
type SendResult = {
	messageId: string // Message-ID assigned by the server
	accepted: string[] // Addresses accepted by the server
	rejected: string[] // Addresses rejected by the server
	responseTime: number // Round-trip time in milliseconds
	response: string // Raw SMTP response string
}
```

## Test Helper

`createTestEmail()` generates a ready-to-send email for verifying your SMTP setup:

```typescript
import { createTestEmail } from "worker-mailer"

const testEmail = createTestEmail({
	from: "sender@example.com",
	to: "recipient@example.com",
	smtpHost: "smtp.gmail.com", // optional — shown in the email body
})

await mailer.send(testEmail)
```

The generated email includes a timestamp and connection details so you can confirm delivery at a glance.

## DSN (Delivery Status Notification)

### Connection-level DSN

Set DSN options when connecting. They apply to all emails sent through that connection:

```typescript
const mailer = await WorkerMailer.connect({
	host: "smtp.example.com",
	port: 587,
	username: "user@example.com",
	password: "password",
	authType: ["plain"],
	dsn: {
		RET: { FULL: true },
		NOTIFY: { SUCCESS: true, FAILURE: true },
	},
})
```

### Per-email DSN override

Override connection-level DSN for individual emails via `dsnOverride`:

```typescript
await mailer.send({
	from: "sender@example.com",
	to: "recipient@example.com",
	subject: "Important",
	text: "Please confirm receipt.",
	dsnOverride: {
		envelopeId: "unique-envelope-id-123",
		RET: { HEADERS: true },
		NOTIFY: { SUCCESS: true, FAILURE: true, DELAY: true },
	},
})
```

## Error Handling

### `hooks.onFatalError` callback

Receive connection-level fatal errors (disconnect, reconnection failure, etc.) without wrapping every call in try/catch:

```typescript
const mailer = await WorkerMailer.connect({
	host: "smtp.example.com",
	port: 587,
	username: "user@example.com",
	password: "password",
	authType: ["plain"],
	hooks: {
		onFatalError: (error) => {
			console.error("SMTP fatal error:", error.message)
		},
		onSendError: (email, error) => {
			console.error(`Send failed for ${email.subject}:`, error.message)
		},
	},
})
```

### `maxRetries`

Automatically retry transient failures (default: `3`):

```typescript
const mailer = await WorkerMailer.connect({
	host: "smtp.example.com",
	port: 587,
	username: "user@example.com",
	password: "password",
	authType: ["plain"],
	maxRetries: 5,
})
```

### `autoReconnect`

Automatically reconnect if the underlying TCP connection is lost (default: `false`):

```typescript
const mailer = await WorkerMailer.connect({
	host: "smtp.example.com",
	port: 587,
	username: "user@example.com",
	password: "password",
	authType: ["plain"],
	autoReconnect: true,
})
```

## Connection Pool

`WorkerMailerPool` manages multiple SMTP connections and distributes sends via round-robin:

```typescript
import { WorkerMailerPool } from "worker-mailer"

const pool = new WorkerMailerPool({
	host: "smtp.example.com",
	port: 587,
	username: "user@example.com",
	password: "password",
	authType: ["plain"],
	poolSize: 5,
})

await pool.connect()

// Sends are distributed across 5 connections
await pool.send({
	from: "a@example.com",
	to: "b@example.com",
	subject: "Hi",
	text: "Hello",
})

await pool.close()
```

## Batch Sending

Send multiple emails through a single connection with concurrency control:

```typescript
import { WorkerMailer, sendBatch } from "worker-mailer"

const mailer = await WorkerMailer.connect({ /* ... */ })

const emails = [
	{ from: "noreply@example.com", to: "user1@example.com", subject: "Hello 1", text: "Hi" },
	{ from: "noreply@example.com", to: "user2@example.com", subject: "Hello 2", text: "Hi" },
	{ from: "noreply@example.com", to: "user3@example.com", subject: "Hello 3", text: "Hi" },
]

const results = await sendBatch(mailer, emails, {
	concurrency: 3, // send up to 3 emails at a time
	continueOnError: true, // don't stop on individual failures
})

for (const r of results) {
	if (r.success) {
		console.log(`✅ ${r.result!.messageId}`)
	} else {
		console.error(`❌ ${r.error!.message}`)
	}
}

await mailer.close()
```

## Using with Async Disposal

Both `WorkerMailer` and `WorkerMailerPool` implement `Symbol.asyncDispose`, so you can use `await using` for automatic cleanup:

```typescript
{
	await using mailer = await WorkerMailer.connect({ /* ... */ })

	await mailer.send({
		from: "sender@example.com",
		to: "recipient@example.com",
		subject: "Auto-cleanup",
		text: "Connection is closed automatically when this block exits.",
	})
} // mailer.close() is called automatically here
```

## WorkerMailerOptions

Full reference for all connection options:

```typescript
type WorkerMailerOptions = {
	host: string // SMTP server hostname
	port: number // SMTP server port (587, 465, etc.)
	secure?: boolean // Use TLS from the start (default: false)
	startTls?: boolean // Upgrade to TLS via STARTTLS (default: true)
	username?: string // SMTP auth username
	password?: string // SMTP auth password
	authType?: AuthType[] // ["plain"] | ["login"] | ["cram-md5"] — always an array
	logLevel?: LogLevel // NONE, ERROR, WARN, INFO, DEBUG
	dsn?: Omit<DsnOptions, "envelopeId"> // Connection-level DSN settings
	socketTimeoutMs?: number // Socket timeout in ms (default: 60000)
	responseTimeoutMs?: number // SMTP response timeout in ms (default: 30000)
	ehloHostname?: string // Custom EHLO hostname (default: host)
	maxRetries?: number // Retry count on failure (default: 3)
	autoReconnect?: boolean // Auto-reconnect on disconnect (default: false)
	hooks?: SendHooks // Send & lifecycle hooks
	dkim?: DkimOptions // DKIM signing configuration
}
```

## SMTPUTF8 (International Email Addresses)

Send emails to/from internationalized addresses (e.g. `用户@例え.jp`) per RFC 6531. Enable with the `smtpUtf8` connection option — the mailer auto-detects server SMTPUTF8 capability via EHLO and adds the `SMTPUTF8` parameter to `MAIL FROM` when needed.

```ts
import { WorkerMailer } from "worker-mailer"

const mailer = await WorkerMailer.connect({
  host: "smtp.example.com",
  port: 587,
  username: "user@example.com",
  password: "password",
  smtpUtf8: true, // Enable SMTPUTF8 support
})

await mailer.send({
  from: { name: "送信者", email: "用户@例え.jp" },
  to: "受信者@example.com",
  subject: "Hello",
  text: "International email!",
})
```

## Reply Thread Management

Build proper `In-Reply-To` and `References` headers for email threading.

```ts
import { threadHeaders } from "worker-mailer/thread"

const headers = threadHeaders({
  inReplyTo: "<original-msg-id@example.com>",
  references: "<root-msg-id@example.com>",
})
// { "In-Reply-To": "<original-msg-id@example.com>", References: "<root-msg-id@example.com> <original-msg-id@example.com>" }

await mailer.send({
  from: "sender@example.com",
  to: "recipient@example.com",
  subject: "Re: Discussion",
  text: "Reply content",
  headers,
})
```

## List-Unsubscribe Headers

Generate RFC 8058 one-click unsubscribe headers — required by Gmail and Yahoo since February 2024 for bulk senders.

```ts
import { unsubscribeHeaders } from "worker-mailer/unsubscribe"

const headers = unsubscribeHeaders({
  url: "https://example.com/unsubscribe?token=abc123",
  mailto: "unsubscribe@example.com?subject=unsubscribe",
})
// { "List-Unsubscribe": "<https://example.com/unsubscribe?token=abc123>, <mailto:unsubscribe@example.com?subject=unsubscribe>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }

await mailer.send({
  from: "newsletter@example.com",
  to: "subscriber@example.com",
  subject: "Weekly Update",
  html: "<p>Newsletter content</p>",
  headers,
})
```

## HTML to Plain Text

Convert HTML emails to plain text automatically. Useful for generating the `text` part of multipart emails.

```ts
import { htmlToText } from "worker-mailer/html-to-text"

const html = `<h1>Hello</h1><p>Check out <a href="https://example.com">our site</a>.</p>`

// Default: 78-character word wrap, links preserved
htmlToText(html)
// "Hello\n\nCheck out our site (https://example.com)."

// Strip link URLs from output
htmlToText(html, { preserveLinks: false })
// "Hello\n\nCheck out our site."

// Custom word wrap width (or false to disable)
htmlToText(html, { wordwrap: 40 })
htmlToText(html, { wordwrap: false })
```

## Template Engine

Mustache-like template engine with HTML auto-escaping. Supports variables, sections, and raw output.

```ts
import { render, compile } from "worker-mailer/template"

// Simple variable substitution (HTML-escaped by default)
render("Hello, {{name}}!", { name: "Alice" })
// "Hello, Alice!"

// Raw output with triple braces (no escaping)
render("Hello, {{{html}}}!", { html: "<b>World</b>" })
// "Hello, <b>World</b>!"

// Sections — conditionally render blocks
render("{{#premium}}Welcome, premium user!{{/premium}}", { premium: true })
// "Welcome, premium user!"

// Sections — iterate over arrays
render("{{#items}}- {{name}}\n{{/items}}", { items: [{ name: "A" }, { name: "B" }] })
// "- A\n- B\n"

// Pre-compile for repeated use
const template = compile("Hello, {{name}}!")
template({ name: "Alice" }) // "Hello, Alice!"
template({ name: "Bob" })   // "Hello, Bob!"
```

## Mail Builder API

Fluent builder API with method chaining for constructing emails programmatically.

```ts
import { MailBuilder } from "worker-mailer/builder"

const email = new MailBuilder()
  .from("sender@example.com")
  .to("recipient@example.com", "another@example.com")
  .cc({ name: "CC User", email: "cc@example.com" })
  .replyTo("replies@example.com")
  .subject("Hello from MailBuilder")
  .text("Plain text body")
  .html("<p>HTML body</p>")
  .header("X-Custom", "value")
  .attach({
    filename: "report.pdf",
    content: pdfBuffer,
    mimeType: "application/pdf",
  })
  .build()

await mailer.send(email)
```

The `.build()` method returns an `EmailOptions` object compatible with `mailer.send()`. All setter methods return `this` for chaining.

## Limitations

- **Port 25 is blocked:** Cloudflare Workers cannot make outbound connections on port 25. Use port 587 or 465 instead.
- **Connection limits:** Each Worker instance has a limit on concurrent TCP connections. Close connections when done, or use `await using` for automatic cleanup.

## Acknowledgements

This project is a fork of [zou-yu/worker-mailer](https://github.com/zou-yu/worker-mailer). Thanks to the original author for the foundational SMTP implementation on Cloudflare Workers.

## License

[MIT](./LICENSE)
