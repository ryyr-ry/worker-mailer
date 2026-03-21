import { describe, expect, it } from "vitest"
import { ConfigurationError } from "../../src/errors"
import { inferSecurity, validatePortSecurity } from "../../src/mailer/config"

describe("inferSecurity", () => {
	it("port 465 infers implicit TLS (SMTPS)", () => {
		expect(inferSecurity({ port: 465 })).toEqual({ secure: true, startTls: false })
	})

	it("port 587 infers STARTTLS (RFC 6409 submission)", () => {
		expect(inferSecurity({ port: 587 })).toEqual({ secure: false, startTls: true })
	})

	it("port 25 infers STARTTLS by default", () => {
		expect(inferSecurity({ port: 25 })).toEqual({ secure: false, startTls: true })
	})

	it("explicit secure overrides port-based inference", () => {
		expect(inferSecurity({ port: 587, secure: true })).toEqual({ secure: true, startTls: false })
	})

	it("explicit startTls overrides port-based inference", () => {
		expect(inferSecurity({ port: 465, startTls: true })).toEqual({ secure: false, startTls: true })
	})
})

describe("validatePortSecurity", () => {
	it("rejects secure + startTls both true (mutually exclusive)", () => {
		expect(() => validatePortSecurity(25, true, true)).toThrow(ConfigurationError)
		expect(() => validatePortSecurity(587, true, true)).toThrow(ConfigurationError)
		expect(() => validatePortSecurity(465, true, true)).toThrow(ConfigurationError)
	})

	it("rejects port 587 + secure:true (587 requires STARTTLS per RFC 6409)", () => {
		expect(() => validatePortSecurity(587, true, false)).toThrow(ConfigurationError)
		expect(() => validatePortSecurity(587, true, false)).toThrow("port 587 requires STARTTLS")
	})

	it("rejects port 465 + startTls:true (465 requires implicit TLS)", () => {
		expect(() => validatePortSecurity(465, false, true)).toThrow(ConfigurationError)
		expect(() => validatePortSecurity(465, false, true)).toThrow("port 465 requires implicit TLS")
	})
})
