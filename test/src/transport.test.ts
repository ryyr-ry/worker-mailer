import { describe, expect, it, vi } from "vitest"
import { CrlfInjectionError, SmtpConnectionError } from "../../src/errors"
import Logger, { LogLevel } from "../../src/logger"
import { SmtpTransport } from "../../src/mailer/transport"

const logger = new Logger(LogLevel.NONE, "[test]")

function mockSocket(reads: Array<{ value?: Uint8Array; done?: boolean }>) {
let idx = 0
const reader = {
read: vi.fn().mockImplementation(() =>
idx < reads.length ? Promise.resolve(reads[idx++]) : Promise.resolve({ done: true }),
),
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
return { socket, reader, writer }
}

const enc = (s: string) => new TextEncoder().encode(s)

describe("SmtpTransport (RFC 5321)", () => {
it("read parses multi-line SMTP response (RFC 5321 Section 4.2)", async () => {
const { socket } = mockSocket([
{ value: enc("250-smtp.example.com\r\n250-AUTH PLAIN\r\n250 OK\r\n") },
])
const transport = new SmtpTransport(socket as never, logger, 5000)
const response = await transport.read()
expect(response).toContain("250-smtp.example.com")
expect(response).toContain("250 OK")
})

it("read detects end of response when last line has no dash", async () => {
const { socket } = mockSocket([
{ value: enc("250-line1\r\n") },
{ value: enc("250 done\r\n") },
])
const transport = new SmtpTransport(socket as never, logger, 5000)
const response = await transport.read()
expect(response).toContain("250 done")
})

it("writeLine appends CRLF (RFC 5321 Section 2.3.8)", async () => {
const { socket, writer } = mockSocket([])
const transport = new SmtpTransport(socket as never, logger, 5000)
await transport.writeLine("EHLO test")
expect(writer.write).toHaveBeenCalledWith(enc("EHLO test\r\n"))
})

it("writeLine rejects CRLF in command (SMTP command injection prevention)", async () => {
const { socket } = mockSocket([])
const transport = new SmtpTransport(socket as never, logger, 5000)
await expect(transport.writeLine("EHLO test\r\nMAIL FROM:<evil>")).rejects.toThrow(
CrlfInjectionError,
)
})

it("read throws SmtpConnectionError when connection closes", async () => {
const { socket } = mockSocket([{ done: true }])
const transport = new SmtpTransport(socket as never, logger, 5000)
await expect(transport.read()).rejects.toThrow(SmtpConnectionError)
})

it("upgradeTls switches to TLS socket (RFC 3207)", () => {
const { socket } = mockSocket([])
const transport = new SmtpTransport(socket as never, logger, 5000)
expect(() => transport.upgradeTls()).not.toThrow()
expect(socket.startTls).toHaveBeenCalled()
})

it("safeClose does not throw on already-closed socket", () => {
const { socket, reader, writer } = mockSocket([])
reader.releaseLock.mockImplementation(() => { throw new Error("already released") })
const transport = new SmtpTransport(socket as never, logger, 5000)
expect(() => transport.safeClose()).not.toThrow()
})

it("quit sends QUIT command (RFC 5321 Section 4.1.1.10)", async () => {
const { socket, writer } = mockSocket([{ value: enc("221 Bye\r\n") }])
const transport = new SmtpTransport(socket as never, logger, 5000)
await transport.quit()
const calls = writer.write.mock.calls.map((c: Uint8Array[]) => new TextDecoder().decode(c[0]))
expect(calls[0]).toContain("QUIT")
})
describe("read() edge cases", () => {
it("combines response split across multiple reads", async () => {
const { socket } = mockSocket([
{ value: enc("250-line1\r\n") },
{ value: enc("250 OK\r\n") },
])
const transport = new SmtpTransport(socket as never, logger, 5000)
expect(await transport.read()).toBe("250-line1\r\n250 OK\r\n")
})

it("handles single-byte fragmentation", async () => {
const reads = [..."250 OK\r\n"].map((ch) => ({ value: enc(ch) }))
const { socket } = mockSocket(reads)
const transport = new SmtpTransport(socket as never, logger, 5000)
expect(await transport.read()).toBe("250 OK\r\n")
})

it("handles 20+ continuation lines", async () => {
const lines = Array.from({ length: 20 }, (_, i) => `250-ext${i}\r\n`)
lines.push("250 OK\r\n")
const { socket } = mockSocket([{ value: enc(lines.join("")) }])
const transport = new SmtpTransport(socket as never, logger, 5000)
expect((await transport.read()).split("\r\n").length).toBe(22)
})

it("skips empty value and continues reading", async () => {
const { socket } = mockSocket([
{ value: undefined },
{ value: enc("220 ready\r\n") },
])
const transport = new SmtpTransport(socket as never, logger, 5000)
expect(await transport.read()).toBe("220 ready\r\n")
})

it("throws SmtpConnectionError when connection closes mid-response", async () => {
const { socket } = mockSocket([{ value: enc("250-partial") }, { done: true }])
const transport = new SmtpTransport(socket as never, logger, 5000)
await expect(transport.read()).rejects.toThrow(SmtpConnectionError)
})

it("buffers partial line until CRLF arrives", async () => {
const { socket } = mockSocket([{ value: enc("250 OK") }, { value: enc("\r\n") }])
const transport = new SmtpTransport(socket as never, logger, 5000)
expect(await transport.read()).toBe("250 OK\r\n")
})

it("returns full response with mixed status codes across lines", async () => {
const { socket } = mockSocket([{ value: enc("250-line1\r\n354 data\r\n") }])
const transport = new SmtpTransport(socket as never, logger, 5000)
expect(await transport.read()).toBe("250-line1\r\n354 data\r\n")
})
})

describe("writeLine() edge cases", () => {
it("rejects line containing lone LF", async () => {
const { socket } = mockSocket([])
const transport = new SmtpTransport(socket as never, logger, 5000)
await expect(transport.writeLine("EHLO\ntest")).rejects.toThrow(CrlfInjectionError)
})

it("rejects line containing lone CR", async () => {
const { socket } = mockSocket([])
const transport = new SmtpTransport(socket as never, logger, 5000)
await expect(transport.writeLine("EHLO\rtest")).rejects.toThrow(CrlfInjectionError)
})

it("writes CRLF for empty string input", async () => {
const { socket, writer } = mockSocket([])
const transport = new SmtpTransport(socket as never, logger, 5000)
await transport.writeLine("")
expect(writer.write).toHaveBeenCalledWith(enc("\r\n"))
})
})

describe("write() raw data", () => {
it("writes data without appending CRLF", async () => {
const { socket, writer } = mockSocket([])
const transport = new SmtpTransport(socket as never, logger, 5000)
await transport.write("raw data")
expect(writer.write).toHaveBeenCalledWith(enc("raw data"))
})

it("writes large payload correctly", async () => {
const { socket, writer } = mockSocket([])
const transport = new SmtpTransport(socket as never, logger, 5000)
const large = "X".repeat(10000)
await transport.write(large)
expect(writer.write).toHaveBeenCalledWith(enc(large))
})
})

describe("readTimeout()", () => {
it("returns response within timeout", async () => {
const { socket } = mockSocket([{ value: enc("220 ready\r\n") }])
const transport = new SmtpTransport(socket as never, logger, 5000)
expect(await transport.readTimeout()).toBe("220 ready\r\n")
})

it("throws SmtpConnectionError when response exceeds timeout", async () => {
const reader = { read: () => new Promise(() => {}), releaseLock: vi.fn() }
const writer = { write: vi.fn(), releaseLock: vi.fn() }
const socket = {
readable: { getReader: () => reader }, writable: { getWriter: () => writer },
opened: Promise.resolve(), close: vi.fn(), startTls: vi.fn(),
}
const transport = new SmtpTransport(socket as never, logger, 50)
await expect(transport.readTimeout()).rejects.toThrow(SmtpConnectionError)
})
})

describe("safeClose() idempotency", () => {
it("handles multiple calls without throwing", () => {
const { socket, reader, writer } = mockSocket([])
reader.releaseLock.mockImplementationOnce(() => {}).mockImplementation(() => { throw new Error() })
writer.releaseLock.mockImplementationOnce(() => {}).mockImplementation(() => { throw new Error() })
const transport = new SmtpTransport(socket as never, logger, 5000)
expect(() => transport.safeClose()).not.toThrow()
expect(() => transport.safeClose()).not.toThrow()
})
})

describe("upgradeTls()", () => {
it("releases locks and creates new reader/writer from TLS socket", () => {
const { socket, reader, writer } = mockSocket([])
const transport = new SmtpTransport(socket as never, logger, 5000)
transport.upgradeTls()
expect(reader.releaseLock).toHaveBeenCalled()
expect(writer.releaseLock).toHaveBeenCalled()
expect(socket.startTls).toHaveBeenCalled()
})

it("can read from upgraded TLS socket", async () => {
const tlsReader = {
read: vi.fn().mockResolvedValue({ value: enc("220 TLS ready\r\n") }),
releaseLock: vi.fn(),
}
const { socket, writer } = mockSocket([])
socket.startTls.mockReturnValue({
readable: { getReader: () => tlsReader },
writable: { getWriter: () => writer },
})
const transport = new SmtpTransport(socket as never, logger, 5000)
transport.upgradeTls()
expect(await transport.read()).toBe("220 TLS ready\r\n")
})
})

describe("quit() error handling", () => {
it("does not throw when socket.close() rejects", async () => {
const { socket } = mockSocket([{ value: enc("221 Bye\r\n") }])
socket.close.mockRejectedValue(new Error("close failed"))
const transport = new SmtpTransport(socket as never, logger, 5000)
await expect(transport.quit()).resolves.toBeUndefined()
})
})
})
