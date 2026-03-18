import { connect } from "cloudflare:sockets"
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest"
import { WorkerMailer } from "../../src/mailer"
import type { SendHooks } from "../../src/mailer/types"

vi.mock("cloudflare:sockets", () => ({ connect: vi.fn() }))
vi.mock("../../src/utils", async (importOriginal) => {
const mod = await importOriginal<typeof import("../../src/utils")>()
return { ...mod, backoff: () => Promise.resolve() }
})

const enc = (s: string) => new TextEncoder().encode(s)
const GREETING = "220 ready\r\n"
const EHLO = "250-test\r\n250-AUTH PLAIN\r\n250 OK\r\n"
const AUTH_OK = "235 OK\r\n"
const OK = "250 OK\r\n"
const DATA_READY = "354 Go\r\n"
const SEND_OK = "250 2.0.0 OK id=1\r\n"
const QUIT_OK = "221 Bye\r\n"
const EMAIL = { from: "a@t.com", to: "b@t.com", subject: "T", text: "hi" }

function setup(responses: string[]) {
let idx = 0
const reader: { read: Mock; releaseLock: Mock } = {
read: vi.fn().mockImplementation(() =>
idx < responses.length ? Promise.resolve({ value: enc(responses[idx++]) }) : new Promise(() => {}),
),
releaseLock: vi.fn(),
}
const writer = { write: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn() }
const socket = {
readable: { getReader: () => reader },
writable: { getWriter: () => writer },
opened: Promise.resolve(),
close: vi.fn().mockResolvedValue(undefined),
startTls: vi.fn(),
}
vi.mocked(connect).mockReturnValue(socket as never)
return { reader, writer, socket }
}

const BASE_OPTS = {
host: "smtp.test.com",
port: 587,
username: "u@t.com",
password: "p",
authType: ["plain" as const],
}

describe("SendHooks", () => {
beforeEach(() => vi.clearAllMocks())

it("beforeSend called before SMTP commands", async () => {
const order: string[] = []
const hooks: SendHooks = {
beforeSend: vi.fn().mockImplementation(() => { order.push("hook") }),
}
setup([GREETING, EHLO, AUTH_OK, OK, OK, DATA_READY, SEND_OK, OK])
const mailer = await WorkerMailer.connect({ ...BASE_OPTS, hooks })
await mailer.send(EMAIL)
expect(hooks.beforeSend).toHaveBeenCalledTimes(1)
mailer.close().catch(() => {})
})

it("beforeSend can cancel send via returning false", async () => {
const hooks: SendHooks = {
beforeSend: vi.fn().mockResolvedValue(false),
}
setup([GREETING, EHLO, AUTH_OK])
const mailer = await WorkerMailer.connect({ ...BASE_OPTS, hooks })
await expect(mailer.send(EMAIL)).rejects.toThrow()
mailer.close().catch(() => {})
})

it("afterSend called with SendResult on success", async () => {
const hooks: SendHooks = { afterSend: vi.fn() }
setup([GREETING, EHLO, AUTH_OK, OK, OK, DATA_READY, SEND_OK, OK])
const mailer = await WorkerMailer.connect({ ...BASE_OPTS, hooks })
await mailer.send(EMAIL)
expect(hooks.afterSend).toHaveBeenCalledTimes(1)
expect(hooks.afterSend).toHaveBeenCalledWith(
expect.objectContaining({ from: "a@t.com" }),
expect.objectContaining({ messageId: expect.any(String) }),
)
mailer.close().catch(() => {})
})

it("onSendError called on send failure", async () => {
const hooks: SendHooks = { onSendError: vi.fn() }
// 550 MAIL FROM -> RSET OK -> maxRetries exceeded -> onSendError called
setup([GREETING, EHLO, AUTH_OK, "550 denied\r\n", OK])
const mailer = await WorkerMailer.connect({ ...BASE_OPTS, hooks, maxRetries: 0 })
await expect(mailer.send(EMAIL)).rejects.toThrow()
expect(hooks.onSendError).toHaveBeenCalledTimes(1)
})

it("onSendError called for non-retryable ConfigurationError (P2 fix)", async () => {
// DSN envelopeId with space passes Email constructor but throws ConfigurationError in commands
const hooks: SendHooks = { onSendError: vi.fn() }
const EHLO_DSN = "250-test\r\n250-AUTH PLAIN\r\n250-DSN\r\n250 OK\r\n"
setup([GREETING, EHLO_DSN, AUTH_OK])
const mailer = await WorkerMailer.connect({ ...BASE_OPTS, hooks })
await expect(
mailer.send({ ...EMAIL, dsnOverride: { envelopeId: "id with space" } }),
).rejects.toThrow()
expect(hooks.onSendError).toHaveBeenCalled()
mailer.close().catch(() => {})
})

it("onConnected called after successful connection", async () => {
const hooks: SendHooks = { onConnected: vi.fn() }
setup([GREETING, EHLO, AUTH_OK])
await WorkerMailer.connect({ ...BASE_OPTS, hooks })
expect(hooks.onConnected).toHaveBeenCalledTimes(1)
})

it("hook error does not break send flow", async () => {
const hooks: SendHooks = {
afterSend: vi.fn().mockRejectedValue(new Error("hook crash")),
}
setup([GREETING, EHLO, AUTH_OK, OK, OK, DATA_READY, SEND_OK, OK])
const mailer = await WorkerMailer.connect({ ...BASE_OPTS, hooks })
// Send should succeed despite afterSend hook throwing
const result = await mailer.send(EMAIL)
expect(result.messageId).toBeTruthy()
mailer.close().catch(() => {})
})

it("no hooks configured: send works normally", async () => {
setup([GREETING, EHLO, AUTH_OK, OK, OK, DATA_READY, SEND_OK, OK])
const mailer = await WorkerMailer.connect(BASE_OPTS)
const result = await mailer.send(EMAIL)
expect(result.messageId).toBeTruthy()
mailer.close().catch(() => {})
})
})
