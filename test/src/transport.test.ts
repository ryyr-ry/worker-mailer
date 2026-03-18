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
})
