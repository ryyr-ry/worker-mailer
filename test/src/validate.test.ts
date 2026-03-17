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
