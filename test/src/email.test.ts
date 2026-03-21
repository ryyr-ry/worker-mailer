import { describe, expect, it } from "vitest"
import { Email } from "../../src/email/email"
import type { EmailOptions } from "../../src/email/types"
import { CrlfInjectionError, EmailValidationError } from "../../src/errors"

function minimal(overrides?: Partial<EmailOptions>): EmailOptions {
	return {
		from: "sender@example.com",
		to: "recipient@example.com",
		subject: "Test",
		text: "Hello",
		...overrides,
	}
}

describe("Email construction (RFC 5322)", () => {
	describe("Required headers (Section 3.6)", () => {
		it("minimal email has Date, From, To, Subject, Message-ID", () => {
			const email = new Email(minimal())
			const raw = email.getRawMessage()
			expect(raw).toContain("Date:")
			expect(raw).toContain("From:")
			expect(raw).toContain("To:")
			expect(raw).toContain("Subject:")
			expect(raw).toContain("Message-ID:")
		})

		it("From matches options.from", () => {
			const email = new Email(minimal({ from: "me@test.com" }))
			expect(email.headers.From).toBe("me@test.com")
		})

		it("To matches options.to", () => {
			const email = new Email(minimal({ to: "you@test.com" }))
			expect(email.headers.To).toBe("you@test.com")
		})

		it("CC appears in headers when provided", () => {
			const email = new Email(minimal({ cc: ["cc1@t.com", "cc2@t.com"] }))
			expect(email.headers.CC).toContain("cc1@t.com")
			expect(email.headers.CC).toContain("cc2@t.com")
		})

		it("BCC does NOT appear in getRawMessage output (Section 3.6.3)", () => {
			const email = new Email(minimal({ bcc: "secret@t.com" }))
			const raw = email.getRawMessage()
			expect(raw).not.toContain("secret@t.com")
			expect(raw).not.toMatch(/bcc/i)
		})

		it("Reply-To set from options.reply", () => {
			const email = new Email(minimal({ reply: "reply@t.com" }))
			expect(email.headers["Reply-To"]).toBe("reply@t.com")
		})

		it("custom headers included in output", () => {
			const email = new Email(minimal({ headers: { "X-Custom": "value" } }))
			expect(email.getRawMessage()).toContain("X-Custom: value")
		})

		it("Message-ID in <...@domain> format (Section 3.6.4)", () => {
			const email = new Email(minimal({ from: "a@example.com" }))
			expect(email.headers["Message-ID"]).toMatch(/^<.+@example\.com>$/)
		})
	})

	describe("Address normalization", () => {
		it("string email normalized to User object", () => {
			const email = new Email(minimal({ from: "test@t.com" }))
			expect(email.from).toEqual({ email: "test@t.com" })
		})

		it("multiple To addresses from string array", () => {
			const email = new Email(minimal({ to: ["a@t.com", "b@t.com"] }))
			expect(email.to).toHaveLength(2)
		})

		it("User object with display name preserved", () => {
			const email = new Email(minimal({ from: { name: "Jane", email: "j@t.com" } }))
			expect(email.from.name).toBe("Jane")
		})
	})

	describe("RFC 2047 header encoding", () => {
		it("Japanese subject encoded correctly", () => {
			const email = new Email(minimal({ subject: "\u65E5\u672C\u8A9E\u306E\u4EF6\u540D" }))
			expect(email.headers.Subject).toMatch(/=\?UTF-8\?Q\?/)
		})

		it("emoji subject encoded correctly", () => {
			const email = new Email(minimal({ subject: "\u{1F4E7} Mail" }))
			expect(email.headers.Subject).toContain("=?UTF-8?Q?")
		})

		it("Japanese display name encoded", () => {
			const email = new Email(
				minimal({
					from: { name: "\u7530\u4E2D\u592A\u90CE", email: "tanaka@t.com" },
				}),
			)
			expect(email.headers.From).toContain("=?UTF-8?Q?")
		})
	})

	describe("MIME structure", () => {
		it("text-only email has text/plain", () => {
			const raw = new Email(minimal()).getRawMessage()
			expect(raw).toContain("text/plain")
		})

		it("html-only email has text/html", () => {
			const raw = new Email(minimal({ text: undefined, html: "<p>hi</p>" })).getRawMessage()
			expect(raw).toContain("text/html")
		})

		it("text+html email has multipart/alternative", () => {
			const raw = new Email(minimal({ html: "<p>hi</p>" })).getRawMessage()
			expect(raw).toContain("multipart/alternative")
		})

		it("attachment included in message", () => {
			const raw = new Email(
				minimal({
					attachments: [{ filename: "f.txt", content: "dGVzdA==" }],
				}),
			).getRawMessage()
			expect(raw).toContain("Content-Disposition: attachment")
			expect(raw).toContain('filename="f.txt"')
		})

		it("inline attachment with CID", () => {
			const raw = new Email(
				minimal({
					html: '<img src="cid:logo">',
					attachments: [],
					inlineAttachments: [{ cid: "logo", filename: "logo.png", content: "iVBOR" }],
				}),
			).getRawMessage()
			expect(raw).toContain("Content-ID: <logo>")
		})

		it("calendar event part included", () => {
			const raw = new Email(
				minimal({
					calendarEvent: { content: "BEGIN:VCALENDAR\r\nEND:VCALENDAR", method: "REQUEST" },
				}),
			).getRawMessage()
			expect(raw).toContain("text/calendar")
		})
	})

	describe("CRLF injection prevention (Security Section 5)", () => {
		it("CRLF in from email throws CrlfInjectionError", () => {
			expect(() => new Email(minimal({ from: "evil@t.com\r\nBcc: x@t.com" }))).toThrow()
		})

		it("CRLF in to email throws CrlfInjectionError", () => {
			expect(() => new Email(minimal({ to: "evil@t.com\r\nRCPT TO: x@t.com" }))).toThrow()
		})

		it("CRLF in cc email throws", () => {
			expect(() => new Email(minimal({ cc: "evil@t.com\r\ninjection" }))).toThrow()
		})

		it("CRLF in bcc email throws", () => {
			expect(() => new Email(minimal({ bcc: "evil@t.com\ninjection" }))).toThrow()
		})

		it("CRLF in subject throws CrlfInjectionError", () => {
			expect(() => new Email(minimal({ subject: "test\r\nBcc: x@t.com" }))).toThrow(
				CrlfInjectionError,
			)
		})

		it("CRLF in custom header value throws CrlfInjectionError", () => {
			expect(() => new Email(minimal({ headers: { "X-Custom": "val\r\nBcc: x@t.com" } }))).toThrow(
				CrlfInjectionError,
			)
		})

		it("CRLF in attachment filename throws", () => {
			expect(
				() =>
					new Email(
						minimal({
							attachments: [{ filename: 'evil\r\n".txt', content: "dGVzdA==" }],
						}),
					),
			).toThrow()
		})

		it("CRLF in inline attachment CID throws CrlfInjectionError", () => {
			expect(
				() =>
					new Email(
						minimal({
							html: "<img>",
							inlineAttachments: [{ cid: "img\r\ninjection", filename: "i.png", content: "iVBOR" }],
						}),
					),
			).toThrow(CrlfInjectionError)
		})
	})

	describe("Validation edge cases", () => {
		it("no text and no html throws EmailValidationError", () => {
			expect(
				() => new Email({ from: "a@b.com", to: "c@d.com", subject: "s" } as EmailOptions),
			).toThrow(EmailValidationError)
		})

		it("inline attachments without html throws", () => {
			expect(
				() =>
					new Email(
						minimal({
							html: undefined,
							inlineAttachments: [{ cid: "x", filename: "x.png", content: "iVBOR" }],
						}),
					),
			).toThrow(EmailValidationError)
		})

		it("duplicate inline CIDs throws", () => {
			expect(
				() =>
					new Email(
						minimal({
							html: "<img><img>",
							inlineAttachments: [
								{ cid: "same", filename: "a.png", content: "iVBOR" },
								{ cid: "same", filename: "b.png", content: "iVBOR" },
							],
						}),
					),
			).toThrow(EmailValidationError)
		})

		it("empty calendar event content throws", () => {
			expect(() => new Email(minimal({ calendarEvent: { content: "" } }))).toThrow(
				EmailValidationError,
			)
		})

		it("angle brackets in email address throws", () => {
			expect(() => new Email(minimal({ from: "<evil>@t.com" }))).toThrow(EmailValidationError)
		})

		it("empty to array throws EmailValidationError", () => {
			expect(() => new Email(minimal({ to: [] }))).toThrow(EmailValidationError)
		})

		it("getRawMessage produces valid RFC 5322 message", () => {
			const email = new Email(
				minimal({
					from: { name: "Sender", email: "s@example.com" },
					to: [{ name: "Rcpt", email: "r@example.com" }],
					cc: "cc@example.com",
					subject: "Full test",
					text: "Text body",
					html: "<p>HTML body</p>",
				}),
			)
			const raw = email.getRawMessage()
			// Must have MIME-Version
			expect(raw).toContain("MIME-Version: 1.0")
			// Must have proper header/body separator
			expect(raw).toMatch(/\r\n\r\n/)
		})

		it("null byte in email address rejected (control char injection)", () => {
			expect(() => new Email(minimal({ from: "a\x00@b.com" }))).toThrow()
		})

		it("extremely long email address rejected (RFC 5321 Section 4.5.3.1)", () => {
			const longAddr = `${"a".repeat(300)}@example.com`
			expect(() => new Email(minimal({ from: longAddr }))).toThrow()
		})

		it("path traversal in attachment filename rejected (security)", () => {
			expect(
				() =>
					new Email(
						minimal({
							attachments: [{ filename: "../../etc/passwd", content: "dGVzdA==" }],
						}),
					),
			).toThrow(EmailValidationError)
		})

		it("headers object is frozen after construction (immutability)", () => {
			const email = new Email(minimal())
			expect(Object.isFrozen(email.headers)).toBe(true)
		})

		it("Date header contains timezone (RFC 5322 Section 3.3)", () => {
			const email = new Email(minimal())
			expect(email.headers.Date).toMatch(/[+-]\d{4}$/)
		})
	})
})
