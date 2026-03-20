import { describe, expect, it } from "vitest"
import {
	arrayBufferToBase64,
	decode,
	encode,
	encodeQuotedPrintable,
	fromBase64,
	fromBase64ToBytes,
	toBase64,
} from "../../src/encoding"

describe("Quoted-Printable encoding (RFC 2045 Section 6.7)", () => {
	it("Rule 1: encodes non-ASCII bytes as =XX", () => {
		const result = encodeQuotedPrintable("\xC0\xE9")
		expect(result).toMatch(/=[0-9A-F]{2}/g)
		expect(result).not.toMatch(/[\x80-\xFF]/)
	})

	it("Rule 2: preserves literal TAB (0x09) and SPACE (0x20) mid-line", () => {
		const result = encodeQuotedPrintable("hello\tworld here")
		expect(result).toContain("\t")
		expect(result).toContain(" ")
	})

	it("Rule 3: encodes = as =3D", () => {
		const result = encodeQuotedPrintable("a=b")
		expect(result).toBe("a=3Db")
	})

	it("Rule 4: preserves CRLF line endings", () => {
		const result = encodeQuotedPrintable("line1\r\nline2")
		expect(result).toBe("line1\r\nline2")
	})

	it("Rule 5: inserts soft line break at 76 chars", () => {
		const input = "x".repeat(80)
		const result = encodeQuotedPrintable(input)
		const lines = result.split("\r\n")
		for (const line of lines) {
			expect(line.length).toBeLessThanOrEqual(76)
		}
	})

	it("does not break multi-byte UTF-8 sequences across soft breaks", () => {
		// 3-byte CJK characters - each encodes as 9 chars (=XX=XX=XX)
		const input = "\u6F22\u5B57".repeat(10)
		const result = encodeQuotedPrintable(input)
		// Each =XX=XX=XX should not be split by =\r\n within a character
		const fragments = result.replace(/=\r\n/g, "")
		const decoded = fragments.replace(/=([0-9A-F]{2})/g, (_, hex) =>
			String.fromCharCode(Number.parseInt(hex, 16)),
		)
		const bytes = new Uint8Array([...decoded].map((c) => c.charCodeAt(0)))
		expect(new TextDecoder().decode(bytes)).toBe(input)
	})

	it("Rule 3: trailing whitespace before CRLF is encoded", () => {
		const result = encodeQuotedPrintable("hello \r\nworld\t\r\n")
		// Space before CRLF should be encoded as =20
		expect(result).toContain("=20\r\n")
		// Tab before CRLF should be encoded as =09
		expect(result).toContain("=09\r\n")
	})

	it("trailing whitespace at end of input is encoded", () => {
		const result = encodeQuotedPrintable("hello ")
		// Trailing space at end should be encoded
		expect(result).toBe("hello=20")
	})

	it("trailing tab at end of input is encoded", () => {
		const result = encodeQuotedPrintable("hello\t")
		expect(result).toBe("hello=09")
	})

	it("lone CR (no LF) is encoded as =0D", () => {
		const result = encodeQuotedPrintable("hello\rworld")
		expect(result).toContain("=0D")
	})

	it("handles empty string", () => {
		expect(encodeQuotedPrintable("")).toBe("")
	})

	it("soft break does not split =XX encoding", () => {
		// Create a string that would cause a soft break right at an encoded character
		const input = "a".repeat(73) + "\xFF"
		const result = encodeQuotedPrintable(input)
		const lines = result.split("\r\n")
		for (const line of lines) {
			// No line should end with "=" followed by less than 2 hex digits
			// (except soft break "=" at end)
			const cleaned = line.replace(/=$/, "")
			expect(cleaned).not.toMatch(/=[0-9A-F]$/)
		}
	})

	it("encodes input where every byte is non-ASCII", () => {
		const input = "\u00FF\u00FE\u00FD"
		const result = encodeQuotedPrintable(input)
		const lines = result.split("\r\n")
		for (const line of lines) {
			expect(line.length).toBeLessThanOrEqual(76)
		}
		expect(result).not.toMatch(/[\x80-\xFF]/)
	})
})

describe("Base64 encoding (RFC 2045 Section 6.8)", () => {
	it("encodes ASCII string correctly", () => {
		expect(toBase64("Hello")).toBe(btoa("Hello"))
	})

	it("encodes UTF-8 string via TextEncoder (bypasses btoa Latin-1 limit)", () => {
		const result = toBase64("\u65E5\u672C\u8A9E")
		expect(result).toBeTruthy()
		// Verify round-trip: decode base64 -> bytes -> UTF-8
		const binary = atob(result)
		const bytes = new Uint8Array([...binary].map((c) => c.charCodeAt(0)))
		expect(new TextDecoder().decode(bytes)).toBe("\u65E5\u672C\u8A9E")
	})

	it("converts ArrayBuffer to Base64", () => {
		const buffer = new TextEncoder().encode("test").buffer
		const result = arrayBufferToBase64(buffer)
		expect(atob(result)).toBe("test")
	})

	it("handles non-Latin-1 safely (Workers btoa constraint)", () => {
		// This would throw if using raw btoa() with non-Latin-1
		expect(() => toBase64("\u{1F600}")).not.toThrow()
		const result = toBase64("\u{1F600}")
		const binary = atob(result)
		const bytes = new Uint8Array([...binary].map((c) => c.charCodeAt(0)))
		expect(new TextDecoder().decode(bytes)).toBe("\u{1F600}")
	})
})

describe("fromBase64 / fromBase64ToBytes", () => {
	it("fromBase64 decodes valid base64 string", () => {
		expect(fromBase64(btoa("hello"))).toBe("hello")
	})

	it("fromBase64 throws on invalid base64", () => {
		expect(() => fromBase64("!!!invalid!!!")).toThrow("Invalid base64 encoding")
	})

	it("fromBase64ToBytes decodes to Uint8Array", () => {
		const bytes = fromBase64ToBytes(btoa("test"))
		expect(bytes).toBeInstanceOf(Uint8Array)
		expect(new TextDecoder().decode(bytes)).toBe("test")
	})

	it("fromBase64ToBytes throws on invalid base64", () => {
		expect(() => fromBase64ToBytes("!!!invalid!!!")).toThrow("Invalid base64 encoding")
	})
})

describe("UTF-8 encode/decode", () => {
	it("roundtrips ASCII", () => {
		expect(decode(encode("hello"))).toBe("hello")
	})

	it("roundtrips 4-byte characters (emoji/non-BMP)", () => {
		const emoji = "\u{1F4E7}\u{1F600}"
		expect(decode(encode(emoji))).toBe(emoji)
	})
})
