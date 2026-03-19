import { describe, expect, it } from "vitest"
import { Email } from "../../src/email/email"
import type { EmailOptions } from "../../src/email/types"

function minimal(overrides?: Partial<EmailOptions>): EmailOptions {
	return {
		from: "sender@example.com",
		to: "recipient@example.com",
		subject: "Test",
		text: "Hello",
		...overrides,
	}
}

describe("Email constructor edge cases", () => {
	it("BCC address never appears in getRawMessage output", () => {
		const email = new Email(
			minimal({ bcc: ["secret1@t.com", "secret2@t.com"] }),
		)
		const raw = email.getRawMessage()
		expect(raw).not.toContain("secret1@t.com")
		expect(raw).not.toContain("secret2@t.com")
		expect(raw.toLowerCase()).not.toContain("bcc")
	})

	it("BCC with display name never leaks in getRawMessage", () => {
		const email = new Email(
			minimal({
				bcc: [{ name: "Secret Person", email: "hidden@t.com" }],
			}),
		)
		const raw = email.getRawMessage()
		expect(raw).not.toContain("hidden@t.com")
		expect(raw).not.toContain("Secret Person")
		expect(raw.toLowerCase()).not.toContain("bcc")
	})

	it("empty to array creates email with empty To header", () => {
		const email = new Email(minimal({ to: [] }))
		expect(email.to).toEqual([])
		expect(email.headers.To).toBe("")
	})

	it("very long subject (500+ chars) is folded correctly", () => {
		const longSubject = "A".repeat(500)
		const email = new Email(minimal({ subject: longSubject }))
		const raw = email.getRawMessage()
		const subjectLines = raw
			.split("\r\n")
			.filter(
				(line, i, arr) =>
					line.startsWith("Subject:") ||
					(i > 0 &&
						arr[i - 1].startsWith("Subject:") &&
						(line.startsWith(" ") || line.startsWith("\t"))) ||
					(i > 0 &&
						(arr[i - 1].startsWith(" ") ||
							arr[i - 1].startsWith("\t")) &&
						(line.startsWith(" ") || line.startsWith("\t"))),
			)
		for (const line of subjectLines) {
			expect(line.length).toBeLessThanOrEqual(998)
		}
	})

	it("subject with only non-ASCII is RFC 2047 encoded", () => {
		const email = new Email(minimal({ subject: "日本語のみ" }))
		expect(email.headers.Subject).toMatch(/=\?UTF-8\?Q\?/)
		expect(email.headers.Subject).not.toBe("日本語のみ")
	})

	it("HTML-only email (no text) has text/html content type", () => {
		const raw = new Email(
			minimal({ text: undefined, html: "<h1>Hello</h1>" }),
		).getRawMessage()
		expect(raw).toContain("text/html")
		expect(raw).not.toContain("multipart/alternative")
	})

	it("all recipient types set produces correct headers", () => {
		const email = new Email(
			minimal({
				from: { name: "Sender", email: "from@t.com" },
				to: ["to1@t.com", "to2@t.com"],
				cc: ["cc1@t.com"],
				bcc: ["bcc1@t.com"],
				reply: "reply@t.com",
			}),
		)
		expect(email.headers.From).toContain("from@t.com")
		expect(email.headers.To).toContain("to1@t.com")
		expect(email.headers.To).toContain("to2@t.com")
		expect(email.headers.CC).toContain("cc1@t.com")
		expect(email.headers["Reply-To"]).toBe("reply@t.com")
		const raw = email.getRawMessage()
		expect(raw).not.toContain("bcc1@t.com")
	})

	it("custom headers preserved in getRawMessage output", () => {
		const email = new Email(
			minimal({
				headers: {
					"X-Mailer": "worker-mailer",
					"X-Priority": "1",
				},
			}),
		)
		const raw = email.getRawMessage()
		expect(raw).toContain("X-Mailer: worker-mailer")
		expect(raw).toContain("X-Priority: 1")
	})

	it("Reply-To header has correct email format", () => {
		const email = new Email(minimal({ reply: "reply@test.com" }))
		expect(email.headers["Reply-To"]).toBe("reply@test.com")
	})

	it("Reply-To with display name includes name", () => {
		const email = new Email(
			minimal({
				reply: { name: "Support", email: "support@test.com" },
			}),
		)
		expect(email.headers["Reply-To"]).toContain("Support")
		expect(email.headers["Reply-To"]).toContain("support@test.com")
	})

	it("multiple To recipients in comma-separated format", () => {
		const email = new Email(
			minimal({ to: ["a@t.com", "b@t.com", "c@t.com"] }),
		)
		expect(email.headers.To).toBe("a@t.com, b@t.com, c@t.com")
	})
})

describe("getRawMessage edge cases", () => {
	it("message with attachment has multipart/mixed structure", () => {
		const raw = new Email(
			minimal({
				attachments: [
					{ filename: "doc.pdf", content: "dGVzdA==" },
				],
			}),
		).getRawMessage()
		expect(raw).toContain("multipart/mixed")
	})

	it("message with inline attachment has multipart/related", () => {
		const raw = new Email(
			minimal({
				html: '<img src="cid:img1">',
				inlineAttachments: [
					{
						cid: "img1",
						filename: "img.png",
						content: "iVBOR",
					},
				],
			}),
		).getRawMessage()
		expect(raw).toContain("multipart/related")
	})

	it("raw message does not end with SMTP terminator (.\\r\\n)", () => {
		const raw = new Email(minimal()).getRawMessage()
		expect(raw).not.toMatch(/\r\n\.\r\n$/)
	})

	it("text+html with attachment has nested multipart structure", () => {
		const raw = new Email(
			minimal({
				html: "<p>HTML</p>",
				attachments: [
					{ filename: "f.txt", content: "dGVzdA==" },
				],
			}),
		).getRawMessage()
		expect(raw).toContain("multipart/mixed")
		expect(raw).toContain("multipart/alternative")
	})

	it("raw message contains MIME-Version header", () => {
		const raw = new Email(minimal()).getRawMessage()
		expect(raw).toContain("MIME-Version: 1.0")
	})

	it("raw message has header/body separator (CRLFCRLF)", () => {
		const raw = new Email(minimal()).getRawMessage()
		expect(raw).toContain("\r\n\r\n")
	})
})
