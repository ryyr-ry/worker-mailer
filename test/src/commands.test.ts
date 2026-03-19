import { describe, expect, it, vi } from "vitest"
import { ConfigurationError, CrlfInjectionError, SmtpCommandError } from "../../src/errors"
import Logger, { LogLevel } from "../../src/logger"
import {
	buildNotify,
	buildRet,
	dataCommand,
	hasNonAscii,
	mailFrom,
	noop,
	rcptTo,
	rset,
	sendBody,
} from "../../src/mailer/commands"
import { SmtpTransport } from "../../src/mailer/transport"
import type { SmtpCapabilities } from "../../src/mailer/types"

const logger = new Logger(LogLevel.NONE, "[test]")
const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)

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
		startTls: vi.fn(),
	}
	const transport = new SmtpTransport(socket as never, logger, 5000)
	return { transport, writer }
}

const baseCaps: SmtpCapabilities = {
	supportsDSN: false,
	allowAuth: false,
	authTypeSupported: [],
	supportsStartTls: false,
	supportsSmtpUtf8: false,
}
const writtenLines = (w: { write: ReturnType<typeof vi.fn> }) =>
	w.write.mock.calls.map((c: Uint8Array[]) => dec(c[0]))

describe("hasNonAscii", () => {
	it("returns false for ASCII-only string", () => expect(hasNonAscii("hello")).toBe(false))
	it("returns false for empty string", () => expect(hasNonAscii("")).toBe(false))
	it("returns true for non-ASCII characters", () => expect(hasNonAscii("こんにちは")).toBe(true))
	it("returns true for mixed ASCII and non-ASCII", () => expect(hasNonAscii("hi日本")).toBe(true))
})

describe("buildRet", () => {
	it("returns empty string when no DSN options", () => expect(buildRet()).toBe(""))
	it("returns empty string when RET is undefined", () => expect(buildRet({})).toBe(""))
	it("returns RET=FULL", () => expect(buildRet({ RET: { FULL: true } })).toBe("RET=FULL"))
	it("returns RET=HDRS", () => expect(buildRet({ RET: { HEADERS: true } })).toBe("RET=HDRS"))
	it("override takes precedence over global", () => {
		expect(buildRet({ RET: { FULL: true } }, { RET: { HEADERS: true } })).toBe("RET=HDRS")
	})
	it("falls back to global when override has no RET", () => {
		expect(buildRet({ RET: { FULL: true } }, {})).toBe("RET=FULL")
	})
	it("throws ConfigurationError when both FULL and HEADERS are true (RFC 3461)", () => {
		expect(() => buildRet({ RET: { FULL: true, HEADERS: true } })).toThrow(
			"RET cannot specify both FULL and HEADERS",
		)
	})
})

describe("buildNotify", () => {
	it("returns NOTIFY=NEVER when no flags set", () => expect(buildNotify()).toBe(" NOTIFY=NEVER"))
	it("returns NOTIFY=SUCCESS", () => {
		expect(buildNotify({ NOTIFY: { SUCCESS: true } })).toBe(" NOTIFY=SUCCESS")
	})
	it("returns NOTIFY=FAILURE", () => {
		expect(buildNotify({ NOTIFY: { FAILURE: true } })).toBe(" NOTIFY=FAILURE")
	})
	it("returns NOTIFY=DELAY", () => {
		expect(buildNotify({ NOTIFY: { DELAY: true } })).toBe(" NOTIFY=DELAY")
	})
	it("returns combined flags in order", () => {
		const dsn = { NOTIFY: { SUCCESS: true, FAILURE: true, DELAY: true } }
		expect(buildNotify(dsn)).toBe(" NOTIFY=SUCCESS,FAILURE,DELAY")
	})
	it("override takes precedence over global", () => {
		const global = { NOTIFY: { SUCCESS: true, FAILURE: true } }
		const override = { NOTIFY: { DELAY: true } }
		expect(buildNotify(global, override)).toBe(" NOTIFY=DELAY")
	})
	it("falls back to global when override has no NOTIFY", () => {
		expect(buildNotify({ NOTIFY: { SUCCESS: true } }, {})).toBe(" NOTIFY=SUCCESS")
	})
})

describe("mailFrom", () => {
	const mf = (overrides: Partial<Parameters<typeof mailFrom>[0]> = {}) => {
		const defaults = { fromEmail: "a@b.com", capabilities: baseCaps }
		return mailFrom({ ...defaults, ...overrides } as Parameters<typeof mailFrom>[0])
	}
	const dsnCaps = { ...baseCaps, supportsDSN: true }

	it("sends simple MAIL FROM command", async () => {
		const { transport, writer } = mockTransport(["250 OK\r\n"])
		await mf({ transport })
		expect(writtenLines(writer)[0]).toBe("MAIL FROM: <a@b.com>\r\n")
	})
	it("appends SMTPUTF8 when capability is supported", async () => {
		const { transport, writer } = mockTransport(["250 OK\r\n"])
		await mf({ transport, capabilities: { ...baseCaps, supportsSmtpUtf8: true }, smtpUtf8: true })
		expect(writtenLines(writer)[0]).toContain("SMTPUTF8")
	})
	it("does not append SMTPUTF8 when capability is unsupported", async () => {
		const { transport, writer } = mockTransport(["250 OK\r\n"])
		await mf({ transport, smtpUtf8: true })
		expect(writtenLines(writer)[0]).not.toContain("SMTPUTF8")
	})
	it("includes both SMTPUTF8 and DSN params when both supported", async () => {
		const caps = { ...baseCaps, supportsSmtpUtf8: true, supportsDSN: true }
		const { transport, writer } = mockTransport(["250 OK\r\n"])
		await mf({
			transport,
			capabilities: caps,
			smtpUtf8: true,
			dsnOverride: { RET: { FULL: true }, envelopeId: "test123" },
		})
		const cmd = writtenLines(writer)[0]
		expect(cmd).toContain("SMTPUTF8")
		expect(cmd).toContain("RET=FULL")
		expect(cmd).toContain("ENVID=test123")
	})
	it("includes DSN RET parameter when DSN supported", async () => {
		const { transport, writer } = mockTransport(["250 OK\r\n"])
		await mf({ transport, capabilities: dsnCaps, dsnOverride: { RET: { FULL: true } } })
		expect(writtenLines(writer)[0]).toContain("RET=FULL")
	})
	it("includes DSN ENVID when provided", async () => {
		const { transport, writer } = mockTransport(["250 OK\r\n"])
		await mf({ transport, capabilities: dsnCaps, dsnOverride: { envelopeId: "abc123" } })
		expect(writtenLines(writer)[0]).toContain("ENVID=abc123")
	})
	it("throws CrlfInjectionError when envelope ID contains CRLF", async () => {
		const { transport } = mockTransport(["250 OK\r\n"])
		const p = mf({ transport, capabilities: dsnCaps, dsnOverride: { envelopeId: "e\r\nRCPT" } })
		await expect(p).rejects.toThrow(CrlfInjectionError)
	})
	it("throws ConfigurationError when envelope ID contains control chars", async () => {
		for (const id of ["has space", "has\x00null", "has+plus", "has=eq", "has\x7Fdel"]) {
			const { transport } = mockTransport(["250 OK\r\n"])
			const p = mf({ transport, capabilities: dsnCaps, dsnOverride: { envelopeId: id } })
			await expect(p).rejects.toThrow(ConfigurationError)
		}
	})
	it("throws SmtpCommandError on non-2xx response", async () => {
		const { transport } = mockTransport(["550 Denied\r\n"])
		await expect(mf({ transport })).rejects.toThrow(SmtpCommandError)
	})
})

describe("rcptTo", () => {
	it("sends RCPT TO for single recipient", async () => {
		const { transport, writer } = mockTransport(["250 OK\r\n"])
		await rcptTo({ transport, recipients: [{ email: "u@d.com" }], capabilities: baseCaps })
		expect(writtenLines(writer)[0]).toBe("RCPT TO: <u@d.com>\r\n")
	})
	it("sends RCPT TO for each of multiple recipients", async () => {
		const { transport, writer } = mockTransport(["250 OK\r\n", "250 OK\r\n", "250 OK\r\n"])
		const recipients = [{ email: "a@d.com" }, { email: "b@d.com" }, { email: "c@d.com" }]
		await rcptTo({ transport, recipients, capabilities: baseCaps })
		expect(writtenLines(writer)).toHaveLength(3)
		expect(writtenLines(writer)[0]).toContain("a@d.com")
		expect(writtenLines(writer)[2]).toContain("c@d.com")
	})
	it("includes DSN NOTIFY parameter when DSN supported", async () => {
		const caps = { ...baseCaps, supportsDSN: true }
		const dsn = { NOTIFY: { SUCCESS: true, FAILURE: true, DELAY: true } }
		const { transport, writer } = mockTransport(["250 OK\r\n"])
		await rcptTo({ transport, recipients: [{ email: "u@d.com" }], capabilities: caps, dsnOverride: dsn })
		expect(writtenLines(writer)[0]).toContain("NOTIFY=SUCCESS,FAILURE,DELAY")
	})
	it("throws SmtpCommandError on non-2xx per-recipient response", async () => {
		const { transport } = mockTransport(["550 No such user\r\n"])
		await expect(
			rcptTo({ transport, recipients: [{ email: "u@d.com" }], capabilities: baseCaps }),
		).rejects.toThrow(SmtpCommandError)
	})
})

describe("dataCommand", () => {
	it("sends DATA and accepts 354 response", async () => {
		const { transport, writer } = mockTransport(["354 Start mail\r\n"])
		await dataCommand(transport)
		expect(writtenLines(writer)[0]).toBe("DATA\r\n")
	})
	it("throws SmtpCommandError on non-3xx response", async () => {
		const { transport } = mockTransport(["550 Rejected\r\n"])
		await expect(dataCommand(transport)).rejects.toThrow(SmtpCommandError)
	})
})

describe("sendBody", () => {
	it("sends email body and returns response on 2xx", async () => {
		const { transport } = mockTransport(["250 OK id=abc\r\n"])
		expect(await sendBody(transport, "Subject: Hi\r\n\r\nBody\r\n.\r\n")).toContain("250")
	})
	it("throws SmtpCommandError on non-2xx response", async () => {
		const { transport } = mockTransport(["452 Insufficient storage\r\n"])
		await expect(sendBody(transport, "data\r\n.\r\n")).rejects.toThrow(SmtpCommandError)
	})
})

describe("rset", () => {
	it("sends RSET and succeeds on 2xx", async () => {
		const { transport, writer } = mockTransport(["250 OK\r\n"])
		await rset(transport)
		expect(writtenLines(writer)[0]).toBe("RSET\r\n")
	})
	it("throws SmtpCommandError on non-2xx response", async () => {
		const { transport } = mockTransport(["500 Error\r\n"])
		await expect(rset(transport)).rejects.toThrow(SmtpCommandError)
	})
})

describe("noop", () => {
	it("returns true on 250 response", async () => {
		const { transport } = mockTransport(["250 OK\r\n"])
		expect(await noop(transport)).toBe(true)
	})
	it("returns false on non-250 response", async () => {
		const { transport } = mockTransport(["500 Error\r\n"])
		expect(await noop(transport)).toBe(false)
	})
	it("returns false on transport error", async () => {
		const { transport } = mockTransport([])
		expect(await noop(transport)).toBe(false)
	})
})
