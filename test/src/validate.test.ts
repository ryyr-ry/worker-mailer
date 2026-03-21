import { describe, expect, it } from "vitest"
import { validateEmail, validateEmailBatch } from "../../src/validate"

describe("Email validation (RFC 5321 Section 4.1.2)", () => {
	it("valid: simple@example.com", () => {
		expect(validateEmail("simple@example.com")).toEqual({ valid: true })
	})

	it("valid: user+tag@example.com (plus addressing)", () => {
		expect(validateEmail("user+tag@example.com")).toEqual({ valid: true })
	})

	it("valid: user.name@example.com (dot separated)", () => {
		expect(validateEmail("user.name@example.com")).toEqual({ valid: true })
	})

	it("invalid: missing @", () => {
		expect(validateEmail("noatsign")).toMatchObject({ valid: false })
	})

	it("invalid: missing local part", () => {
		expect(validateEmail("@example.com")).toMatchObject({ valid: false })
	})

	it("invalid: missing domain", () => {
		expect(validateEmail("user@")).toMatchObject({ valid: false })
	})

	it("invalid: double @ (RFC 5321 Section 4.1.2 unquoted local part)", () => {
		expect(validateEmail("a@@b.com")).toMatchObject({ valid: false })
	})

	it("CRLF in address returns invalid (injection prevention)", () => {
		expect(validateEmail("a@b.com\r\nRCPT TO:<evil>")).toMatchObject({ valid: false })
	})

	it("null byte in address returns invalid", () => {
		expect(validateEmail("a\x00@b.com")).toMatchObject({ valid: false })
	})

	it("extremely long address returns invalid (>320 chars)", () => {
		const long = `${"a".repeat(300)}@example.com`
		expect(validateEmail(long)).toMatchObject({ valid: false })
	})

	it("empty string returns invalid", () => {
		expect(validateEmail("")).toMatchObject({ valid: false })
	})

	it("domain with hyphen valid", () => {
		expect(validateEmail("a@my-domain.com")).toEqual({ valid: true })
	})

	it("domain starting with hyphen invalid", () => {
		expect(validateEmail("a@-domain.com")).toMatchObject({ valid: false })
	})
})

describe("validateEmailBatch", () => {
	it("all valid returns all valid results", () => {
		const results = validateEmailBatch(["a@b.com", "c@d.com"])
		expect(results.get("a@b.com")).toEqual({ valid: true })
		expect(results.get("c@d.com")).toEqual({ valid: true })
	})

	it("mixed valid/invalid results", () => {
		const results = validateEmailBatch(["a@b.com", "invalid"])
		expect(results.get("a@b.com")).toEqual({ valid: true })
		expect(results.get("invalid")).toMatchObject({ valid: false })
	})

	it("empty array returns empty map", () => {
		expect(validateEmailBatch([]).size).toBe(0)
	})
})

describe("RFC 5321 edge cases", () => {
	it("quoted local part with spaces is accepted", () => {
		const result = validateEmail('"user with spaces"@example.com')
		expect(result).toEqual({ valid: true })
	})

	it.each([
		"user name@example.com",
		"user,name@example.com",
		"user(comment)@example.com",
	])("invalid unquoted local part characters are rejected: %s", (address) => {
		expect(validateEmail(address)).toMatchObject({
			valid: false,
			reason: "Local part contains invalid unquoted characters",
		})
	})

	it("numeric local part is valid", () => {
		expect(validateEmail("123@example.com")).toEqual({ valid: true })
	})

	it("domain with consecutive hyphens in middle is accepted", () => {
		expect(validateEmail("user@my--domain.com")).toEqual({ valid: true })
	})

	it("IP literal domain is accepted (no RFC 5321 bracket validation)", () => {
		const result = validateEmail("user@[192.0.2.1]")
		expect(result).toEqual({ valid: true })
	})

	it("IPv6 domain literal rejected (no dot in domain)", () => {
		const result = validateEmail("user@[IPv6:2001:db8::1]")
		expect(result).toMatchObject({ valid: false })
	})

	it("domain starting with digit is valid", () => {
		expect(validateEmail("user@1example.com")).toEqual({ valid: true })
	})

	it("local part at RFC max (64 chars) is valid", () => {
		const addr = `${"a".repeat(64)}@example.com`
		expect(validateEmail(addr)).toEqual({ valid: true })
	})

	it("local part over RFC max (65 chars) is invalid", () => {
		const addr = `${"a".repeat(65)}@example.com`
		expect(validateEmail(addr)).toMatchObject({
			valid: false,
			reason: expect.stringContaining("Local part is too long"),
		})
	})

	it("dot at start of local part is invalid", () => {
		expect(validateEmail(".user@example.com")).toMatchObject({
			valid: false,
			reason: "Local part starts with a dot",
		})
	})

	it("dot at end of local part is invalid", () => {
		expect(validateEmail("user.@example.com")).toMatchObject({
			valid: false,
			reason: "Local part ends with a dot",
		})
	})

	it("consecutive dots in local part is invalid", () => {
		expect(validateEmail("user..name@example.com")).toMatchObject({
			valid: false,
			reason: "Local part contains consecutive dots",
		})
	})

	it("plus addressing (user+tag) is valid", () => {
		expect(validateEmail("user+tag@example.com")).toEqual({ valid: true })
	})

	it("unicode in local part is accepted (SMTPUTF8 path)", () => {
		expect(validateEmail("用户@example.com")).toEqual({ valid: true })
	})

	it("unicode in domain is accepted (internationalized domain)", () => {
		expect(validateEmail("user@例え.jp")).toEqual({ valid: true })
	})

	it("quoted local part without closing quote is invalid", () => {
		expect(validateEmail('"unclosed@example.com')).toMatchObject({
			valid: false,
			reason: "Quoted local part is missing closing quote",
		})
	})

	it("quoted local part with unescaped inner quote is invalid", () => {
		expect(validateEmail('"inner"quote"@example.com')).toMatchObject({
			valid: false,
			reason: "Quoted local part contains unescaped quote",
		})
	})

	it("properly escaped quote in quoted local part is valid", () => {
		expect(validateEmail('"user\\"name"@example.com')).toEqual({ valid: true })
	})
})
