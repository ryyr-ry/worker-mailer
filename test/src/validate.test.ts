import { describe, expect, it } from "vitest"
import { validateEmail, validateEmailBatch } from "../../src/validate"

describe("validateEmail", () => {
	describe("valid email addresses", () => {
		const validAddresses = [
			"user@example.com",
			"test.user@example.com",
			"user+tag@example.com",
			"user@sub.domain.example.com",
			"a@b.co",
			"user123@example.org",
			"first.last@company.co.jp",
			"user@例え.jp",
		]

		for (const address of validAddresses) {
			it(`"${address}" should be valid`, () => {
				const result = validateEmail(address)
				expect(result.valid).toBe(true)
			})
		}
	})

	describe("empty string", () => {
		it("should be invalid for empty string", () => {
			const result = validateEmail("")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("empty")
			}
		})
	})

	describe("missing @", () => {
		it("should be invalid for address without @", () => {
			const result = validateEmail("userexample.com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("@")
			}
		})
	})

	describe("Local part is empty", () => {
		it("should be invalid when local part before @ is empty", () => {
			const result = validateEmail("@example.com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("Local part is empty")
			}
		})
	})

	describe("Domain part is empty", () => {
		it("should be invalid when domain part after @ is empty", () => {
			const result = validateEmail("user@")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("Domain part is empty")
			}
		})
	})

	describe("length limit checks", () => {
		it("should be invalid when local part exceeds 64 characters", () => {
			const local = "a".repeat(65)
			const result = validateEmail(`${local}@example.com`)
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("Local part is too long")
			}
		})

		it("should be invalid when domain part exceeds 253 characters", () => {
			const labels: string[] = []
			while (labels.join(".").length < 254) {
				labels.push("a".repeat(63))
			}
			const domain = labels.join(".")
			const result = validateEmail(`user@${domain}`)
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("Domain part is too long")
			}
		})

		it("should be invalid when total length exceeds 320 characters", () => {
			const local = "a".repeat(64)
			const domain = `${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.${"e".repeat(63)}.f`
			const address = `${local}@${domain}`
			expect(address.length).toBeGreaterThan(320)
			const result = validateEmail(address)
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("too long")
			}
		})
	})

	describe("control character checks", () => {
		it("should be invalid for address containing control characters", () => {
			const result = validateEmail("user\x00@example.com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("control characters")
			}
		})

		it("should be invalid for address containing tab characters", () => {
			const result = validateEmail("user\t@example.com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("control characters")
			}
		})
	})

	describe("dot-related checks", () => {
		it("should be invalid when local part starts with a dot", () => {
			const result = validateEmail(".user@example.com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("starts with a dot")
			}
		})

		it("should be invalid when local part ends with a dot", () => {
			const result = validateEmail("user.@example.com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("ends with a dot")
			}
		})

		it("should be invalid when local part contains consecutive dots", () => {
			const result = validateEmail("user..name@example.com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("consecutive dots")
			}
		})

		it("should be invalid when domain part starts with a dot", () => {
			const result = validateEmail("user@.example.com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("starts with a dot")
			}
		})

		it("should be invalid when domain part ends with a dot", () => {
			const result = validateEmail("user@example.com.")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("ends with a dot")
			}
		})

		it("should be invalid when domain part contains consecutive dots", () => {
			const result = validateEmail("user@example..com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("consecutive dots")
			}
		})
	})

	describe("domain without a dot", () => {
		it("should be invalid for domain without TLD", () => {
			const result = validateEmail("user@localhost")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("does not contain a dot")
			}
		})
	})

	describe("domain label length checks", () => {
		it("should be invalid for label exceeding 63 characters", () => {
			const longLabel = "a".repeat(64)
			const result = validateEmail(`user@${longLabel}.com`)
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("too long")
			}
		})

		it("should be valid for label with exactly 63 characters", () => {
			const label = "a".repeat(63)
			const result = validateEmail(`user@${label}.com`)
			expect(result.valid).toBe(true)
		})
	})

	describe("internationalized domain names (IDN)", () => {
		it("should accept Japanese domain names", () => {
			const result = validateEmail("user@例え.jp")
			expect(result.valid).toBe(true)
		})

		it("should accept Chinese domain names", () => {
			const result = validateEmail("user@例子.中国")
			expect(result.valid).toBe(true)
		})

		it("should accept German IDN domain names", () => {
			const result = validateEmail("user@münchen.de")
			expect(result.valid).toBe(true)
		})
	})

	describe("quoted-string local part (RFC 5321)", () => {
		it("should accept quoted-string with space", () => {
			const result = validateEmail('"user name"@example.com')
			expect(result.valid).toBe(true)
		})

		it("should accept quoted-string with special characters", () => {
			const result = validateEmail('"user@host"@example.com')
			expect(result.valid).toBe(true)
		})

		it("should reject quoted-string with consecutive dots (RFC 5321 limitation: validator treats quotes as literal)", () => {
			const result = validateEmail('"user..name"@example.com')
			expect(result.valid).toBe(false)
		})
	})

	describe("special characters in local part (RFC 5322)", () => {
		it("should accept bang/hash/dollar/percent in local part", () => {
			const result = validateEmail("!#$%&@example.com")
			expect(result.valid).toBe(true)
		})

		it("should accept tick/plus/slash/equals/caret/backtick in local part", () => {
			const result = validateEmail("'+/=?^_`{|}~@example.com")
			expect(result.valid).toBe(true)
		})
	})

	describe("320 character boundary (64+@+255)", () => {
		it("should accept exactly 320 characters total", () => {
			const local = "a".repeat(64)
			const domainBody = "b".repeat(251)
			const domain = `${domainBody}.co`
			const address = `${local}@${domain}`
			if (address.length > 320) return
			const result = validateEmail(address)
			if (domain.length > 253) {
				expect(result.valid).toBe(false)
			} else {
				expect(result.valid).toBe(true)
			}
		})

		it("should reject 321 characters total", () => {
			const local = "a".repeat(64)
			const domainBody = "b".repeat(252)
			const domain = `${domainBody}.co`
			const address = `${local}@${domain}`
			const result = validateEmail(address)
			expect(result.valid).toBe(false)
		})
	})

	describe("IP literal domain (RFC 5321)", () => {
		it("should accept bare IP (treated as dotted domain labels)", () => {
			const result = validateEmail("user@192.168.1.1")
			expect(result.valid).toBe(true)
		})

		it("should accept IP address-like domain with dots", () => {
			const result = validateEmail("user@127.0.0.1")
			expect(result.valid).toBe(true)
		})
	})

	describe("hyphen domain rules", () => {
		it("should accept domain with hyphen in middle", () => {
			const result = validateEmail("user@my-domain.com")
			expect(result.valid).toBe(true)
		})

		it("should reject domain label starting with hyphen (RFC 952)", () => {
			const result = validateEmail("user@-domain.com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("starts or ends with a hyphen")
			}
		})

		it("should reject domain label ending with hyphen (RFC 952)", () => {
			const result = validateEmail("user@domain-.com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("starts or ends with a hyphen")
			}
		})
	})

	describe("local part 64 character boundary", () => {
		it("should accept exactly 64 character local part", () => {
			const local = "a".repeat(64)
			const result = validateEmail(`${local}@example.com`)
			expect(result.valid).toBe(true)
		})

		it("should reject 65 character local part", () => {
			const local = "a".repeat(65)
			const result = validateEmail(`${local}@example.com`)
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("Local part is too long")
			}
		})
	})
})

describe("validateEmailBatch", () => {
	it("should validate multiple addresses at once", () => {
		const addresses = ["valid@example.com", "invalid", "another@test.org", ""]
		const results = validateEmailBatch(addresses)

		expect(results.size).toBe(4)
		expect(results.get("valid@example.com")?.valid).toBe(true)
		expect(results.get("invalid")?.valid).toBe(false)
		expect(results.get("another@test.org")?.valid).toBe(true)
		expect(results.get("")?.valid).toBe(false)
	})

	it("should return an empty Map for an empty array", () => {
		const results = validateEmailBatch([])
		expect(results.size).toBe(0)
	})

	it("should keep the last result for duplicate addresses", () => {
		const results = validateEmailBatch(["user@example.com", "user@example.com"])
		expect(results.size).toBe(1)
		expect(results.get("user@example.com")?.valid).toBe(true)
	})
})
