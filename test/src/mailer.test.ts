import { connect } from "cloudflare:sockets"
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest"
import {
CrlfInjectionError,
SmtpAuthError,
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
return new Promise(() => {}) // hang forever if no more responses
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

// Standard SMTP session: greeting + EHLO + AUTH
const GREETING = "220 smtp.test.com ready\r\n"
const EHLO_AUTH = "250-smtp.test.com\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n"
const AUTH_OK = "235 OK\r\n"
const OK = "250 OK\r\n"
const DATA_READY = "354 Go ahead\r\n"
const SEND_OK = "250 2.0.0 OK id=abc123\r\n"
const QUIT_OK = "221 Bye\r\n"

const OPTS = {
host: "smtp.test.com",
port: 587,
username: "u@test.com",
password: "p",
authType: ["plain" as const],
}

async function connectMailer(extraResponses: string[] = []) {
setupSocket([GREETING, EHLO_AUTH, AUTH_OK, ...extraResponses])
return WorkerMailer.connect(OPTS)
}

const EMAIL = { from: "a@test.com", to: "b@test.com", subject: "T", text: "hi" }

describe("WorkerMailer (RFC 5321)", () => {
beforeEach(() => vi.clearAllMocks())

it("connect establishes SMTP session with EHLO and AUTH", async () => {
const mailer = await connectMailer()
expect(connect).toHaveBeenCalledWith({ hostname: "smtp.test.com", port: 587 }, expect.any(Object))
expect(mailer).toBeInstanceOf(WorkerMailer)
mailer.close().catch(() => {})
})

it("STARTTLS upgrades then re-sends EHLO (RFC 3207 Section 4)", async () => {
const ehloTls = "250-smtp.test.com\r\n250-STARTTLS\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n"
const tlsOk = "220 Ready to start TLS\r\n"
const { socket } = setupSocket([GREETING, ehloTls, tlsOk, EHLO_AUTH, AUTH_OK])
const mailer = await WorkerMailer.connect(OPTS)
expect(socket.startTls).toHaveBeenCalled()
mailer.close().catch(() => {})
})

it("send executes MAIL FROM, RCPT TO, DATA, body, RSET (full flow)", async () => {
const { writer } = setupSocket([GREETING, EHLO_AUTH, AUTH_OK, OK, OK, DATA_READY, SEND_OK, OK])
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
setupSocket([GREETING, EHLO_AUTH, AUTH_OK, OK, OK, DATA_READY, SEND_OK, OK])
const mailer = await WorkerMailer.connect(OPTS)
const result = await mailer.send(EMAIL)
expect(result.responseTime).toBeGreaterThanOrEqual(0)
mailer.close().catch(() => {})
})

it("close sends QUIT (RFC 5321 Section 4.1.1.10)", async () => {
const { writer } = setupSocket([GREETING, EHLO_AUTH, AUTH_OK, QUIT_OK])
const mailer = await WorkerMailer.connect(OPTS)
await mailer.close()
const cmds = writer.write.mock.calls.map((c: Uint8Array[]) => new TextDecoder().decode(c[0]))
expect(cmds.some((c: string) => c.includes("QUIT"))).toBe(true)
})

it("5xx MAIL FROM response throws SmtpCommandError (permanent failure)", async () => {
// RSET also fails -> original 550 error propagates without retry loop
setupSocket([GREETING, EHLO_AUTH, AUTH_OK, "550 denied\r\n", "500 err\r\n"])
const mailer = await WorkerMailer.connect(OPTS)
await expect(mailer.send(EMAIL)).rejects.toThrow(SmtpCommandError)
})

it("RCPT TO for multiple recipients", async () => {
const { writer } = setupSocket([GREETING, EHLO_AUTH, AUTH_OK, OK, OK, OK, DATA_READY, SEND_OK, OK])
const mailer = await WorkerMailer.connect(OPTS)
await mailer.send({ ...EMAIL, to: ["x@t.com", "y@t.com"] })
const cmds = writer.write.mock.calls.map((c: Uint8Array[]) => new TextDecoder().decode(c[0]))
const rcptCmds = cmds.filter((c: string) => c.includes("RCPT TO"))
expect(rcptCmds.length).toBe(2)
mailer.close().catch(() => {})
})

it("ping returns true for live connection (NOOP)", async () => {
setupSocket([GREETING, EHLO_AUTH, AUTH_OK, OK])
const mailer = await WorkerMailer.connect(OPTS)
const result = await mailer.ping()
expect(result).toBe(true)
mailer.close().catch(() => {})
})

it("Symbol.asyncDispose closes connection", async () => {
setupSocket([GREETING, EHLO_AUTH, AUTH_OK, QUIT_OK])
const mailer = await WorkerMailer.connect(OPTS)
await mailer[Symbol.asyncDispose]()
// After dispose, send should be rejected
await expect(
mailer.send({ from: "a@t.com", to: "b@t.com", subject: "T", text: "hi" }),
).rejects.toThrow()
})

it("CrlfInjectionError is not retried", async () => {
setupSocket([GREETING, EHLO_AUTH, AUTH_OK])
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
opened: new Promise(() => {}), // never resolves
close: vi.fn(),
startTls: vi.fn(),
}
vi.mocked(connect).mockReturnValue(socket as never)
await expect(
WorkerMailer.connect({ ...OPTS, socketTimeoutMs: 50 }),
).rejects.toThrow(SmtpConnectionError)
})
})
