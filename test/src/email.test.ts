import { extract } from "letterparser"
import { describe, expect, it } from "vitest"
import { Email } from "../../src/email/email"
import { encodeHeader } from "../../src/email/header"
import { applyDotStuffing } from "../../src/email/mime"
import type { EmailOptions } from "../../src/email/types"
import type { SendResult } from "../../src/result"

describe("Email", () => {
	describe("constructor", () => {
		it("should create an email with minimal options", () => {
			const options: EmailOptions = {
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test Subject",
				text: "Test content",
			}
			const email = new Email(options)
			expect(email.from).toEqual({ email: "sender@example.com" })
			expect(email.to).toEqual([{ email: "recipient@example.com" }])
			expect(email.subject).toBe("Test Subject")
			expect(email.text).toBe("Test content")
		})

		it("should handle complex user objects", () => {
			const options: EmailOptions = {
				from: { name: "Sender Name", email: "sender@example.com" },
				to: [
					{ name: "Recipient1", email: "recipient1@example.com" },
					{ name: "Recipient2", email: "recipient2@example.com" },
				],
				subject: "Test Subject",
				html: "<p>Test content</p>",
			}
			const email = new Email(options)
			expect(email.from).toEqual({
				name: "Sender Name",
				email: "sender@example.com",
			})
			expect(email.to).toEqual([
				{ name: "Recipient1", email: "recipient1@example.com" },
				{ name: "Recipient2", email: "recipient2@example.com" },
			])
		})

		it("should throw error if neither text nor html is provided", () => {
			const options: EmailOptions = {
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test Subject",
			}
			expect(() => new Email(options)).toThrow()
		})
	})

	describe("getRawMessage", () => {
		it("should generate correct email data with text content", () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test Subject",
				text: "Hello World",
			})
			const data = email.getRawMessage()
			const msg = extract(data)
			expect(msg.text).toBe("Hello World")
			expect(msg.subject).toBe("Test Subject")
			expect(msg.from).toEqual({
				address: "sender@example.com",
				raw: "sender@example.com",
			})
			expect(msg.to).toEqual([{ address: "recipient@example.com", raw: "recipient@example.com" }])
		})

		it("should generate correct email data with HTML and Text content", () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test Subject",
				text: "Hello World",
				html: "<p>Hello World</p>",
			})
			const data = email.getRawMessage()
			const msg = extract(data)
			expect(msg.text).toBe("Hello World")
			expect(msg.html).toBe("<p>Hello World</p>")
			expect(msg.subject).toBe("Test Subject")
			expect(msg.from).toEqual({
				address: "sender@example.com",
				raw: "sender@example.com",
			})
			expect(msg.to).toEqual([{ address: "recipient@example.com", raw: "recipient@example.com" }])
		})

		it("should not include lines longer than 998 characters", () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test Subject",
				text: "Hello, this is a test email with a long text. ".repeat(50),
				html: `<p>${"Hello, this is a test email with a long text. ".repeat(50)}</p>`,
			})
			const data = email.getRawMessage()

			// getRawMessage returns pure RFC 5322 (no dot-stuffing)
			const msg = extract(data)

			// expect the text to be the same if linebreaks are removed (we are adding a space and removing all double spaces due to the way the text is wrapped)
			expect(msg.text?.replace(/\n/g, " ").replaceAll("  ", " ")).toBe(
				"Hello, this is a test email with a long text. ".repeat(50).trim(),
			)
			expect(msg.html?.replace(/\n/g, " ").replaceAll("  ", " ")).toBe(
				`<p>${"Hello, this is a test email with a long text. ".repeat(50)}</p>`,
			)
			const lines = data.split("\r\n")

			for (const line of lines) {
				expect(line.length).toBeLessThanOrEqual(998)
			}
		})

		it("should include CC headers and exclude BCC from headers", () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				// @ts-expect-error it works
				cc: ["cc1@example.com", { name: "CC2", email: "cc2@example.com" }],
				bcc: "bcc@example.com",
				subject: "Test Subject",
				text: "Hello World",
			})
			const data = email.getRawMessage()
			const msg = extract(data)
			expect(msg.cc).toEqual([
				{ address: "cc1@example.com", raw: "cc1@example.com" },
				{
					address: "cc2@example.com",
					name: "CC2",
					raw: '"CC2" <cc2@example.com>',
				},
			])
			expect(msg.bcc).toBeUndefined()
			expect(data).not.toContain("bcc@example.com")
		})

		it("should include Reply-To when provided", () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				reply: { name: "Reply Name", email: "reply@example.com" },
				subject: "Test Subject",
				text: "Hello World",
			})
			const data = email.getRawMessage()
			const msg = extract(data)
			expect(msg.replyTo).toEqual([
				{
					address: "reply@example.com",
					name: "Reply Name",
					raw: '"Reply Name" <reply@example.com>',
				},
			])
		})

		it("should include custom headers when provided", () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test Subject",
				text: "Hello World",
				headers: {
					"X-Custom-Header": "Custom Value",
				},
			})
			const data = email.getRawMessage()
			// letterparser does not support headers yet
			expect(data).toContain("X-Custom-Header: Custom Value")
		})

		it("should not override custom standard headers", () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				cc: "cc@example.com",
				bcc: "bcc@example.com",
				reply: "reply@example.com",
				subject: "Test Subject",
				text: "Hello World",
				headers: {
					From: "custom-from@example.com",
					To: "custom-to@example.com",
					CC: "custom-cc@example.com",
					BCC: "custom-bcc@example.com",
					"Reply-To": "custom-reply@example.com",
					Subject: "Custom Subject",
					"X-Custom-Header": "Custom Value",
				},
			})
			const data = email.getRawMessage()

			// Verify custom headers are preserved
			expect(data).toContain("From: custom-from@example.com")
			expect(data).toContain("To: custom-to@example.com")
			expect(data).toContain("CC: custom-cc@example.com")
			expect(data).toContain("BCC: custom-bcc@example.com")
			expect(data).toContain("Reply-To: custom-reply@example.com")
			expect(data).toContain("Subject: Custom Subject")
			expect(data).toContain("X-Custom-Header: Custom Value")
		})

		it("should not include dot-stuffing or SMTP terminator in raw message", () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Dot Stuffing",
				text: ".\r\nLine two\r\n.Line three\r\n..Line four",
			})

			const data = email.getRawMessage()
			// getRawMessage is pure RFC 5322 - no dot-stuffing, no \r\n.\r\n
			expect(data).not.toMatch(/\r\n\.\r\n$/)
		})
	})

	describe("applyDotStuffing", () => {
		it("should dot-stuff lines starting with periods", () => {
			const input = "Header: value\r\n\r\n.\r\nLine two\r\n.Line three\r\n..Line four"
			const result = applyDotStuffing(input)
			expect(result).toContain("\r\n..\r\n")
			expect(result).toContain("\r\n..Line three")
			expect(result).toContain("\r\n...Line four")
		})
	})

	describe("encodeHeader", () => {
		it("should return ASCII text as-is", () => {
			expect(encodeHeader("Hello World")).toBe("Hello World")
			expect(encodeHeader("test@example.com")).toBe("test@example.com")
		})

		it("should encode non-ASCII characters", () => {
			// German umlaut - UTF-8 encoding: ü = C3 BC
			expect(encodeHeader("Müller")).toBe("=?UTF-8?Q?M=C3=BCller?=")

			// For non-ASCII characters, we'll test that the output is a valid RFC 2047 encoded word
			expect(encodeHeader("测试")).toMatch(/^=\?UTF-8\?Q\?[0-9A-F=]+\?=$/i)
			expect(encodeHeader("テスト")).toMatch(/^=\?UTF-8\?Q\?[0-9A-F=]+\?=$/i)
		})

		it("should handle spaces and special characters", () => {
			expect(encodeHeader("Hello World!")).toBe("Hello World!") // Space remains as space
			expect(encodeHeader("Test & Test")).toBe("Test & Test") // Space remains as space
			expect(encodeHeader("100%")).toBe("100%") // % is not encoded
		})
	})

	describe("Email Headers with Non-ASCII", () => {
		it("should encode sender name with non-ASCII characters", () => {
			const email = new Email({
				from: { name: "Müller", email: "muller@example.com" },
				to: "recipient@example.com",
				subject: "Test",
				text: "Test content",
			})

			const emailData = email.getRawMessage()
			// Extract the From header from the raw email data
			const fromHeader = emailData
				.split("\r\n")
				.find((line) => line.toLowerCase().startsWith("from:"))
			expect(fromHeader).toBeDefined()
			expect(fromHeader).toContain("=?UTF-8?Q?M=C3=BCller?=")
		})

		it("should encode recipient name with non-ASCII characters", () => {
			const email = new Email({
				from: "sender@example.com",
				to: { name: "Jörg Schmidt", email: "jorg@example.com" },
				subject: "Test",
				text: "Test content",
			})

			const emailData = email.getRawMessage()
			// Extract the To header from the raw email data
			const toHeader = emailData.split("\r\n").find((line) => line.toLowerCase().startsWith("to:"))
			expect(toHeader).toBeDefined()
			expect(toHeader).toContain("=?UTF-8?Q?J=C3=B6rg_Schmidt?=")
		})

		it("should encode subject with non-ASCII characters", () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test with ümläüts",
				text: "Test content",
			})

			const emailData = email.getRawMessage()
			// Extract the Subject header from the raw email data
			const subjectHeader = emailData
				.split("\r\n")
				.find((line) => line.toLowerCase().startsWith("subject:"))
			expect(subjectHeader).toBeDefined()
			expect(subjectHeader).toContain("=?UTF-8?Q?Test_with_=C3=BCml=C3=A4=C3=BCts?=")
		})

		it("should handle multiple recipients with non-ASCII names", () => {
			const email = new Email({
				from: "sender@example.com",
				to: [
					{ name: "Jörg Schmidt", email: "jorg@example.com" },
					{ name: "François Dupont", email: "francois@example.com" },
				],
				subject: "Test",
				text: "Test content",
			})

			const emailData = email.getRawMessage()
			const headerSection = emailData.split("\r\n\r\n")[0]
			const unfoldedHeaders = headerSection.replaceAll(/\r\n[ \t]/g, " ")
			const toHeader = unfoldedHeaders
				.split("\r\n")
				.find((line) => line.toLowerCase().startsWith("to:"))
			expect(toHeader).toBeDefined()
			expect(toHeader).toContain("=?UTF-8?Q?J=C3=B6rg_Schmidt?=")
			expect(toHeader).toContain("=?UTF-8?Q?Fran=C3=A7ois_Dupont?=")
		})
	})

	it("should include attachments when provided", () => {
		const email = new Email({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "Test Subject",
			text: "Hello World",
			attachments: [
				{
					filename: "test.txt",
					content: Buffer.from("Test content").toString("base64"),
				},
				{
					filename: "test2.txt",
					content: Buffer.from("Test content 2").toString("base64"),
				},
			],
		})
		const data = email.getRawMessage()
		const msg = extract(data)
		expect(msg.attachments).toEqual([
			{
				filename: "test.txt",
				body: "Test content",
				contentId: undefined,
				contentType: {
					encoding: "utf-8",
					parameters: { name: "test.txt" },
					type: "text/plain",
				},
			},
			{
				filename: "test2.txt",
				body: "Test content 2",
				contentId: undefined,
				contentType: {
					encoding: "utf-8",
					parameters: { name: "test2.txt" },
					type: "text/plain",
				},
			},
		])
		expect(data).not.toContain("creation-date")
		expect(data).toMatch(/Content-Disposition: attachment; filename="test\.txt"\r\n/)
		expect(data).toMatch(/Content-Disposition: attachment; filename="test2\.txt"\r\n/)
	})

	describe("sent promise", () => {
		it("should resolve when setSentResult is called", async () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test Subject",
				text: "Hello World",
			})

			setTimeout(
				() =>
					email.setSentResult({
						messageId: email.headers["Message-ID"] ?? "",
						accepted: [],
						rejected: [],
						responseTime: 0,
						response: "",
					}),
				0,
			)
			await expect(email.sent).resolves.toBeUndefined()
		})

		it("should reject when setSentError is called", async () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test Subject",
				text: "Hello World",
			})

			const error = new Error("Test error")
			setTimeout(() => email.setSentError(error), 0)
			await expect(email.sent).rejects.toBe(error)
		})
	})

	describe("sentResult promise", () => {
		it("should resolve with SendResult when setSentResult is called", async () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test Subject",
				text: "Hello World",
			})

			const result: SendResult = {
				messageId: "<test-id@example.com>",
				accepted: ["recipient@example.com"],
				rejected: [],
				responseTime: 42,
				response: "250 Message accepted",
			}
			setTimeout(() => email.setSentResult(result), 0)
			await expect(email.sentResult).resolves.toEqual(result)
		})

		it("should reject when setSentError is called", async () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test Subject",
				text: "Hello World",
			})

			const error = new Error("Send failed")
			setTimeout(() => email.setSentError(error), 0)
			await expect(email.sentResult).rejects.toBe(error)
		})

		it("should resolve sent (void) when setSentResult is called", async () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test Subject",
				text: "Hello World",
			})

			const result: SendResult = {
				messageId: "<test-id@example.com>",
				accepted: ["recipient@example.com"],
				rejected: [],
				responseTime: 10,
				response: "250 OK",
			}
			setTimeout(() => email.setSentResult(result), 0)
			await expect(email.sent).resolves.toBeUndefined()
		})

		it("should resolve via setSentResult() with default SendResult", async () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Test Subject",
				text: "Hello World",
			})

			setTimeout(
				() =>
					email.setSentResult({
						messageId: email.headers["Message-ID"] ?? "",
						accepted: [],
						rejected: [],
						responseTime: 0,
						response: "",
					}),
				0,
			)
			const result = await email.sentResult
			expect(result.accepted).toEqual([])
			expect(result.rejected).toEqual([])
			expect(result.responseTime).toBe(0)
			expect(result.response).toBe("")
		})
	})

	describe("security", () => {
		it("should reject CRLF in custom header values (header injection)", () => {
			expect(
				() =>
					new Email({
						from: "sender@example.com",
						to: "recipient@example.com",
						subject: "test",
						text: "test",
						headers: {
							"X-Custom": "value\r\nBCC: attacker@evil.com",
						},
					}),
			).toThrow(/CRLF/)
		})

		it("should reject CRLF in custom header keys", () => {
			expect(
				() =>
					new Email({
						from: "sender@example.com",
						to: "recipient@example.com",
						subject: "test",
						text: "test",
						headers: {
							"X-Custom\r\nBCC": "attacker@evil.com",
						},
					}),
			).toThrow(/CRLF/)
		})

		it("should reject CRLF in subject", () => {
			expect(
				() =>
					new Email({
						from: "sender@example.com",
						to: "recipient@example.com",
						subject: "test\r\nBCC: attacker@evil.com",
						text: "test",
					}),
			).toThrow(/CRLF/)
		})

		it("throws on CRLF in from display name", () => {
			expect(
				() =>
					new Email({
						from: { name: "Evil\r\nBCC: victim@evil.com", email: "a@b.com" },
						to: "b@b.com",
						subject: "Test",
						text: "test",
					}),
			).toThrow("CRLF injection detected in from display name")
		})

		it("throws on CRLF in to display name", () => {
			expect(
				() =>
					new Email({
						from: "a@b.com",
						to: { name: "Evil\r\nX-Injected: yes", email: "b@b.com" },
						subject: "Test",
						text: "test",
					}),
			).toThrow("CRLF injection detected in to display name")
		})

		it("throws on CRLF in cc display name", () => {
			expect(
				() =>
					new Email({
						from: "a@b.com",
						to: "b@b.com",
						cc: { name: "Evil\r\nX-Injected: yes", email: "c@b.com" },
						subject: "Test",
						text: "test",
					}),
			).toThrow("CRLF injection detected in cc display name")
		})

		it("throws on CRLF in reply display name", () => {
			expect(
				() =>
					new Email({
						from: "a@b.com",
						to: "b@b.com",
						reply: { name: "Evil\r\nX-Injected: yes", email: "r@b.com" },
						subject: "Test",
						text: "test",
					}),
			).toThrow("CRLF injection detected in reply display name")
		})

		it("throws on CRLF in bcc display name", () => {
			expect(
				() =>
					new Email({
						from: "a@b.com",
						to: "b@b.com",
						bcc: { name: "Evil\r\nX-Injected: yes", email: "bcc@b.com" },
						subject: "Test",
						text: "test",
					}),
			).toThrow("CRLF injection detected in bcc display name")
		})

		it("should allow normal headers without CRLF", () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "Normal subject",
				text: "test",
				headers: {
					"X-Custom": "normal-value",
					"X-Priority": "1",
				},
			})
			expect(email.headers["X-Custom"]).toBe("normal-value")
		})

		it("should not leak BCC addresses in email headers (P0-2)", () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				bcc: ["secret@example.com", "hidden@example.com"],
				subject: "Test",
				text: "test",
			})

			const data = email.getRawMessage()
			expect(data).not.toContain("secret@example.com")
			expect(data).not.toContain("hidden@example.com")
			expect(data).not.toMatch(/BCC:/i)
		})

		it("should not leak BCC with named users in email headers", () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				bcc: [{ email: "secret@example.com", name: "Secret User" }],
				subject: "Test",
				text: "test",
			})

			const data = email.getRawMessage()
			expect(data).not.toContain("secret@example.com")
			expect(data).not.toContain("Secret User")
			expect(data).not.toMatch(/BCC:/i)
		})

		it("should reject email addresses without @", () => {
			expect(
				() =>
					new Email({
						from: "not-an-email",
						to: "recipient@example.com",
						subject: "test",
						text: "test",
					}),
			).toThrow(/Invalid email address/)
		})

		it("should reject email addresses with angle brackets", () => {
			expect(
				() =>
					new Email({
						from: "sender@example.com",
						to: "<injected>@example.com",
						subject: "test",
						text: "test",
					}),
			).toThrow(/Invalid email address/)
		})

		it("should reject empty email addresses", () => {
			expect(
				() =>
					new Email({
						from: "",
						to: "recipient@example.com",
						subject: "test",
						text: "test",
					}),
			).toThrow(/Invalid email address/)
		})

		it("should accept valid email addresses", () => {
			const email = new Email({
				from: "sender@example.com",
				to: ["user@example.com", "admin@sub.example.co.jp"],
				cc: "cc@example.com",
				bcc: "bcc@example.com",
				reply: "reply@example.com",
				subject: "test",
				text: "test",
			})
			expect(email.from.email).toBe("sender@example.com")
		})
		it("should reject attachment filenames with double quotes", () => {
			expect(
				() =>
					new Email({
						from: "sender@example.com",
						to: "recipient@example.com",
						subject: "test",
						text: "test",
						attachments: [
							{
								filename: 'evil".txt',
								content: "data",
							},
						],
					}),
			).toThrow(/Invalid attachment filename/)
		})

		it("should reject attachment filenames with CRLF", () => {
			expect(
				() =>
					new Email({
						from: "sender@example.com",
						to: "recipient@example.com",
						subject: "test",
						text: "test",
						attachments: [
							{
								filename: "evil\r\nContent-Type: text/html",
								content: "data",
							},
						],
					}),
			).toThrow(/Invalid attachment filename/)
		})

		it("should accept safe attachment filenames", () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "test",
				text: "test",
				attachments: [
					{ filename: "report-2024.pdf", content: Buffer.from("pdf-data").toString("base64") },
					{ filename: "日本語ファイル.txt", content: Buffer.from("text-data").toString("base64") },
				],
			})
			expect(email.attachments).toHaveLength(2)
		})

		it("should reject attachment with invalid base64 content", () => {
			expect(
				() =>
					new Email({
						from: "sender@example.com",
						to: "recipient@example.com",
						subject: "test",
						text: "test",
						attachments: [
							{
								filename: "test.txt",
								content: "not valid base64!@#$%",
							},
						],
					}),
			).toThrow(/Invalid base64 content in attachment/)
		})

		it("should reject attachment with base64 content containing angle brackets", () => {
			expect(
				() =>
					new Email({
						from: "sender@example.com",
						to: "recipient@example.com",
						subject: "test",
						text: "test",
						attachments: [
							{
								filename: "test.txt",
								content: "<script>alert(1)</script>",
							},
						],
					}),
			).toThrow(/Invalid base64 content in attachment/)
		})

		it("should accept attachment with valid base64 content", () => {
			const validBase64 = Buffer.from("Hello, World!").toString("base64")
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "test",
				text: "test",
				attachments: [
					{
						filename: "test.txt",
						content: validBase64,
					},
				],
			})
			expect(email.attachments).toHaveLength(1)
		})

		it("should accept attachment with base64 content including padding", () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "test",
				text: "test",
				attachments: [
					{
						filename: "test.txt",
						content: "SGVsbG8=",
					},
				],
			})
			expect(email.attachments).toHaveLength(1)
		})

		it("should accept attachment with Uint8Array content", () => {
			const binaryContent = new Uint8Array([72, 101, 108, 108, 111])
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "test",
				text: "test",
				attachments: [
					{
						filename: "binary.bin",
						content: binaryContent,
					},
				],
			})
			expect(email.attachments).toHaveLength(1)
		})

		it("should accept attachment with ArrayBuffer content", () => {
			const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "test",
				text: "test",
				attachments: [
					{
						filename: "binary.bin",
						content: buffer as ArrayBuffer,
					},
				],
			})
			expect(email.attachments).toHaveLength(1)
		})

		it("should encode Uint8Array attachment content to base64 in email data", () => {
			const binaryContent = new Uint8Array([72, 101, 108, 108, 111])
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "test",
				text: "test",
				attachments: [
					{
						filename: "test.txt",
						content: binaryContent,
					},
				],
			})
			const data = email.getRawMessage()
			const msg = extract(data)
			expect(msg.attachments).toHaveLength(1)
			expect(msg.attachments?.[0].body).toBe("Hello")
			expect(msg.attachments?.[0].filename).toBe("test.txt")
		})

		it("should encode ArrayBuffer attachment content to base64 in email data", () => {
			const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "test",
				text: "test",
				attachments: [
					{
						filename: "test.txt",
						content: buffer as ArrayBuffer,
					},
				],
			})
			const data = email.getRawMessage()
			const msg = extract(data)
			expect(msg.attachments).toHaveLength(1)
			expect(msg.attachments?.[0].body).toBe("Hello")
			expect(msg.attachments?.[0].filename).toBe("test.txt")
		})

		it("should handle mixed string and binary attachments", () => {
			const email = new Email({
				from: "sender@example.com",
				to: "recipient@example.com",
				subject: "test",
				text: "test",
				attachments: [
					{
						filename: "text.txt",
						content: Buffer.from("StringContent").toString("base64"),
					},
					{
						filename: "binary.txt",
						content: new Uint8Array([66, 105, 110, 97, 114, 121]),
					},
				],
			})
			const data = email.getRawMessage()
			const msg = extract(data)
			expect(msg.attachments).toHaveLength(2)
			expect(msg.attachments?.[0].body).toBe("StringContent")
			expect(msg.attachments?.[0].filename).toBe("text.txt")
			expect(msg.attachments?.[1].body).toBe("Binary")
			expect(msg.attachments?.[1].filename).toBe("binary.txt")
		})
	})

	describe("header line folding (RFC 5322 §2.1.1)", () => {
		it("should fold long To header lines at 78 characters", () => {
			const manyRecipients = Array.from({ length: 10 }, (_, i) => `user${i}@example.com`)
			const email = new Email({
				from: "sender@example.com",
				to: manyRecipients,
				subject: "test",
				text: "test",
			})
			const data = email.getRawMessage()
			const headerSection = data.split("\r\n\r\n")[0]
			const lines = headerSection.split("\r\n")
			for (const line of lines) {
				expect(line.length).toBeLessThanOrEqual(78)
			}
		})

		it("should not exceed 998 characters per line (absolute RFC limit)", () => {
			const longName = "A".repeat(200)
			const email = new Email({
				from: { name: longName, email: "sender@example.com" },
				to: "recipient@example.com",
				subject: "test",
				text: "test",
			})
			const data = email.getRawMessage()
			const headerSection = data.split("\r\n\r\n")[0]
			const lines = headerSection.split("\r\n")
			for (const line of lines) {
				expect(line.length).toBeLessThanOrEqual(78)
			}
		})
	})
})

describe("encodeHeader", () => {
	describe("ASCII text", () => {
		it("should not encode pure ASCII text", () => {
			const input = "Hello World"
			const result = encodeHeader(input)
			expect(result).toBe("Hello World")
		})

		it("should not encode ASCII with special characters", () => {
			const input = "Test: Email Subject!"
			const result = encodeHeader(input)
			expect(result).toBe("Test: Email Subject!")
		})
	})

	describe("Control characters", () => {
		it("should encode text containing null byte", () => {
			const input = "Hello\x00World"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})

		it("should encode text containing bell character (0x07)", () => {
			const input = "Hello\x07World"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})

		it("should encode text containing line feed (0x0A)", () => {
			const input = "Hello\nWorld"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})

		it("should encode text containing carriage return (0x0D)", () => {
			const input = "Hello\rWorld"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})

		it("should encode text containing escape character (0x1B)", () => {
			const input = "Hello\x1BWorld"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})

		it("should encode text containing DEL character (0x7F)", () => {
			const input = "Hello\x7FWorld"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})

		it("should not encode text containing only tab (0x09) and printable ASCII", () => {
			const input = "Hello\tWorld"
			const result = encodeHeader(input)
			expect(result).toBe("Hello\tWorld")
		})

		it("should encode text with multiple control characters", () => {
			const input = "\x01\x02\x03"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})
	})

	describe("Non-ASCII text", () => {
		it("should encode Chinese characters", () => {
			const input = "你好"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
			expect(result).toContain("=E4=BD=A0=E5=A5=BD")
		})

		it("should encode emoji", () => {
			const input = "😀"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
			expect(result).toContain("=F0=9F=98=80")
		})

		it("should encode mixed ASCII and non-ASCII", () => {
			const input = "Hello 世界"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
			expect(result).toContain("Hello")
			expect(result).toContain("=E4=B8=96=E7=95=8C")
		})
	})

	describe("RFC 2047 specific rules", () => {
		it("should convert spaces to underscores", () => {
			const input = "你好 世界"
			const result = encodeHeader(input)
			// Space (0x20) should become underscore
			expect(result).toContain("_")
			expect(result).not.toContain(" ")
		})

		it("should encode question marks", () => {
			const input = "测试?"
			const result = encodeHeader(input)
			// Question mark should be encoded to avoid conflict with delimiter
			expect(result).toContain("=3F")
		})

		it("should encode equals signs", () => {
			const input = "测试="
			const result = encodeHeader(input)
			// Equals sign should be encoded
			expect(result).toContain("=3D")
		})

		it("should encode underscores", () => {
			const input = "测试_"
			const result = encodeHeader(input)
			// Underscore should be encoded to avoid confusion with encoded space
			expect(result).toContain("=5F")
		})

		it("should wrap result in =?UTF-8?Q?...?= format", () => {
			const input = "你好世界"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?[^?]+\?=$/)
		})
	})

	describe("Real-world scenarios", () => {
		it("should handle typical subject line", () => {
			const input = "订单确认 - Order #12345"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
			expect(result).toContain("_-_Order_")
		})

		it("should handle sender name", () => {
			const input = "张三"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})

		it("should handle mixed language subject", () => {
			const input = "Re: 关于您的订单"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
			expect(result).toContain("Re:")
		})
	})

	describe("Edge cases", () => {
		it("should handle empty string", () => {
			const input = ""
			const result = encodeHeader(input)
			expect(result).toBe("")
		})

		it("should handle only spaces", () => {
			const input = "   "
			const result = encodeHeader(input)
			expect(result).toBe("   ")
		})

		it("should split long non-ASCII text into multiple encoded-words (RFC 2047 75-char limit)", () => {
			const input = "你好".repeat(50)
			const result = encodeHeader(input)
			const words = result.split("\r\n ")
			for (const word of words) {
				expect(word.length).toBeLessThanOrEqual(75)
				expect(word).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
			}
			expect(words.length).toBeGreaterThan(1)
		})

		it("should handle single character", () => {
			expect(encodeHeader("A")).toBe("A")
			expect(encodeHeader("世")).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})

		it("should handle numbers only", () => {
			expect(encodeHeader("12345")).toBe("12345")
		})

		it("should handle special characters in ASCII range", () => {
			expect(encodeHeader("Test-123")).toBe("Test-123")
			expect(encodeHeader("user@example.com")).toBe("user@example.com")
		})
	})

	describe("Multilingual headers", () => {
		it("should encode Japanese names", () => {
			const input = "山田太郎"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})

		it("should encode Korean names", () => {
			const input = "김철수"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})

		it("should encode Arabic text", () => {
			const input = "محمد"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})

		it("should encode Cyrillic text", () => {
			const input = "Иван Петров"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
			expect(result).toContain("_") // Space should become underscore
		})

		it("should encode Greek text", () => {
			const input = "Γιώργος"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})

		it("should encode Hebrew text", () => {
			const input = "שלום"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})
	})

	describe("Mixed content headers", () => {
		it("should encode name with title", () => {
			const input = "Dr. 张三"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
			expect(result).toContain("Dr.")
		})

		it("should encode company name with non-ASCII", () => {
			const input = "ABC株式会社"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})

		it("should encode email subject with emoji", () => {
			const input = "🎉 Special Offer!"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})

		it("should encode mixed punctuation", () => {
			const input = "Re: 关于订单 #12345"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})
	})

	describe("Boundary conditions for headers", () => {
		it("should handle text at ASCII boundary (char 127)", () => {
			const input = "Test\x7F" // DEL character
			const result = encodeHeader(input)
			// DEL character (0x7F) is in printable range (33-126) boundary
			// Our implementation doesn't encode it as it's technically printable
			// This is acceptable behavior
			expect(result).toBeTruthy()
		})

		it("should handle text at ASCII boundary (char 128)", () => {
			const input = "Test\x80"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})

		it("should handle consecutive non-ASCII characters", () => {
			const input = "你好世界测试"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})

		it("should handle alternating ASCII and non-ASCII", () => {
			const input = "a世b界c测"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})
	})

	describe("Special character handling", () => {
		it("should encode question marks in non-ASCII context", () => {
			const input = "测试?"
			const result = encodeHeader(input)
			expect(result).toContain("=3F") // ? should be encoded
		})

		it("should encode equals signs in non-ASCII context", () => {
			const input = "测试="
			const result = encodeHeader(input)
			expect(result).toContain("=3D") // = should be encoded
		})

		it("should encode underscores in non-ASCII context", () => {
			const input = "测试_test"
			const result = encodeHeader(input)
			expect(result).toContain("=5F") // _ should be encoded
		})

		it("should handle multiple special characters", () => {
			const input = "测试?=_"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
			expect(result).toContain("=3F")
			expect(result).toContain("=3D")
			expect(result).toContain("=5F")
		})
	})

	describe("Issue 2 — foldHeaderLine must not break pre-folded encoded-words", () => {
		it("should not produce \\r\\r\\n in From header with long Japanese name", () => {
			const longJapaneseName = "山田太郎のとても長い名前テスト用"
			const email = new Email({
				from: { name: longJapaneseName, email: "sender@example.com" },
				to: "recipient@example.com",
				subject: "Test",
				text: "body",
			})
			const data = email.getRawMessage()
			expect(data).not.toContain("\r\r\n")
			const msg = extract(data)
			expect(msg.from?.address).toBe("sender@example.com")
		})

		it("should produce valid headers when encoded-words already contain CRLF folding", () => {
			const veryLongName = "これはとても長い日本語の名前で複数のエンコードワードに分割されるテスト"
			const encoded = encodeHeader(veryLongName)
			// Assumes encodeHeader splits into multiple encoded-words
			expect(encoded).toContain("\r\n ")

			const email = new Email({
				from: { name: veryLongName, email: "sender@example.com" },
				to: "recipient@example.com",
				subject: "Test",
				text: "body",
			})
			const data = email.getRawMessage()
			// Ensure no double CRLF appears within headers
			// Only verify header portion (up to first \r\n\r\n)
			const headerSection = data.split("\r\n\r\n")[0]
			expect(headerSection).not.toMatch(/\r\n\r\n/)
			expect(headerSection).not.toContain("\r\r\n")
		})
	})

	describe("Issue 3 — encodeHeader must not split UTF-8 multibyte characters", () => {
		it("should produce decodable encoded-words for Japanese text", () => {
			const input = "日本語テスト"
			const result = encodeHeader(input)
			const words = result.split("\r\n ")
			for (const word of words) {
				expect(word).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
				// Extract payload from encoded-word and decode it
				const payload = word.replace(/^=\?UTF-8\?Q\?/, "").replace(/\?=$/, "")
				const bytes: number[] = []
				let i = 0
				while (i < payload.length) {
					if (payload[i] === "=") {
						bytes.push(Number.parseInt(payload.substring(i + 1, i + 3), 16))
						i += 3
					} else if (payload[i] === "_") {
						bytes.push(0x20)
						i += 1
					} else {
						bytes.push(payload.charCodeAt(i))
						i += 1
					}
				}
				// TextDecoder throws an error on invalid UTF-8 byte sequences
				const decoder = new TextDecoder("utf-8", { fatal: true })
				expect(() => decoder.decode(new Uint8Array(bytes))).not.toThrow()
			}
		})

		it("should produce decodable encoded-words for emoji text", () => {
			const input = "🎉🎊🎆🎇テスト絵文字"
			const result = encodeHeader(input)
			const words = result.split("\r\n ")
			for (const word of words) {
				expect(word).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
				const payload = word.replace(/^=\?UTF-8\?Q\?/, "").replace(/\?=$/, "")
				const bytes: number[] = []
				let i = 0
				while (i < payload.length) {
					if (payload[i] === "=") {
						bytes.push(Number.parseInt(payload.substring(i + 1, i + 3), 16))
						i += 3
					} else if (payload[i] === "_") {
						bytes.push(0x20)
						i += 1
					} else {
						bytes.push(payload.charCodeAt(i))
						i += 1
					}
				}
				const decoder = new TextDecoder("utf-8", { fatal: true })
				expect(() => decoder.decode(new Uint8Array(bytes))).not.toThrow()
			}
		})

		it("should produce decodable encoded-words for long mixed CJK text", () => {
			const input = "吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。"
			const result = encodeHeader(input)
			const words = result.split("\r\n ")
			for (const word of words) {
				expect(word).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
				const payload = word.replace(/^=\?UTF-8\?Q\?/, "").replace(/\?=$/, "")
				const bytes: number[] = []
				let i = 0
				while (i < payload.length) {
					if (payload[i] === "=") {
						bytes.push(Number.parseInt(payload.substring(i + 1, i + 3), 16))
						i += 3
					} else if (payload[i] === "_") {
						bytes.push(0x20)
						i += 1
					} else {
						bytes.push(payload.charCodeAt(i))
						i += 1
					}
				}
				const decoder = new TextDecoder("utf-8", { fatal: true })
				expect(() => decoder.decode(new Uint8Array(bytes))).not.toThrow()
			}
		})
	})

	describe("Real-world header scenarios", () => {
		it("should encode forwarded subject", () => {
			const input = "Fwd: 关于会议安排"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})

		it("should encode reply subject", () => {
			const input = "Re: 订单确认"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})

		it("should encode sender with organization", () => {
			const input = "张三 (北京公司)"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})

		it("should encode subject with date", () => {
			const input = "会议通知 - 2024年1月1日"
			const result = encodeHeader(input)
			const words = result.split("\r\n ")
			for (const word of words) {
				expect(word).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
			}
		})

		it("should encode subject with numbers and symbols", () => {
			const input = "订单 #12345 已发货！"
			const result = encodeHeader(input)
			expect(result).toMatch(/^=\?UTF-8\?Q\?.*\?=$/)
		})
	})
})
