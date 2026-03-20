import { describe, expect, it } from "vitest"
import { previewEmail } from "../../src/preview"

describe("previewEmail", () => {
	const opts = { from: "a@b.com", to: "c@d.com", subject: "Test", text: "hello" }

	it("returns EmailPreview with headers object", () => {
		const preview = previewEmail(opts)
		expect(preview.headers).toBeDefined()
		expect(typeof preview.headers).toBe("object")
	})

	it("text-only email: text field populated, html undefined", () => {
		const preview = previewEmail(opts)
		expect(preview.text).toBe("hello")
		expect(preview.html).toBeUndefined()
	})

	it("html email: html field populated", () => {
		const preview = previewEmail({ ...opts, html: "<b>hi</b>" })
		expect(preview.html).toBe("<b>hi</b>")
	})

	it("raw contains full RFC 5322 message with headers and body", () => {
		const preview = previewEmail(opts)
		expect(preview.raw).toContain("From:")
		expect(preview.raw).toContain("To:")
		expect(preview.raw).toContain("hello")
	})

	it("text+html: both fields populated", () => {
		const preview = previewEmail({ ...opts, html: "<b>hi</b>" })
		expect(preview.text).toBe("hello")
		expect(preview.html).toBe("<b>hi</b>")
	})

	it("headers include standard fields (From, To, Subject, Date)", () => {
		const preview = previewEmail(opts)
		expect(preview.headers.From).toBeDefined()
		expect(preview.headers.To).toBeDefined()
		expect(preview.headers.Subject).toBeDefined()
		expect(preview.headers.Date).toBeDefined()
	})
})
