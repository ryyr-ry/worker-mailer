import { describe, expect, it, vi } from "vitest"
import { SmtpCommandError, SmtpConnectionError } from "../../src/errors"
import Logger, { LogLevel } from "../../src/logger"
import { greet, ehlo, parseCapabilities, startTls } from "../../src/mailer/handshake"
import { SmtpTransport } from "../../src/mailer/transport"

const logger = new Logger(LogLevel.NONE, "[test]")
const enc = (s: string) => new TextEncoder().encode(s)

function mockTransport(responses: string[]) {
	let idx = 0
	const reader = {
		read: vi.fn().mockImplementation(() =>
			idx < responses.length
				? Promise.resolve({ value: enc(responses[idx++]) })
				: Promise.resolve({ done: true }),
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
	const transport = new SmtpTransport(socket as never, logger, 5000)
	return { transport, writer, socket }
}

describe("parseCapabilities (RFC 5321 EHLO response)", () => {
	it("detects AUTH PLAIN", () => {
		const caps = parseCapabilities("250-AUTH PLAIN\r\n250 OK\r\n")
		expect(caps.allowAuth).toBe(true)
		expect(caps.authTypeSupported).toEqual(["plain"])
	})

	it("detects AUTH LOGIN", () => {
		const caps = parseCapabilities("250-AUTH LOGIN\r\n250 OK\r\n")
		expect(caps.allowAuth).toBe(true)
		expect(caps.authTypeSupported).toEqual(["login"])
	})

	it("detects AUTH CRAM-MD5", () => {
		const caps = parseCapabilities("250-AUTH CRAM-MD5\r\n250 OK\r\n")
		expect(caps.allowAuth).toBe(true)
		expect(caps.authTypeSupported).toEqual(["cram-md5"])
	})

	it("detects multiple AUTH types from single line", () => {
		const caps = parseCapabilities("250-AUTH PLAIN LOGIN CRAM-MD5\r\n250 OK\r\n")
		expect(caps.allowAuth).toBe(true)
		expect(caps.authTypeSupported).toEqual(["plain", "login", "cram-md5"])
	})

	it("detects AUTH with = separator", () => {
		const caps = parseCapabilities("250-AUTH=PLAIN LOGIN\r\n250 OK\r\n")
		expect(caps.allowAuth).toBe(true)
		expect(caps.authTypeSupported).toContain("plain")
		expect(caps.authTypeSupported).toContain("login")
	})

	it("detects AUTH case-insensitively", () => {
		const caps = parseCapabilities("250-auth plain\r\n250 OK\r\n")
		expect(caps.allowAuth).toBe(true)
		expect(caps.authTypeSupported).toEqual(["plain"])
	})

	it("detects STARTTLS", () => {
		const caps = parseCapabilities("250-STARTTLS\r\n250 OK\r\n")
		expect(caps.supportsStartTls).toBe(true)
	})

	it("detects DSN", () => {
		const caps = parseCapabilities("250-DSN\r\n250 OK\r\n")
		expect(caps.supportsDSN).toBe(true)
	})

	it("detects SMTPUTF8", () => {
		const caps = parseCapabilities("250-SMTPUTF8\r\n250 OK\r\n")
		expect(caps.supportsSmtpUtf8).toBe(true)
	})

	it("detects all capabilities combined", () => {
		const response =
			"250-smtp.example.com\r\n" +
			"250-AUTH PLAIN LOGIN CRAM-MD5\r\n" +
			"250-STARTTLS\r\n" +
			"250-DSN\r\n" +
			"250-SMTPUTF8\r\n" +
			"250 OK\r\n"
		const caps = parseCapabilities(response)
		expect(caps.allowAuth).toBe(true)
		expect(caps.authTypeSupported).toEqual(["plain", "login", "cram-md5"])
		expect(caps.supportsStartTls).toBe(true)
		expect(caps.supportsDSN).toBe(true)
		expect(caps.supportsSmtpUtf8).toBe(true)
	})

	it("returns empty capabilities for simple 250 OK", () => {
		const caps = parseCapabilities("250 OK\r\n")
		expect(caps.allowAuth).toBe(false)
		expect(caps.authTypeSupported).toEqual([])
		expect(caps.supportsStartTls).toBe(false)
		expect(caps.supportsDSN).toBe(false)
		expect(caps.supportsSmtpUtf8).toBe(false)
	})

	it("sets allowAuth=true with empty authTypeSupported for bare AUTH", () => {
		const caps = parseCapabilities("250-AUTH\r\n250 OK\r\n")
		expect(caps.allowAuth).toBe(true)
		expect(caps.authTypeSupported).toEqual([])
	})

	it("ignores unknown AUTH types but detects known ones", () => {
		const caps = parseCapabilities("250-AUTH XOAUTH2 PLAIN\r\n250 OK\r\n")
		expect(caps.allowAuth).toBe(true)
		expect(caps.authTypeSupported).toEqual(["plain"])
	})
})

describe("greet (SMTP server greeting)", () => {
	it("succeeds on 220 greeting", async () => {
		const { transport } = mockTransport(["220 smtp.example.com ESMTP\r\n"])
		await expect(greet(transport)).resolves.toBeUndefined()
	})

	it("throws SmtpConnectionError on 421 greeting", async () => {
		const { transport } = mockTransport(["421 Service not available\r\n"])
		await expect(greet(transport)).rejects.toThrow(SmtpConnectionError)
	})

	it("throws SmtpConnectionError on 500 greeting", async () => {
		const { transport } = mockTransport(["500 Error\r\n"])
		await expect(greet(transport)).rejects.toThrow(SmtpConnectionError)
	})

	it("throws on connection closed (empty response)", async () => {
		const { transport } = mockTransport([])
		await expect(greet(transport)).rejects.toThrow()
	})
})

describe("ehlo (RFC 5321 EHLO command)", () => {
	it("returns parsed capabilities on success", async () => {
		const { transport, writer } = mockTransport([
			"250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250-STARTTLS\r\n250 OK\r\n",
		])
		const caps = await ehlo(transport, "client.example.com")
		expect(caps.allowAuth).toBe(true)
		expect(caps.authTypeSupported).toContain("plain")
		expect(caps.supportsStartTls).toBe(true)
		const cmd = new TextDecoder().decode(writer.write.mock.calls[0][0])
		expect(cmd).toBe("EHLO client.example.com\r\n")
	})

	it("throws SmtpCommandError on 421 response", async () => {
		const { transport } = mockTransport(["421 Service not available\r\n"])
		await expect(ehlo(transport, "client.example.com")).rejects.toThrow(SmtpCommandError)
	})

	it("falls back to HELO on non-2xx/non-421 and returns empty capabilities", async () => {
		const { transport } = mockTransport([
			"502 Command not implemented\r\n",
			"250 OK\r\n",
		])
		const caps = await ehlo(transport, "client.example.com")
		expect(caps.allowAuth).toBe(false)
		expect(caps.authTypeSupported).toEqual([])
		expect(caps.supportsStartTls).toBe(false)
	})
})

describe("startTls (RFC 3207)", () => {
	it("succeeds on 220 response", async () => {
		const { transport, socket } = mockTransport(["220 Ready to start TLS\r\n"])
		await expect(startTls(transport)).resolves.toBeUndefined()
		expect(socket.startTls).toHaveBeenCalled()
	})

	it("throws SmtpCommandError on non-2xx response", async () => {
		const { transport } = mockTransport(["454 TLS not available\r\n"])
		await expect(startTls(transport)).rejects.toThrow(SmtpCommandError)
	})
})
