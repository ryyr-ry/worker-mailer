import { describe, expect, it } from "vitest"
import { threadHeaders } from "../../src/thread"

describe("Thread headers (RFC 5322 Section 3.6.4)", () => {
	it("In-Reply-To set from inReplyTo", () => {
		const h = threadHeaders({ inReplyTo: "<abc@example.com>" })
		expect(h["In-Reply-To"]).toBe("<abc@example.com>")
	})

	it("References equals inReplyTo when no prior references", () => {
		const h = threadHeaders({ inReplyTo: "<abc@example.com>" })
		expect(h.References).toBe("<abc@example.com>")
	})

	it("References appends inReplyTo to existing chain", () => {
		const h = threadHeaders({
			inReplyTo: "<new@example.com>",
			references: "<old@example.com>",
		})
		expect(h.References).toBe("<old@example.com> <new@example.com>")
	})

	it("multiple message IDs in references preserved", () => {
		const refs = "<a@x.com> <b@x.com>"
		const h = threadHeaders({ inReplyTo: "<c@x.com>", references: refs })
		expect(h.References).toBe("<a@x.com> <b@x.com> <c@x.com>")
	})

	it("CRLF in inReplyTo throws error (injection prevention)", () => {
		expect(() => threadHeaders({ inReplyTo: "<abc@x.com>\r\nEvil: header" })).toThrow()
	})

	it("CRLF in references throws error (injection prevention)", () => {
		expect(() =>
			threadHeaders({
				inReplyTo: "<abc@x.com>",
				references: "<a@x.com>\r\nEvil: header",
			}),
		).toThrow()
	})

	it("returns correct ThreadHeaders type", () => {
		const h = threadHeaders({ inReplyTo: "<abc@x.com>" })
		expect(h).toHaveProperty("In-Reply-To")
		expect(h).toHaveProperty("References")
	})
})

describe("Thread validation edge cases", () => {
	it("Message-ID with whitespace is rejected", () => {
		expect(() => threadHeaders({ inReplyTo: "<abc @x.com>" })).toThrow("Invalid Message-ID")
	})

	it("Message-ID with tab is rejected", () => {
		expect(() => threadHeaders({ inReplyTo: "<abc\t@x.com>" })).toThrow("Invalid Message-ID")
	})

	it("whitespace in References Message-ID is rejected", () => {
		expect(() => threadHeaders({ inReplyTo: "<a@x.com>", references: "<b @x.com>" })).toThrow(
			"Invalid Message-ID",
		)
	})

	it("leading/trailing whitespace in inReplyTo is trimmed", () => {
		const h = threadHeaders({ inReplyTo: "  <abc@x.com>  " })
		expect(h["In-Reply-To"]).toBe("<abc@x.com>")
	})
})
