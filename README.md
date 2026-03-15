# worker-mailer

[English](./README.md) | [日本語](./README_ja.md)

[![npm version](https://badge.fury.io/js/worker-mailer.svg)](https://badge.fury.io/js/worker-mailer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A lightweight, zero-dependency SMTP mailer for **Cloudflare Workers**.
Built entirely on the [`cloudflare:sockets`](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) TCP API — no Node.js polyfills required beyond the compatibility flag.

## Features

- 🚀 **Zero dependencies** — runs natively on the Cloudflare Workers runtime
- 📝 **Full TypeScript support** — every API is fully typed
- 📧 **Plain text, HTML & attachments** — with automatic MIME type inference
- 🔒 **SMTP auth** — `plain`, `login`, and `CRAM-MD5`
- ⚡ **Zero-config helpers** — `sendOnce()`, `fromEnv()`, `createFromEnv()` read env vars automatically
- 🏷️ **Provider presets** — Gmail, Outlook, SendGrid one-liners
- 📦 **Batch sending** — `sendBatch()` with concurrency control and error handling
- 🔄 **Connection pool** — `WorkerMailerPool` with round-robin distribution
- 🎨 **HTML email templates** — built-in `EmailTemplate` helpers and `html` template literal tag
- ✅ **Email validation** — `validateEmail()` and `validateEmailBatch()`
- 📬 **DSN (Delivery Status Notification)** — connection-level and per-email overrides
- 🔁 **Auto-reconnect & retries** — `autoReconnect` and `maxRetries` options
- 📊 **Structured results** — `SendResult` with `messageId`, `accepted`, `rejected`, `responseTime`
- 🧹 **Async disposal** — `Symbol.asyncDispose` / `await using` support

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
import { WorkerMailer, gmailPreset } from "worker-mailer"

const mailer = await WorkerMailer.connect(gmailPreset(env))

await mailer.send({
  from: "you@gmail.com",
  to: "friend@example.com",
  subject: "Sent via Gmail",
  text: "Hello from Cloudflare Workers!",
})

await mailer.close()
```

### Standard usage

Full control over the connection lifecycle:

```typescript
import { WorkerMailer } from "worker-mailer"

const mailer = await WorkerMailer.connect({
  host: "smtp.example.com",
  port: 587,
  secure: false,
  startTls: true,
  credentials: {
    username: "user@example.com",
    password: "app-password",
  },
  authType: "plain",
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

console.log(result.messageId)    // "<...@example.com>"
console.log(result.accepted)     // ["alice@example.com", "bob@example.com"]
console.log(result.responseTime) // 230  (ms)

await mailer.close()
```

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

Each preset returns a `WorkerMailerOptions` with the provider's host/port/TLS pre-filled.
Credentials are read from `SMTP_USER` and `SMTP_PASS` in the env object.

```typescript
gmailPreset(env: Record<string, unknown>): WorkerMailerOptions
// → smtp.gmail.com:587, STARTTLS, auth: plain

outlookPreset(env: Record<string, unknown>): WorkerMailerOptions
// → smtp.office365.com:587, STARTTLS, auth: plain

sendgridPreset(env: Record<string, unknown>): WorkerMailerOptions
// → smtp.sendgrid.net:587, STARTTLS, auth: plain
```

### sendBatch

```typescript
sendBatch(
  mailer: WorkerMailer,
  emails: EmailOptions[],
  options?: BatchOptions,
): Promise<BatchResult[]>
```

```typescript
type BatchOptions = {
  continueOnError?: boolean  // default: true
  concurrency?: number       // default: 1 (sequential)
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
  attachments?: {
    filename: string
    content: string | Uint8Array | ArrayBuffer
    mimeType?: string   // e.g. "text/plain", "application/pdf"
  }[]
  dsnOverride?: {
    envelopeId?: string
    RET?: { HEADERS?: boolean; FULL?: boolean }
    NOTIFY?: { DELAY?: boolean; FAILURE?: boolean; SUCCESS?: boolean }
  }
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
  messageId: string    // Message-ID assigned by the server
  accepted: string[]   // Addresses accepted by the server
  rejected: string[]   // Addresses rejected by the server
  responseTime: number // Round-trip time in milliseconds
  response: string     // Raw SMTP response string
}
```

## Templates

### Built-in Templates (`EmailTemplate`)

Four ready-made, responsive HTML email templates with dark-mode support:

```typescript
import { EmailTemplate } from "worker-mailer"

// Email verification with a code
const verifyHtml = EmailTemplate.verification({
  title: "Verify Your Email",
  message: "Enter the code below to verify your account.",
  code: "847293",
  brandName: "Acme",
  brandColor: "#5865F2",
})

// Password reset with a button
const resetHtml = EmailTemplate.passwordReset({
  title: "Reset Your Password",
  message: "Click the button below to reset your password.",
  buttonText: "Reset Password",
  buttonUrl: "https://example.com/reset?token=abc123",
  expiresIn: "1 hour",
})

// Notification with action buttons
const notifyHtml = EmailTemplate.notification({
  title: "New Comment",
  message: "Someone commented on your post.",
  actions: [
    { text: "View Comment", url: "https://example.com/post/1#comment" },
  ],
})

// Simple text email
const simpleHtml = EmailTemplate.simple({
  title: "Welcome",
  body: "Thanks for joining us!",
})
```

All templates accept `EmailTemplateOptions` for branding:

```typescript
type EmailTemplateOptions = {
  brandName?: string   // Displayed in the header
  brandColor?: string  // Header background & button color (default: "#5865F2")
  footer?: string      // Footer text
  logoUrl?: string     // Logo image URL in the header
}
```

You can also use `baseLayout(title, htmlContent, options?)` to wrap any custom HTML content in the same responsive shell.

### `html` Template Literal Tag

Build custom HTML emails with a concise DSL. Interpolated values are automatically XSS-escaped:

```typescript
import { html } from "worker-mailer"

const name = "Alice"
const url = "https://example.com/verify"

const emailHtml = html`
  <heading>Welcome, ${name}!</heading>
  <text>Thanks for creating an account. Please verify your email address.</text>
  <divider />
  <button href="${url}">Verify Email</button>
  <spacer />
  <text>If you didn't create this account, you can ignore this email.</text>
`
```

Supported tags:

| Tag | Output |
|---|---|
| `<heading>…</heading>` | Styled `<h1>` |
| `<text>…</text>` | Styled `<p>` |
| `<bold>…</bold>` | `<strong>` |
| `<button href="url">…</button>` | Styled link button |
| `<divider />` | Horizontal rule |
| `<spacer />` | Vertical spacing |

## DSN (Delivery Status Notification)

### Connection-level DSN

Set DSN options when connecting. They apply to all emails sent through that connection:

```typescript
const mailer = await WorkerMailer.connect({
  host: "smtp.example.com",
  port: 587,
  credentials: { username: "user", password: "pass" },
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

### `onError` callback

Receive connection-level errors without wrapping every call in try/catch:

```typescript
const mailer = await WorkerMailer.connect({
  host: "smtp.example.com",
  port: 587,
  credentials: { username: "user", password: "pass" },
  onError: (error) => {
    console.error("SMTP error:", error.message)
  },
})
```

### `maxRetries`

Automatically retry transient failures (default: `3`):

```typescript
const mailer = await WorkerMailer.connect({
  host: "smtp.example.com",
  port: 587,
  credentials: { username: "user", password: "pass" },
  maxRetries: 5,
})
```

### `autoReconnect`

Automatically reconnect if the underlying TCP connection is lost (default: `false`):

```typescript
const mailer = await WorkerMailer.connect({
  host: "smtp.example.com",
  port: 587,
  credentials: { username: "user", password: "pass" },
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
  credentials: { username: "user", password: "pass" },
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
  concurrency: 3,        // send up to 3 emails at a time
  continueOnError: true,  // don't stop on individual failures
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
  host: string                          // SMTP server hostname
  port: number                          // SMTP server port (587, 465, etc.)
  secure?: boolean                      // Use TLS from the start (default: false)
  startTls?: boolean                    // Upgrade to TLS via STARTTLS (default: true)
  credentials?: {
    username: string
    password: string
  }
  authType?: AuthType | AuthType[]      // "plain" | "login" | "cram-md5"
  logLevel?: LogLevel                   // NONE, ERROR, WARN, INFO, DEBUG
  dsn?: {
    RET?: { HEADERS?: boolean; FULL?: boolean }
    NOTIFY?: { DELAY?: boolean; FAILURE?: boolean; SUCCESS?: boolean }
  }
  socketTimeoutMs?: number              // Socket timeout in ms (default: 10000)
  responseTimeoutMs?: number            // SMTP response timeout in ms (default: 10000)
  ehloHostname?: string                 // Custom EHLO hostname (default: host)
  maxRetries?: number                   // Retry count on failure (default: 3)
  autoReconnect?: boolean               // Auto-reconnect on disconnect (default: false)
  onError?: (error: Error) => void      // Connection-level error callback
}
```

## Limitations

- **Port 25 is blocked:** Cloudflare Workers cannot make outbound connections on port 25. Use port 587 or 465 instead.
- **Connection limits:** Each Worker instance has a limit on concurrent TCP connections. Close connections when done, or use `await using` for automatic cleanup.

## Contributing

> For major changes, please open an issue first to discuss what you would like to change.

1. Fork and clone the repository
2. Install dependencies:
   ```bash
   bun install
   ```
3. Create a branch from `develop`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
4. Run tests:
   ```bash
   bunx vitest run
   ```
5. Build:
   ```bash
   bun run build
   ```
6. Lint & format:
   ```bash
   bun run check
   ```
7. Add a changeset if your change affects the public API:
   ```bash
   bunx changeset
   ```
8. Push and open a pull request to `develop`

### Reporting Issues

When reporting issues, please include:

- `worker-mailer` version
- A clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Relevant code snippets or error messages

## License

[MIT](./LICENSE)
