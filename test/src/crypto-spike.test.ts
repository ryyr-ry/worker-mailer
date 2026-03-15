import { describe, expect, it } from "vitest"

describe("Web Crypto spike", () => {
	it("should import RSA PKCS#8 PEM key", async () => {
		const { privateKey } = await crypto.subtle.generateKey(
			{
				name: "RSASSA-PKCS1-v1_5",
				modulusLength: 2048,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: "SHA-256",
			},
			true,
			["sign", "verify"],
		)

		const exported = await crypto.subtle.exportKey("pkcs8", privateKey)
		expect(exported).toBeInstanceOf(ArrayBuffer)
		expect(exported.byteLength).toBeGreaterThan(0)

		const imported = await crypto.subtle.importKey(
			"pkcs8",
			exported,
			{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
			false,
			["sign"],
		)
		expect(imported).toBeDefined()
		expect(imported.type).toBe("private")
	})

	it("should sign data with RSASSA-PKCS1-v1_5", async () => {
		const keyPair = await crypto.subtle.generateKey(
			{
				name: "RSASSA-PKCS1-v1_5",
				modulusLength: 2048,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: "SHA-256",
			},
			false,
			["sign", "verify"],
		)

		const data = new TextEncoder().encode("test data to sign")
		const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, data)

		expect(signature).toBeInstanceOf(ArrayBuffer)
		expect(signature.byteLength).toBeGreaterThan(0)
	})

	it("should compute SHA-256 digest", async () => {
		const data = new TextEncoder().encode("hello world")
		const digest = await crypto.subtle.digest("SHA-256", data)

		expect(digest).toBeInstanceOf(ArrayBuffer)
		expect(digest.byteLength).toBe(32)

		const hex = Array.from(new Uint8Array(digest))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("")
		expect(hex).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9")
	})

	it("should verify round-trip sign/verify", async () => {
		const keyPair = await crypto.subtle.generateKey(
			{
				name: "RSASSA-PKCS1-v1_5",
				modulusLength: 2048,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: "SHA-256",
			},
			false,
			["sign", "verify"],
		)

		const data = new TextEncoder().encode("round trip verification test")
		const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, data)

		const isValid = await crypto.subtle.verify(
			"RSASSA-PKCS1-v1_5",
			keyPair.publicKey,
			signature,
			data,
		)
		expect(isValid).toBe(true)

		const tamperedData = new TextEncoder().encode("tampered data")
		const isInvalid = await crypto.subtle.verify(
			"RSASSA-PKCS1-v1_5",
			keyPair.publicKey,
			signature,
			tamperedData,
		)
		expect(isInvalid).toBe(false)
	})
})
