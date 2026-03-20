import { describe, expect, it, vi } from "vitest"
import { SmtpAuthError } from "../../src/errors"
import Logger, { LogLevel } from "../../src/logger"
import { authenticate } from "../../src/mailer/auth"
import type { SmtpCapabilities } from "../../src/mailer/types"

function mockTransport() {
	return {
		writeLine: vi.fn().mockResolvedValue(undefined),
		readTimeout: vi.fn(),
		write: vi.fn(),
		read: vi.fn(),
		upgradeTls: vi.fn(),
		quit: vi.fn(),
		safeClose: vi.fn(),
		waitForOpen: vi.fn(),
	}
}

function caps(overrides?: Partial<SmtpCapabilities>): SmtpCapabilities {
	return {
		supportsDSN: false,
		allowAuth: true,
		authTypeSupported: ["plain", "login"],
		supportsStartTls: false,
		supportsSmtpUtf8: false,
		...overrides,
	}
}

const logger = new Logger(LogLevel.NONE, "[test]")

describe("SMTP Authentication (RFC 4954)", () => {
	it("AUTH PLAIN sends base64(NUL + username + NUL + password)", async () => {
		const t = mockTransport()
		t.readTimeout.mockResolvedValueOnce("235 OK\r\n")
		await authenticate({
			transport: t as never,
			credentials: { username: "user", password: "pass" },
			capabilities: caps(),
			preferredTypes: ["plain"],
			logger,
		})
		const cmd = t.writeLine.mock.calls[0][0] as string
		expect(cmd).toMatch(/^AUTH PLAIN /)
		// Decode base64 to verify NUL+user+NUL+pass structure
		const b64 = cmd.replace("AUTH PLAIN ", "")
		const decoded = atob(b64)
		expect(decoded).toBe("\0user\0pass")
	})

	it("AUTH LOGIN sends username then password in sequential prompts", async () => {
		const t = mockTransport()
		t.readTimeout
			.mockResolvedValueOnce("334 VXNlcm5hbWU6\r\n")
			.mockResolvedValueOnce("334 UGFzc3dvcmQ6\r\n")
			.mockResolvedValueOnce("235 OK\r\n")
		await authenticate({
			transport: t as never,
			credentials: { username: "user", password: "pass" },
			capabilities: caps(),
			preferredTypes: ["login"],
			logger,
		})
		expect(t.writeLine).toHaveBeenCalledTimes(3)
		expect(t.writeLine.mock.calls[0][0]).toBe("AUTH LOGIN")
	})

	it("AUTH CRAM-MD5 responds to server challenge", async () => {
		const t = mockTransport()
		const challenge = btoa("test-challenge-123")
		t.readTimeout.mockResolvedValueOnce(`334 ${challenge}\r\n`).mockResolvedValueOnce("235 OK\r\n")
		await authenticate({
			transport: t as never,
			credentials: { username: "user", password: "pass" },
			capabilities: caps({ authTypeSupported: ["cram-md5"] }),
			preferredTypes: ["cram-md5"],
			logger,
		})
		expect(t.writeLine).toHaveBeenCalledTimes(2)
		expect(t.writeLine.mock.calls[0][0]).toBe("AUTH CRAM-MD5")
	})

	it("selects first matching auth type from preferred order", async () => {
		const t = mockTransport()
		// AUTH LOGIN requires 3 responses: prompt, username OK, password OK
		t.readTimeout.mockResolvedValueOnce("334 VXNlcm5hbWU6\r\n")
		t.readTimeout.mockResolvedValueOnce("334 UGFzc3dvcmQ6\r\n")
		t.readTimeout.mockResolvedValueOnce("235 OK\r\n")
		await authenticate({
			transport: t as never,
			credentials: { username: "u", password: "p" },
			capabilities: caps({ authTypeSupported: ["plain", "login"] }),
			preferredTypes: ["login", "plain"],
			logger,
		})
		expect(t.writeLine.mock.calls[0][0]).toBe("AUTH LOGIN")
	})

	it("throws SmtpAuthError on 535 response (RFC 4954 Section 6)", async () => {
		const t = mockTransport()
		t.readTimeout.mockResolvedValueOnce("535 Authentication failed\r\n")
		await expect(
			authenticate({
				transport: t as never,
				credentials: { username: "u", password: "wrong" },
				capabilities: caps(),
				preferredTypes: ["plain"],
				logger,
			}),
		).rejects.toThrow(SmtpAuthError)
	})

	it("skips auth when allowAuth is false", async () => {
		const t = mockTransport()
		await authenticate({
			transport: t as never,
			credentials: { username: "u", password: "p" },
			capabilities: caps({ allowAuth: false }),
			preferredTypes: ["plain"],
			logger,
		})
		expect(t.writeLine).not.toHaveBeenCalled()
	})

	it("throws when no supported auth method found", async () => {
		const t = mockTransport()
		await expect(
			authenticate({
				transport: t as never,
				credentials: { username: "u", password: "p" },
				capabilities: caps({ authTypeSupported: ["cram-md5"] }),
				preferredTypes: ["plain", "login"],
				logger,
			}),
		).rejects.toThrow(SmtpAuthError)
	})

	it("UTF-8 password handled safely (Workers btoa constraint)", async () => {
		const t = mockTransport()
		t.readTimeout.mockResolvedValueOnce("235 OK\r\n")
		await expect(
			authenticate({
				transport: t as never,
				credentials: { username: "user", password: "\u65E5\u672C\u8A9E\u30D1\u30B9" },
				capabilities: caps(),
				preferredTypes: ["plain"],
				logger,
			}),
		).resolves.not.toThrow()
	})

	it("LOGIN auth failure at username step throws SmtpAuthError", async () => {
		const t = mockTransport()
		t.readTimeout.mockResolvedValueOnce("535 go away\r\n")
		await expect(
			authenticate({
				transport: t as never,
				credentials: { username: "u", password: "p" },
				capabilities: caps(),
				preferredTypes: ["login"],
				logger,
			}),
		).rejects.toThrow(SmtpAuthError)
	})

	it("LOGIN auth failure at password step throws SmtpAuthError", async () => {
		const t = mockTransport()
		t.readTimeout
			.mockResolvedValueOnce("334 VXNlcm5hbWU6\r\n")
			.mockResolvedValueOnce("334 UGFzc3dvcmQ6\r\n")
			.mockResolvedValueOnce("535 wrong password\r\n")
		await expect(
			authenticate({
				transport: t as never,
				credentials: { username: "u", password: "p" },
				capabilities: caps(),
				preferredTypes: ["login"],
				logger,
			}),
		).rejects.toThrow(SmtpAuthError)
	})
})
