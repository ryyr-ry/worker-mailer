import { connect } from "cloudflare:sockets"
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest"
import {
ConfigurationError,
SmtpCommandError,
SmtpConnectionError,
} from "../../src/errors"
import { WorkerMailer } from "../../src/mailer"

vi.mock("cloudflare:sockets", () => ({ connect: vi.fn() }))
vi.mock("../../src/utils", async (importOriginal) => {
const mod = await importOriginal<typeof import("../../src/utils")>()
return { ...mod, backoff: () => Promise.resolve() }
})

const enc = (s: string) => new TextEncoder().encode(s)

function setupSocket(responses: string[]) {
let idx = 0
const reader: { read: Mock; releaseLock: Mock } = {
read: vi.fn().mockImplementation(() => {
if (idx < responses.length) return Promise.resolve({ value: enc(responses[idx++]) })
return new Promise(() => {})
}),
releaseLock: vi.fn(),
}
const writer = { write: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn() }
const socket = {
readable: { getReader: () => reader },
writable: { getWriter: () => writer },
opened: Promise.resolve(),
close: vi.fn().mockResolvedValue(undefined),
startTls: vi.fn().mockReturnValue({
readable: { getReader: () => reader },
writable: { getWriter: () => writer },
}),
}
vi.mocked(connect).mockReturnValue(socket as never)
return { reader, writer, socket }
}

const GREETING = "220 smtp.test.com ready\r\n"
const EHLO_STARTTLS = "250-smtp.test.com\r\n250-STARTTLS\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n"
const TLS_OK = "220 Ready to start TLS\r\n"
const EHLO_AUTH = "250-smtp.test.com\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n"
const AUTH_OK = "235 OK\r\n"
const OK = "250 OK\r\n"
const DATA_READY = "354 Go ahead\r\n"
const SEND_OK = "250 2.0.0 OK id=abc123\r\n"
const QUIT_OK = "221 Bye\r\n"

// Port 587 infers startTls: true — standard flow includes STARTTLS upgrade
const STANDARD_SESSION = [GREETING, EHLO_STARTTLS, TLS_OK, EHLO_AUTH, AUTH_OK]

const OPTS = {
host: "smtp.test.com",
port: 587,
username: "u@test.com",
password: "p",
authType: ["plain" as const],
}

async function connectMailer(extraResponses: string[] = []) {
setupSocket([...STANDARD_SESSION, ...extraResponses])
return WorkerMailer.connect(OPTS)
}

const EMAIL = { from: "a@test.com", to: "b@test.com", subject: "T", text: "hi" }

describe("WorkerMailer (RFC 5321)", () => {
beforeEach(() => vi.clearAllMocks())

it("connect establishes SMTP session with STARTTLS + EHLO + AUTH", async () => {
const { socket } = setupSocket([...STANDARD_SESSION])
const mailer = await WorkerMailer.connect(OPTS)
expect(connect).toHaveBeenCalledWith({ hostname: "smtp.test.com", port: 587 }, expect.any(Object))
expect(socket.startTls).toHaveBeenCalled()
expect(mailer).toBeInstanceOf(WorkerMailer)
mailer.close().catch(() => {})
})

it("STARTTLS upgrades then re-sends EHLO (RFC 3207 Section 4)", async () => {
const { socket, writer } = setupSocket([...STANDARD_SESSION])
const mailer = await WorkerMailer.connect(OPTS)
expect(socket.startTls).toHaveBeenCalled()
const cmds = writer.write.mock.calls.map((c: Uint8Array[]) => new TextDecoder().decode(c[0]))
const ehloCount = cmds.filter((c: string) => c.includes("EHLO")).length
expect(ehloCount).toBe(2)
mailer.close().catch(() => {})
})

it("STARTTLS required but server does not advertise — throws SmtpConnectionError", async () => {
const ehloNoTls = "250-smtp.test.com\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n"
setupSocket([GREETING, ehloNoTls])
await expect(WorkerMailer.connect(OPTS)).rejects.toThrow(
expect.objectContaining({
constructor: SmtpConnectionError,
message: expect.stringContaining("STARTTLS required"),
}),
)
})

it("credentials over plaintext connection are rejected (no secure, no startTls)", async () => {
const ehloPlain = "250-smtp.test.com\r\n250-AUTH PLAIN\r\n250 OK\r\n"
setupSocket([GREETING, ehloPlain])
const plaintextOpts = { host: "smtp.test.com", port: 25, secure: false, startTls: false, username: "u", password: "p" }
await expect(WorkerMailer.connect(plaintextOpts)).rejects.toThrow(
expect.objectContaining({
constructor: ConfigurationError,
message: expect.stringContaining("plaintext"),
}),
)
})

it("server advertises AUTH but no credentials — proceeds without auth", async () => {
const ehloAuth = "250-smtp.test.com\r\n250-STARTTLS\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n"
setupSocket([GREETING, ehloAuth, TLS_OK, EHLO_AUTH, OK])
const mailer = await WorkerMailer.connect({
host: "smtp.test.com",
port: 587,
})
const result = await mailer.ping()
expect(result).toBe(true)
mailer.close().catch(() => {})
})

it("no credentials and no AUTH advertised — connects normally", async () => {
const ehloNoAuth = "250-smtp.test.com\r\n250-STARTTLS\r\n250 OK\r\n"
const ehloNoAuth2 = "250-smtp.test.com\r\n250 OK\r\n"
setupSocket([GREETING, ehloNoAuth, TLS_OK, ehloNoAuth2, OK])
const mailer = await WorkerMailer.connect({
host: "smtp.test.com",
port: 587,
})
const result = await mailer.ping()
expect(result).toBe(true)
mailer.close().catch(() => {})
})

it("send executes MAIL FROM, RCPT TO, DATA, body, RSET (full flow)", async () => {
const { writer } = setupSocket([...STANDARD_SESSION, OK, OK, DATA_READY, SEND_OK, OK])
const mailer = await WorkerMailer.connect(OPTS)
const result = await mailer.send(EMAIL)
expect(result.messageId).toBeTruthy()
expect(result.accepted).toContain("b@test.com")
const cmds = writer.write.mock.calls.map((c: Uint8Array[]) => new TextDecoder().decode(c[0]))
expect(cmds.some((c: string) => c.includes("MAIL FROM"))).toBe(true)
expect(cmds.some((c: string) => c.includes("RCPT TO"))).toBe(true)
expect(cmds.some((c: string) => c.includes("DATA"))).toBe(true)
mailer.close().catch(() => {})
})

it("send returns SendResult with responseTime", async () => {
setupSocket([...STANDARD_SESSION, OK, OK, DATA_READY, SEND_OK, OK])
const mailer = await WorkerMailer.connect(OPTS)
const result = await mailer.send(EMAIL)
expect(result.responseTime).toBeGreaterThanOrEqual(0)
mailer.close().catch(() => {})
})

it("close sends QUIT (RFC 5321 Section 4.1.1.10)", async () => {
const { writer } = setupSocket([...STANDARD_SESSION, QUIT_OK])
const mailer = await WorkerMailer.connect(OPTS)
await mailer.close()
const cmds = writer.write.mock.calls.map((c: Uint8Array[]) => new TextDecoder().decode(c[0]))
expect(cmds.some((c: string) => c.includes("QUIT"))).toBe(true)
})

it("5xx MAIL FROM response throws SmtpCommandError (permanent failure)", async () => {
setupSocket([...STANDARD_SESSION, "550 denied\r\n", "500 err\r\n"])
const mailer = await WorkerMailer.connect(OPTS)
await expect(mailer.send(EMAIL)).rejects.toThrow(SmtpCommandError)
})

it("RCPT TO for multiple recipients", async () => {
const { writer } = setupSocket([...STANDARD_SESSION, OK, OK, OK, DATA_READY, SEND_OK, OK])
const mailer = await WorkerMailer.connect(OPTS)
await mailer.send({ ...EMAIL, to: ["x@t.com", "y@t.com"] })
const cmds = writer.write.mock.calls.map((c: Uint8Array[]) => new TextDecoder().decode(c[0]))
const rcptCmds = cmds.filter((c: string) => c.includes("RCPT TO"))
expect(rcptCmds.length).toBe(2)
mailer.close().catch(() => {})
})

it("ping returns true for live connection (NOOP)", async () => {
setupSocket([...STANDARD_SESSION, OK])
const mailer = await WorkerMailer.connect(OPTS)
const result = await mailer.ping()
expect(result).toBe(true)
mailer.close().catch(() => {})
})

it("Symbol.asyncDispose closes connection", async () => {
setupSocket([...STANDARD_SESSION, QUIT_OK])
const mailer = await WorkerMailer.connect(OPTS)
await mailer[Symbol.asyncDispose]()
await expect(
mailer.send({ from: "a@t.com", to: "b@t.com", subject: "T", text: "hi" }),
).rejects.toThrow()
})

it("CrlfInjectionError is not retried", async () => {
setupSocket([...STANDARD_SESSION])
const mailer = await WorkerMailer.connect(OPTS)
await expect(
mailer.send({ from: "evil@t.com\r\nRCPT TO:<x>", to: "b@t.com", subject: "T", text: "hi" }),
).rejects.toThrow()
mailer.close().catch(() => {})
})

it("connection timeout throws SmtpConnectionError", async () => {
const socket = {
readable: { getReader: () => ({ read: vi.fn(), releaseLock: vi.fn() }) },
writable: { getWriter: () => ({ write: vi.fn(), releaseLock: vi.fn() }) },
opened: new Promise(() => {}),
close: vi.fn(),
startTls: vi.fn(),
}
vi.mocked(connect).mockReturnValue(socket as never)
await expect(
WorkerMailer.connect({ ...OPTS, socketTimeoutMs: 50 }),
).rejects.toThrow(SmtpConnectionError)
})
})
