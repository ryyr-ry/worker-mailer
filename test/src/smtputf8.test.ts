import { describe, expect, it, vi } from "vitest"
import { hasNonAscii, mailFrom } from "../../src/mailer/commands"
import type { SmtpCapabilities } from "../../src/mailer/types"

function mockTransport() {
	return {
		writeLine: vi.fn().mockResolvedValue(undefined),
		readTimeout: vi.fn().mockResolvedValue("250 OK\r\n"),
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
		allowAuth: false,
		authTypeSupported: [],
		supportsStartTls: false,
		supportsSmtpUtf8: false,
		...overrides,
	}
}

describe("hasNonAscii (RFC 6531)", () => {
	it("returns false for ASCII-only address", () => {
		expect(hasNonAscii("user@example.com")).toBe(false)
	})

	it("detects non-ASCII in local part", () => {
		expect(hasNonAscii("\u7530\u4E2D@example.com")).toBe(true)
	})

	it("detects non-ASCII in domain", () => {
		expect(hasNonAscii("user@\u30E1\u30FC\u30EB.jp")).toBe(true)
	})

	it("detects non-ASCII in both parts", () => {
		expect(hasNonAscii("\u7530\u4E2D@\u30E1\u30FC\u30EB.jp")).toBe(true)
	})
})

describe("MAIL FROM with SMTPUTF8 (RFC 6531 Section 3.3)", () => {
	it("includes SMTPUTF8 param when smtpUtf8=true and server supports it", async () => {
		const t = mockTransport()
		await mailFrom({
			transport: t as never,
			fromEmail: "\u7530\u4E2D@example.com",
			capabilities: caps({ supportsSmtpUtf8: true }),
			smtpUtf8: true,
		})
		const cmd = t.writeLine.mock.calls[0][0] as string
		expect(cmd).toContain("SMTPUTF8")
	})

	it("omits SMTPUTF8 when server does not support it", async () => {
		const t = mockTransport()
		await mailFrom({
			transport: t as never,
			fromEmail: "\u7530\u4E2D@example.com",
			capabilities: caps({ supportsSmtpUtf8: false }),
			smtpUtf8: true,
		})
		const cmd = t.writeLine.mock.calls[0][0] as string
		expect(cmd).not.toContain("SMTPUTF8")
	})

	it("omits SMTPUTF8 when smtpUtf8=false even if server supports it", async () => {
		const t = mockTransport()
		await mailFrom({
			transport: t as never,
			fromEmail: "user@example.com",
			capabilities: caps({ supportsSmtpUtf8: true }),
			smtpUtf8: false,
		})
		const cmd = t.writeLine.mock.calls[0][0] as string
		expect(cmd).not.toContain("SMTPUTF8")
	})

	it("MAIL FROM command format is correct", async () => {
		const t = mockTransport()
		await mailFrom({
			transport: t as never,
			fromEmail: "sender@example.com",
			capabilities: caps(),
		})
		const cmd = t.writeLine.mock.calls[0][0] as string
		expect(cmd).toMatch(/^MAIL FROM: <sender@example\.com>/)
	})

	it("Japanese email address with SMTPUTF8 (full integration)", async () => {
		const t = mockTransport()
		await mailFrom({
			transport: t as never,
			fromEmail: "\u7530\u4E2D@\u30C6\u30B9\u30C8.jp",
			capabilities: caps({ supportsSmtpUtf8: true }),
			smtpUtf8: true,
		})
		const cmd = t.writeLine.mock.calls[0][0] as string
		expect(cmd).toContain("\u7530\u4E2D@\u30C6\u30B9\u30C8.jp")
		expect(cmd).toContain("SMTPUTF8")
	})

	it("ASCII address never triggers SMTPUTF8", async () => {
		const t = mockTransport()
		await mailFrom({
			transport: t as never,
			fromEmail: "normal@example.com",
			capabilities: caps({ supportsSmtpUtf8: true }),
		})
		const cmd = t.writeLine.mock.calls[0][0] as string
		expect(cmd).not.toContain("SMTPUTF8")
	})
})
