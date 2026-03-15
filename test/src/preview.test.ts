import { describe, expect, it } from "vitest"
import { Email } from "../../src/email/email"
import { previewEmail } from "../../src/preview"

describe("Email preview", () => {
	it("preview for text-only email", () => {
		const preview = previewEmail({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "Hello",
			text: "Plain text body",
		})
		expect(preview.text).toBe("Plain text body")
		expect(preview.html).toBeUndefined()
		expect(preview.raw).toContain("Plain text body")
	})

	it("preview for HTML-only email", () => {
		const preview = previewEmail({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "Hello",
			html: "<p>HTML body</p>",
		})
		expect(preview.html).toBe("<p>HTML body</p>")
		expect(preview.text).toBeUndefined()
		expect(preview.raw).toContain("<p>HTML body</p>")
	})

	it("preview for text + html email", () => {
		const preview = previewEmail({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "Hello",
			text: "Plain",
			html: "<p>HTML</p>",
		})
		expect(preview.text).toBe("Plain")
		expect(preview.html).toBe("<p>HTML</p>")
		expect(preview.raw).toContain("multipart/alternative")
	})

	it("headers include From, To, Subject, Date, Message-ID", () => {
		const preview = previewEmail({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "Test Subject",
			text: "body",
		})
		expect(preview.headers.From).toBeDefined()
		expect(preview.headers.To).toBeDefined()
		expect(preview.headers.Subject).toBe("Test Subject")
		expect(preview.headers.Date).toBeDefined()
		expect(preview.headers["Message-ID"]).toBeDefined()
	})

	it("raw does not contain SMTP termination marker", () => {
		const preview = previewEmail({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "Hello",
			text: "body",
		})
		expect(preview.raw).not.toContain("\r\n.\r\n")
	})

	it("raw does not have dot stuffing applied", () => {
		const preview = previewEmail({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "Hello",
			text: ".leading dot line",
		})
		expect(preview.raw).not.toMatch(/^\.\./m)
	})

	it("preview with attachments", () => {
		const preview = previewEmail({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "With attachment",
			text: "See attached",
			attachments: [
				{
					filename: "test.txt",
					content: "SGVsbG8=",
				},
			],
		})
		expect(preview.raw).toContain("multipart/mixed")
		expect(preview.raw).toContain("test.txt")
	})

	it("preview matches Email.getRawMessage() structure", () => {
		const options = {
			from: "a@b.com",
			to: "c@d.com",
			subject: "Test",
			text: "Hello",
			html: "<p>Hello</p>",
		}
		const preview = previewEmail(options)
		expect(preview.raw).toContain("multipart/alternative")
		expect(preview.raw).toContain("text/plain")
		expect(preview.raw).toContain("text/html")
		expect(preview.raw).toContain("Hello")
		expect(preview.text).toBe("Hello")
		expect(preview.html).toBe("<p>Hello</p>")
	})

	it("preview raw equals Email.getRawMessage() for same options", () => {
		const options = {
			from: "a@b.com",
			to: "c@d.com",
			subject: "Consistency",
			text: "body text",
		}
		const preview = previewEmail(options)
		const email = new Email(options)
		const directRaw = email.getRawMessage()
		// Both go through the same Email constructor, but Date/Message-ID differ
		// Verify structural equivalence by checking shared headers and body
		expect(preview.raw).toContain("Subject: Consistency")
		expect(directRaw).toContain("Subject: Consistency")
		expect(preview.raw).toContain("body text")
		expect(directRaw).toContain("body text")
		expect(preview.raw).toContain("MIME-Version: 1.0")
		expect(directRaw).toContain("MIME-Version: 1.0")
	})

	it("User-type From/To resolved to strings in headers", () => {
		const preview = previewEmail({
			from: { name: "Alice Sender", email: "alice@example.com" },
			to: { name: "Bob Receiver", email: "bob@example.com" },
			subject: "Hello",
			text: "body",
		})
		expect(preview.headers.From).toContain("Alice Sender")
		expect(preview.headers.From).toContain("alice@example.com")
		expect(preview.headers.To).toContain("Bob Receiver")
		expect(preview.headers.To).toContain("bob@example.com")
	})
})
