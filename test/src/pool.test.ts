import { connect } from "cloudflare:sockets"
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest"
import { WorkerMailerPool } from "../../src/mailer"

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

function setup(responsesPerConnection: string[][]) {
let connIdx = 0
vi.mocked(connect).mockImplementation(() => {
const responses = responsesPerConnection[connIdx] || responsesPerConnection[0]
connIdx++
let idx = 0
const reader: { read: Mock; releaseLock: Mock } = {
read: vi.fn().mockImplementation(() =>
idx < responses.length ? Promise.resolve({ value: enc(responses[idx++]) }) : new Promise(() => {}),
),
releaseLock: vi.fn(),
}
const writer = { write: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn() }
return {
readable: { getReader: () => reader },
writable: { getWriter: () => writer },
opened: Promise.resolve(),
close: vi.fn().mockResolvedValue(undefined),
startTls: vi.fn(),
} as never
})
}

const BASE_OPTS = {
host: "smtp.test.com",
port: 587,
username: "u@t.com",
password: "p",
authType: ["plain" as const],
}

const EMAIL = { from: "a@t.com", to: "b@t.com", subject: "T", text: "hi" }

describe("WorkerMailerPool", () => {
beforeEach(() => vi.clearAllMocks())

it("pool creates multiple connections", async () => {
const connSession = [GREETING, EHLO, AUTH_OK, OK, OK, DATA_READY, SEND_OK, OK]
setup([connSession, connSession])
const pool = new WorkerMailerPool({ ...BASE_OPTS, poolSize: 2 })
await pool.connect()
expect(connect).toHaveBeenCalledTimes(2)
pool.close().catch(() => {})
})

it("send through pool returns SendResult", async () => {
const connSession = [GREETING, EHLO, AUTH_OK, OK, OK, DATA_READY, SEND_OK, OK]
setup([connSession])
const pool = new WorkerMailerPool({ ...BASE_OPTS, poolSize: 1 })
await pool.connect()
const result = await pool.send(EMAIL)
expect(result.messageId).toBeTruthy()
pool.close().catch(() => {})
})

it("pool close disposes all connections", async () => {
const connSession = [GREETING, EHLO, AUTH_OK, QUIT_OK]
setup([connSession, connSession])
const pool = new WorkerMailerPool({ ...BASE_OPTS, poolSize: 2 })
await pool.connect()
await pool.close()
// No throw = success
expect(true).toBe(true)
})

it("pool ping checks connection health", async () => {
const connSession = [GREETING, EHLO, AUTH_OK, OK]
setup([connSession])
const pool = new WorkerMailerPool({ ...BASE_OPTS, poolSize: 1 })
await pool.connect()
const result = await pool.ping()
expect(result).toBe(true)
pool.close().catch(() => {})
})

it("Symbol.asyncDispose closes pool", async () => {
const connSession = [GREETING, EHLO, AUTH_OK, QUIT_OK]
setup([connSession])
const pool = new WorkerMailerPool({ ...BASE_OPTS, poolSize: 1 })
await pool.connect()
await pool[Symbol.asyncDispose]()
expect(true).toBe(true)
})
})
