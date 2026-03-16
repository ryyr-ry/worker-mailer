import { beforeAll, describe, expect, it } from "vitest"
import {
	canonicalizeRelaxedBody,
	canonicalizeRelaxedHeader,
	canonicalizeSimpleBody,
	canonicalizeSimpleHeader,
	importDkimKey,
	signDkim,
} from "../../src/dkim"

function toBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer)
	let binary = ""
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i])
	}
	return btoa(binary)
}

function fromBase64(b64: string): Uint8Array {
	const binary = atob(b64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i)
	}
	return bytes
}

function exportKeyToPem(exported: ArrayBuffer): string {
	const b64 = toBase64(exported)
	const lines = b64.match(/.{1,64}/g)?.join("\n") ?? b64
	return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`
}

function buildTestMessage(): string {
	return [
		"From: sender@example.com",
		"To: recipient@example.com",
		"Subject: Test Message",
		"Date: Mon, 01 Jan 2024 00:00:00 +0000",
		"Message-ID: <test@example.com>",
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"",
		"Hello, this is a test message body.",
	].join("\r\n")
}

function extractDkimHeader(signedMessage: string): string {
	const lines = signedMessage.split("\r\n")
	const dkimLines: string[] = [lines[0]]
	for (let i = 1; i < lines.length; i++) {
		if (/^[ \t]/.test(lines[i])) dkimLines.push(lines[i])
		else break
	}
	return dkimLines.join("\r\n")
}

function parseDkimTags(dkimHeader: string): Record<string, string> {
	const unfolded = dkimHeader.replace(/\r\n[ \t]/g, " ")
	const tagStr = unfolded.replace(/^DKIM-Signature:\s*/, "")
	const tags: Record<string, string> = {}
	for (const part of tagStr.split(";")) {
		const trimmed = part.trim()
		if (!trimmed) continue
		const eqIdx = trimmed.indexOf("=")
		if (eqIdx === -1) continue
		tags[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim()
	}
	return tags
}

function parseTestHeaders(headerSection: string): { name: string; value: string }[] {
	const headers: { name: string; value: string }[] = []
	for (const line of headerSection.split("\r\n")) {
		if (line === "") continue
		if (/^[ \t]/.test(line) && headers.length > 0) {
			headers[headers.length - 1].value += `\r\n${line}`
		} else {
			const colonIdx = line.indexOf(":")
			if (colonIdx === -1) continue
			headers.push({
				name: line.substring(0, colonIdx),
				value: line.substring(colonIdx + 1),
			})
		}
	}
	return headers
}

function buildVerificationInput(
	signedMessage: string,
	dkimHeader: string,
	headerNames: string[],
): string {
	const splitIdx = signedMessage.indexOf("\r\n\r\n")
	const headerSection = signedMessage.substring(0, splitIdx)
	const allHeaders = parseTestHeaders(headerSection)
	const nonDkim = allHeaders.filter((h) => h.name.toLowerCase() !== "dkim-signature")
	const parts: string[] = []
	for (const name of headerNames) {
		const h = nonDkim.find((hdr) => hdr.name.toLowerCase() === name.toLowerCase())
		if (h) parts.push(canonicalizeRelaxedHeader(h.name, h.value))
	}
	const lastBIdx = dkimHeader.lastIndexOf("\tb=")
	const template = `${dkimHeader.substring(0, lastBIdx)}\tb=`
	const colonIdx = template.indexOf(":")
	parts.push(
		canonicalizeRelaxedHeader(template.substring(0, colonIdx), template.substring(colonIdx + 1)),
	)
	return parts.join("\r\n")
}

describe("DKIM signing", () => {
	let testKeyPair: CryptoKeyPair
	let testPem: string

	beforeAll(async () => {
		testKeyPair = await crypto.subtle.generateKey(
			{
				name: "RSASSA-PKCS1-v1_5",
				modulusLength: 2048,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: "SHA-256",
			},
			true,
			["sign", "verify"],
		)
		const exported = await crypto.subtle.exportKey("pkcs8", testKeyPair.privateKey)
		testPem = exportKeyToPem(exported)
	})

	describe("importDkimKey", () => {
		it("imports CryptoKey from PKCS#8 PEM string", async () => {
			const key = await importDkimKey(testPem)
			expect(key).toBeDefined()
			expect(key.type).toBe("private")
			expect(key.algorithm).toMatchObject({ name: "RSASSA-PKCS1-v1_5" })
		})

		it("throws on invalid PEM", async () => {
			await expect(importDkimKey("not-a-pem")).rejects.toThrow()
		})

		it("throws on empty string", async () => {
			await expect(importDkimKey("")).rejects.toThrow("empty or invalid")
		})

		it("handles PEM with BEGIN RSA PRIVATE KEY header", async () => {
			const pkcs1Pem =
				"-----BEGIN RSA PRIVATE KEY-----\nMIIBogIBAAJBALRiMLAH\n-----END RSA PRIVATE KEY-----"
			await expect(importDkimKey(pkcs1Pem)).rejects.toThrow("PKCS#1")
		})
	})

	describe("canonicalizeRelaxedHeader", () => {
		it("lowercases header name", () => {
			expect(canonicalizeRelaxedHeader("Subject", " Test")).toBe("subject:Test")
		})

		it("collapses consecutive whitespace to single space", () => {
			const result = canonicalizeRelaxedHeader("Subject", "  hello   world  ")
			expect(result).toBe("subject:hello world")
		})

		it("removes trailing whitespace", () => {
			const result = canonicalizeRelaxedHeader("Subject", " hello  ")
			expect(result).toBe("subject:hello")
		})

		it("unfolds folded header lines", () => {
			const result = canonicalizeRelaxedHeader("Subject", " hello\r\n\tworld")
			expect(result).toBe("subject:hello world")
		})
	})

	describe("canonicalizeRelaxedBody", () => {
		it("removes trailing empty lines", () => {
			const result = canonicalizeRelaxedBody("Hello\r\n\r\n\r\n")
			expect(result).toBe("Hello\r\n")
		})

		it("removes trailing whitespace from each line", () => {
			const result = canonicalizeRelaxedBody("Hello   \r\nWorld\t\t\r\n")
			expect(result).toBe("Hello\r\nWorld\r\n")
		})

		it("returns \\r\\n for empty body", () => {
			expect(canonicalizeRelaxedBody("")).toBe("\r\n")
			expect(canonicalizeRelaxedBody("\r\n")).toBe("\r\n")
		})

		it("preserves consecutive empty lines (except trailing)", () => {
			const body = "Line1\r\n\r\n\r\nLine2\r\n\r\n"
			const result = canonicalizeRelaxedBody(body)
			expect(result).toBe("Line1\r\n\r\n\r\nLine2\r\n")
		})
	})

	describe("canonicalizeSimple", () => {
		it("simple header returns input as-is", () => {
			const result = canonicalizeSimpleHeader("Subject", " Hello World ")
			expect(result).toBe("Subject: Hello World ")
		})

		it("simple body removes only trailing empty lines", () => {
			const body = "Hello  \r\nWorld\r\n\r\n\r\n"
			const result = canonicalizeSimpleBody(body)
			expect(result).toBe("Hello  \r\nWorld\r\n")
		})

		it("returns \\r\\n for empty body", () => {
			expect(canonicalizeSimpleBody("")).toBe("\r\n")
			expect(canonicalizeSimpleBody("\r\n")).toBe("\r\n")
		})
	})

	describe("signDkim", () => {
		it("inserts DKIM-Signature header at message start", async () => {
			const rawMessage = buildTestMessage()
			const signed = await signDkim(rawMessage, {
				domainName: "example.com",
				keySelector: "test",
				privateKey: testKeyPair.privateKey,
			})
			expect(signed.startsWith("DKIM-Signature:")).toBe(true)
			expect(signed).toContain(rawMessage)
		})

		it("includes all required tags (v, a, d, s, h, bh, b, c)", async () => {
			const rawMessage = buildTestMessage()
			const signed = await signDkim(rawMessage, {
				domainName: "example.com",
				keySelector: "test",
				privateKey: testKeyPair.privateKey,
			})
			const dkimHeader = extractDkimHeader(signed)
			const tags = parseDkimTags(dkimHeader)
			expect(tags.v).toBe("1")
			expect(tags.a).toBe("rsa-sha256")
			expect(tags.c).toBe("relaxed/relaxed")
			expect(tags.d).toBe("example.com")
			expect(tags.s).toBe("test")
			expect(tags.h).toBeDefined()
			expect(tags.bh).toMatch(/^[A-Za-z0-9+/]+=*$/)
			expect(tags.bh.length).toBeGreaterThan(40)
			expect(tags.b).toMatch(/^[A-Za-z0-9+/\s]+=*$/)
			expect(tags.b.replace(/\s/g, "").length).toBeGreaterThan(100)
		})

		it("signs only specified headers when headerFieldNames provided", async () => {
			const rawMessage = buildTestMessage()
			const signed = await signDkim(rawMessage, {
				domainName: "example.com",
				keySelector: "test",
				privateKey: testKeyPair.privateKey,
				headerFieldNames: ["from", "to", "subject"],
			})
			const dkimHeader = extractDkimHeader(signed)
			const tags = parseDkimTags(dkimHeader)
			expect(tags.h).toBe("from:to:subject")
		})

		it("auto-selects major headers when headerFieldNames not provided", async () => {
			const rawMessage = buildTestMessage()
			const signed = await signDkim(rawMessage, {
				domainName: "example.com",
				keySelector: "test",
				privateKey: testKeyPair.privateKey,
			})
			const dkimHeader = extractDkimHeader(signed)
			const tags = parseDkimTags(dkimHeader)
			const headerNames = tags.h.split(":")
			expect(headerNames).toContain("from")
			expect(headerNames).toContain("to")
			expect(headerNames).toContain("subject")
			expect(headerNames).toContain("date")
			expect(headerNames).toContain("message-id")
		})

		it("works with CryptoKey passed directly", async () => {
			const rawMessage = buildTestMessage()
			const signed = await signDkim(rawMessage, {
				domainName: "example.com",
				keySelector: "test",
				privateKey: testKeyPair.privateKey,
			})
			expect(signed.startsWith("DKIM-Signature:")).toBe(true)
			const tags = parseDkimTags(extractDkimHeader(signed))
			expect(tags.b.length).toBeGreaterThan(0)
		})

		it("different canonicalization produces different signature", async () => {
			const rawMessage = buildTestMessage()
			const signedRelaxed = await signDkim(rawMessage, {
				domainName: "example.com",
				keySelector: "test",
				privateKey: testKeyPair.privateKey,
				canonicalization: "relaxed/relaxed",
			})
			const signedSimple = await signDkim(rawMessage, {
				domainName: "example.com",
				keySelector: "test",
				privateKey: testKeyPair.privateKey,
				canonicalization: "simple/simple",
			})
			const tagsRelaxed = parseDkimTags(extractDkimHeader(signedRelaxed))
			const tagsSimple = parseDkimTags(extractDkimHeader(signedSimple))
			expect(tagsRelaxed.b).not.toBe(tagsSimple.b)
		})

		it("signs message with empty body", async () => {
			const msg = "From: a@b.com\r\nTo: c@d.com\r\nSubject: Test\r\n\r\n"
			const signed = await signDkim(msg, {
				domainName: "example.com",
				keySelector: "test",
				privateKey: testKeyPair.privateKey,
			})
			expect(signed).toContain("bh=")
			const tags = parseDkimTags(extractDkimHeader(signed))
			// Empty body canonicalized to "\r\n", SHA-256 hash is fixed:
			expect(tags.bh).toBe("frcCV1k9oG9oKj3dpUqdJg1PxRT2RSN/XKdLCPjaYaY=")
		})

		it("signs message with multibyte UTF-8 body", async () => {
			const msg = "From: a@b.com\r\nTo: c@d.com\r\nSubject: Test\r\n\r\nこんにちは世界"
			const signed = await signDkim(msg, {
				domainName: "example.com",
				keySelector: "test",
				privateKey: testKeyPair.privateKey,
			})
			expect(signed.startsWith("DKIM-Signature:")).toBe(true)
			const tags = parseDkimTags(extractDkimHeader(signed))
			expect(tags.bh).toMatch(/^[A-Za-z0-9+/]+=*$/)
		})

		it("does not include l= tag (body length attack prevention)", async () => {
			const signed = await signDkim(buildTestMessage(), {
				domainName: "example.com",
				keySelector: "test",
				privateKey: testKeyPair.privateKey,
			})
			const dkimHeader = extractDkimHeader(signed)
			expect(dkimHeader).not.toContain("l=")
		})
	})

	describe("signature verification (round-trip)", () => {
		it("sign → verify with public key → success", async () => {
			const rawMessage = buildTestMessage()
			const signed = await signDkim(rawMessage, {
				domainName: "example.com",
				keySelector: "test",
				privateKey: testKeyPair.privateKey,
			})
			const dkimHeader = extractDkimHeader(signed)
			const tags = parseDkimTags(dkimHeader)

			// Verify body hash
			const bodyStart = signed.indexOf("\r\n\r\n") + 4
			const body = signed.substring(bodyStart)
			const canonBody = canonicalizeRelaxedBody(body)
			const bodyDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonBody))
			expect(tags.bh).toBe(toBase64(bodyDigest))

			// Verify signature
			const headerNames = tags.h.split(":")
			const signingInput = buildVerificationInput(signed, dkimHeader, headerNames)
			const sigBytes = fromBase64(tags.b.replace(/\s/g, ""))
			const isValid = await crypto.subtle.verify(
				"RSASSA-PKCS1-v1_5",
				testKeyPair.publicKey,
				sigBytes.buffer,
				new TextEncoder().encode(signingInput),
			)
			expect(isValid).toBe(true)
		})
	})

	describe("canonicalizeRelaxedHeader edge cases (A-M1)", () => {
		it("should handle empty value", () => {
			expect(canonicalizeRelaxedHeader("Subject", "")).toBe("subject:")
		})

		it("should handle tab-only value", () => {
			expect(canonicalizeRelaxedHeader("Subject", "\t")).toBe("subject:")
		})

		it("should collapse consecutive FWS characters", () => {
			const result = canonicalizeRelaxedHeader("Subject", "  \t  \t  hello  \t  ")
			expect(result).toBe("subject:hello")
		})

		it("should convert tab to space", () => {
			const result = canonicalizeRelaxedHeader("Subject", "\thello\tworld\t")
			expect(result).toBe("subject:hello world")
		})

		it("should handle Unicode non-breaking space (kept as-is)", () => {
			const result = canonicalizeRelaxedHeader("Subject", " hello\u00a0world ")
			expect(result).toBe("subject:hello\u00a0world")
		})
	})

	describe("RFC 6376 Section 3.4 canonicalization vectors (A-H1)", () => {
		it("relaxed header: lowercases and trims", () => {
			expect(canonicalizeRelaxedHeader("Subject", " Test  Value ")).toBe("subject:Test Value")
		})

		it("relaxed header: unfolds continuation lines", () => {
			const result = canonicalizeRelaxedHeader("Subject", " line1\r\n\tline2")
			expect(result).toBe("subject:line1 line2")
		})

		it("relaxed body: removes trailing empty lines", () => {
			expect(canonicalizeRelaxedBody("text\r\n\r\n\r\n")).toBe("text\r\n")
		})

		it("relaxed body: strips trailing WSP per line", () => {
			expect(canonicalizeRelaxedBody("hello \r\nworld\t\r\n")).toBe("hello\r\nworld\r\n")
		})

		it("relaxed body: empty body → CRLF", () => {
			expect(canonicalizeRelaxedBody("")).toBe("\r\n")
		})

		it("simple header: preserves original exactly", () => {
			const result = canonicalizeSimpleHeader("Subject", " Value  With  Spaces ")
			expect(result).toBe("Subject: Value  With  Spaces ")
		})

		it("simple body: preserves whitespace on lines", () => {
			expect(canonicalizeSimpleBody("hello \r\nworld\t\r\n")).toBe("hello \r\nworld\t\r\n")
		})

		it("simple body: removes only trailing empty lines", () => {
			expect(canonicalizeSimpleBody("text\r\n\r\n\r\n")).toBe("text\r\n")
		})

		it("simple body: empty body → CRLF", () => {
			expect(canonicalizeSimpleBody("")).toBe("\r\n")
		})
	})

	describe("signDkim with PEM string (A-M2)", () => {
		it("should accept PEM string as privateKey", async () => {
			const rawMessage = buildTestMessage()
			const signed = await signDkim(rawMessage, {
				domainName: "example.com",
				keySelector: "test",
				privateKey: testPem,
			})
			expect(signed.startsWith("DKIM-Signature:")).toBe(true)
			const tags = parseDkimTags(extractDkimHeader(signed))
			expect(tags.b.replace(/\s/g, "").length).toBeGreaterThan(100)
		})
	})

	describe("signature header 72-char folding (A-M3)", () => {
		it("should fold b= value into 72-char chunks", async () => {
			const signed = await signDkim(buildTestMessage(), {
				domainName: "example.com",
				keySelector: "test",
				privateKey: testKeyPair.privateKey,
			})
			const dkimHeader = extractDkimHeader(signed)
			const bLine = dkimHeader.substring(dkimHeader.lastIndexOf("\tb="))
			const bValue = bLine.replace(/^\tb=/, "")
			const chunks = bValue.split("\r\n\t ")
			for (const chunk of chunks) {
				expect(chunk.length).toBeLessThanOrEqual(72)
			}
		})
	})

	describe("independent RSA signature verification (A-C2)", () => {
		it("should produce verifiable signature via crypto.subtle.verify", async () => {
			const rawMessage = buildTestMessage()
			const signed = await signDkim(rawMessage, {
				domainName: "example.com",
				keySelector: "test",
				privateKey: testKeyPair.privateKey,
				canonicalization: "relaxed/relaxed",
			})
			const dkimHeader = extractDkimHeader(signed)
			const tags = parseDkimTags(dkimHeader)
			const headerNames = tags.h.split(":")
			const signingInput = buildVerificationInput(signed, dkimHeader, headerNames)
			const sigBytes = fromBase64(tags.b.replace(/\s/g, ""))
			const verified = await crypto.subtle.verify(
				"RSASSA-PKCS1-v1_5",
				testKeyPair.publicKey,
				sigBytes.buffer,
				new TextEncoder().encode(signingInput),
			)
			expect(verified).toBe(true)
		})

		it("should fail verification with tampered body", async () => {
			const rawMessage = buildTestMessage()
			const signed = await signDkim(rawMessage, {
				domainName: "example.com",
				keySelector: "test",
				privateKey: testKeyPair.privateKey,
			})
			const dkimHeader = extractDkimHeader(signed)
			const tags = parseDkimTags(dkimHeader)

			const bodyStart = signed.indexOf("\r\n\r\n") + 4
			const tamperedBody = `${signed.substring(0, bodyStart)}TAMPERED BODY`
			const canonBody = canonicalizeRelaxedBody(tamperedBody.substring(bodyStart))
			const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonBody))
			expect(tags.bh).not.toBe(toBase64(digest))
		})
	})
})
