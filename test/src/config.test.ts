import { describe, expect, it } from "vitest"
import { inferSecurity, validatePortSecurity } from "../../src/mailer/config"
import { ConfigurationError } from "../../src/errors"

describe("inferSecurity", () => {
	it("port 465ではsecure: true, startTls: falseを推論する", () => {
		const result = inferSecurity({ port: 465 })
		expect(result).toEqual({ secure: true, startTls: false })
	})

	it("port 587ではsecure: false, startTls: trueを推論する", () => {
		const result = inferSecurity({ port: 587 })
		expect(result).toEqual({ secure: false, startTls: true })
	})

	it("port 25ではsecure: false, startTls: trueを推論する", () => {
		const result = inferSecurity({ port: 25 })
		expect(result).toEqual({ secure: false, startTls: true })
	})

	it("明示的にsecure: trueを指定した場合はそれを優先する", () => {
		const result = inferSecurity({ port: 587, secure: true })
		expect(result).toEqual({ secure: true, startTls: false })
	})

	it("明示的にstartTls: falseを指定した場合はそれを優先する", () => {
		const result = inferSecurity({ port: 587, startTls: false })
		expect(result).toEqual({ secure: false, startTls: false })
	})

	it("secure: falseのみ指定した場合はstartTls: trueになる", () => {
		const result = inferSecurity({ port: 465, secure: false })
		expect(result).toEqual({ secure: false, startTls: true })
	})

	it("startTls: trueのみ指定した場合はsecure: falseになる", () => {
		const result = inferSecurity({ port: 465, startTls: true })
		expect(result).toEqual({ secure: false, startTls: true })
	})

	it("両方指定した場合はそのまま返す", () => {
		const result = inferSecurity({ port: 25, secure: true, startTls: true })
		expect(result).toEqual({ secure: true, startTls: true })
	})
})

describe("validatePortSecurity", () => {
	it("port 587 + secure: trueの場合はConfigurationErrorを投げる", () => {
		expect(() => validatePortSecurity(587, true, false)).toThrow(ConfigurationError)
		expect(() => validatePortSecurity(587, true, false)).toThrow("port 587 requires STARTTLS")
	})

	it("port 465 + startTls: trueの場合はConfigurationErrorを投げる", () => {
		expect(() => validatePortSecurity(465, false, true)).toThrow(ConfigurationError)
		expect(() => validatePortSecurity(465, false, true)).toThrow("port 465 requires implicit TLS")
	})

	it("port 587 + secure: falseの場合は正常", () => {
		expect(() => validatePortSecurity(587, false, true)).not.toThrow()
	})

	it("port 465 + secure: trueの場合は正常", () => {
		expect(() => validatePortSecurity(465, true, false)).not.toThrow()
	})

	it("port 25は制約なし", () => {
		expect(() => validatePortSecurity(25, false, true)).not.toThrow()
		expect(() => validatePortSecurity(25, true, false)).not.toThrow()
		expect(() => validatePortSecurity(25, false, false)).not.toThrow()
	})

	it("secure: true + startTls: true の場合はConfigurationErrorを投げる", () => {
		expect(() => validatePortSecurity(25, true, true)).toThrow(ConfigurationError)
		expect(() => validatePortSecurity(587, true, true)).toThrow(ConfigurationError)
		expect(() => validatePortSecurity(465, true, true)).toThrow(ConfigurationError)
	})
})
