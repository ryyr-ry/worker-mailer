import { describe, expect, it } from "vitest"
import { Email } from "../../src/email/email"
import { CrlfInjectionError, EmailValidationError } from "../../src/errors"

const PNG_1PX =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

const GIF_1PX = "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="

function makeEmail(overrides: Record<string, unknown> = {}) {
	return new Email({
		from: "sender@example.com",
		to: "recipient@example.com",
		subject: "Test",
		html: '<img src="cid:logo">',
		inlineAttachments: [
			{
				cid: "logo",
				filename: "logo.png",
				content: PNG_1PX,
			},
		],
		...overrides,
	})
}

describe("Inline images (CID)", () => {
	it("correct MIME structure for single inline image", () => {
		const raw = makeEmail().getRawMessage()
		expect(raw).toContain("multipart/related")
		expect(raw).toContain("Content-ID: <logo>")
		expect(raw).toContain("Content-Type: image/png")
	})

	it("Content-ID: <cid> included in headers", () => {
		const raw = makeEmail().getRawMessage()
		expect(raw).toMatch(/Content-ID: <logo>\r\n/)
	})

	it("Content-Disposition: inline is set", () => {
		const raw = makeEmail().getRawMessage()
		expect(raw).toMatch(/Content-Disposition: inline; filename="logo\.png"/)
	})

	it("multiple inline images stored correctly", () => {
		const email = makeEmail({
			html: '<img src="cid:logo"><img src="cid:banner">',
			inlineAttachments: [
				{ cid: "logo", filename: "logo.png", content: PNG_1PX },
				{ cid: "banner", filename: "banner.gif", content: GIF_1PX },
			],
		})
		const raw = email.getRawMessage()
		expect(raw).toContain("Content-ID: <logo>")
		expect(raw).toContain("Content-ID: <banner>")
		expect(raw).toContain("Content-Type: image/png")
		expect(raw).toContain("Content-Type: image/gif")
	})

	it("text + html + inline produces multipart/alternative > multipart/related", () => {
		const email = makeEmail({ text: "plain fallback" })
		const raw = email.getRawMessage()
		expect(raw).toContain("multipart/alternative")
		expect(raw).toContain("multipart/related")
		expect(raw).toContain("Content-ID: <logo>")
		expect(raw).toContain("text/plain")
		const altIdx = raw.indexOf("multipart/alternative")
		const relIdx = raw.indexOf("multipart/related")
		const plainIdx = raw.indexOf("text/plain")
		expect(altIdx).toBeLessThan(relIdx)
		expect(altIdx).toBeLessThan(plainIdx)
	})

	it("text + html + inline + attach produces full 4-layer structure", () => {
		const email = makeEmail({
			text: "plain fallback",
			attachments: [
				{
					filename: "doc.pdf",
					content: "JVBERi0xLjQK",
					mimeType: "application/pdf",
				},
			],
		})
		const raw = email.getRawMessage()
		expect(raw).toContain("multipart/mixed")
		expect(raw).toContain("multipart/alternative")
		expect(raw).toContain("multipart/related")
		expect(raw).toContain("Content-ID: <logo>")
		expect(raw).toContain('Content-Disposition: attachment; filename="doc.pdf"')
	})

	it("html + inline (no text) produces multipart/related", () => {
		const raw = makeEmail().getRawMessage()
		expect(raw).toContain("multipart/related")
		expect(raw).not.toContain("multipart/alternative")
	})

	it("duplicate CID throws error", () => {
		expect(() =>
			makeEmail({
				inlineAttachments: [
					{ cid: "logo", filename: "a.png", content: PNG_1PX },
					{ cid: "logo", filename: "b.png", content: PNG_1PX },
				],
			}),
		).toThrow(EmailValidationError)
	})

	it("inlineAttachments without HTML throws error", () => {
		expect(
			() =>
				new Email({
					from: "sender@example.com",
					to: "recipient@example.com",
					subject: "Test",
					text: "plain only",
					inlineAttachments: [{ cid: "logo", filename: "logo.png", content: PNG_1PX }],
				}),
		).toThrow(EmailValidationError)
	})

	it("CRLF in CID throws error", () => {
		expect(() =>
			makeEmail({
				inlineAttachments: [{ cid: "logo\r\nEvil: header", filename: "a.png", content: PNG_1PX }],
			}),
		).toThrow(CrlfInjectionError)
	})

	it("angle brackets in CID throws error", () => {
		expect(() =>
			makeEmail({
				inlineAttachments: [{ cid: "<logo>", filename: "a.png", content: PNG_1PX }],
			}),
		).toThrow(EmailValidationError)
	})

	it("empty CID throws error", () => {
		expect(() =>
			makeEmail({
				inlineAttachments: [{ cid: "", filename: "a.png", content: PNG_1PX }],
			}),
		).toThrow(EmailValidationError)
	})

	it("auto-detects MIME type for png, jpg, gif, svg", () => {
		const cases = [
			{ filename: "img.png", expected: "image/png" },
			{ filename: "photo.jpg", expected: "image/jpeg" },
			{ filename: "photo.jpeg", expected: "image/jpeg" },
			{ filename: "anim.gif", expected: "image/gif" },
			{ filename: "icon.svg", expected: "image/svg+xml" },
		]
		for (const { filename, expected } of cases) {
			const email = makeEmail({
				inlineAttachments: [{ cid: "img", filename, content: PNG_1PX }],
			})
			const raw = email.getRawMessage()
			expect(raw).toContain(`Content-Type: ${expected}`)
		}
	})

	it("explicit mimeType overrides auto-detection", () => {
		const email = makeEmail({
			inlineAttachments: [
				{
					cid: "logo",
					filename: "logo.png",
					content: PNG_1PX,
					mimeType: "image/webp",
				},
			],
		})
		const raw = email.getRawMessage()
		expect(raw).toContain("Content-Type: image/webp")
		expect(raw).not.toMatch(/Content-Type: image\/png; name="logo\.png"/)
	})

	it("getRawMessage() includes inline images in full output", () => {
		const raw = makeEmail().getRawMessage()
		expect(raw).toContain("MIME-Version: 1.0")
		expect(raw).toContain("Content-ID: <logo>")
		expect(raw).toContain("Content-Transfer-Encoding: base64")
		expect(raw).toContain("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAA")
	})

	it("Uint8Array content is encoded as base64", () => {
		const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
		const email = makeEmail({
			inlineAttachments: [{ cid: "logo", filename: "logo.png", content: bytes }],
		})
		const raw = email.getRawMessage()
		expect(raw).toContain("Content-ID: <logo>")
		expect(raw).toContain("Content-Transfer-Encoding: base64")
	})

	it("Uint8Array content is correctly base64 encoded", () => {
		const bytes = new Uint8Array([72, 101, 108, 108, 111])
		const email = makeEmail({
			inlineAttachments: [
				{ cid: "data", filename: "data.bin", content: bytes, mimeType: "application/octet-stream" },
			],
		})
		const raw = email.getRawMessage()
		expect(raw).toContain("SGVsbG8=")
	})

	it("ArrayBuffer content is correctly base64 encoded", () => {
		const bytes = new Uint8Array([72, 101, 108, 108, 111])
		const email = makeEmail({
			inlineAttachments: [
				{
					cid: "data",
					filename: "data.bin",
					content: bytes.buffer,
					mimeType: "application/octet-stream",
				},
			],
		})
		const raw = email.getRawMessage()
		expect(raw).toContain("SGVsbG8=")
	})

	it("related and mixed boundaries are different", () => {
		const email = makeEmail({
			text: "plain fallback",
			attachments: [{ filename: "doc.pdf", content: "JVBERi0xLjQK", mimeType: "application/pdf" }],
		})
		const raw = email.getRawMessage()
		const boundaryMatches = [...raw.matchAll(/boundary="([^"]+)"/g)]
		const boundaries = boundaryMatches.map((m) => m[1])
		const unique = new Set(boundaries)
		expect(unique.size).toBe(boundaries.length)
	})

	it("base64 lines are at most 76 characters", () => {
		const longContent = btoa("A".repeat(200))
		const email = makeEmail({
			inlineAttachments: [{ cid: "logo", filename: "logo.png", content: longContent }],
		})
		const raw = email.getRawMessage()
		const base64Section = raw.split("Content-Transfer-Encoding: base64\r\n\r\n")[1]
		if (base64Section) {
			const endIdx = base64Section.indexOf("\r\n--")
			const base64Block = endIdx >= 0 ? base64Section.slice(0, endIdx) : base64Section
			const lines = base64Block.split("\r\n").filter((l) => l.length > 0)
			for (const line of lines) {
				expect(line.length).toBeLessThanOrEqual(76)
			}
		}
	})

	it("file without extension defaults to application/octet-stream", () => {
		const email = makeEmail({
			inlineAttachments: [
				{ cid: "data", filename: "noext", content: PNG_1PX, mimeType: undefined },
			],
		})
		const raw = email.getRawMessage()
		expect(raw).toContain("Content-Type: application/octet-stream")
	})

	it("text+html+inline: related is nested inside alternative boundary", () => {
		const email = makeEmail({ text: "plain fallback" })
		const raw = email.getRawMessage()
		const altMatch = raw.match(/multipart\/alternative;\s*boundary="([^"]+)"/)
		expect(altMatch).not.toBeNull()
		const altBoundary = altMatch![1]
		const altStart = raw.indexOf(`--${altBoundary}`)
		const altEnd = raw.indexOf(`--${altBoundary}--`)
		const relIdx = raw.indexOf("multipart/related")
		expect(relIdx).toBeGreaterThan(altStart)
		expect(relIdx).toBeLessThan(altEnd)
	})

	it("html + inline + attach (no text) produces mixed > related", () => {
		const email = makeEmail({
			attachments: [
				{
					filename: "doc.pdf",
					content: "JVBERi0xLjQK",
					mimeType: "application/pdf",
				},
			],
		})
		const raw = email.getRawMessage()
		expect(raw).toContain("multipart/mixed")
		expect(raw).toContain("multipart/related")
		expect(raw).not.toContain("multipart/alternative")
		expect(raw).toContain("Content-ID: <logo>")
		expect(raw).toContain('Content-Disposition: attachment; filename="doc.pdf"')
	})
})
