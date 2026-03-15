import { describe, expect, it } from "vitest"
import { validateEmail, validateEmailBatch } from "../../src/validate"

describe("validateEmail", () => {
	describe("正常なメールアドレス", () => {
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
			it(`"${address}" は有効`, () => {
				const result = validateEmail(address)
				expect(result.valid).toBe(true)
			})
		}
	})

	describe("空文字", () => {
		it("空文字は無効", () => {
			const result = validateEmail("")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("空")
			}
		})
	})

	describe("@ が無い", () => {
		it("@ が含まれないアドレスは無効", () => {
			const result = validateEmail("userexample.com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("@")
			}
		})
	})

	describe("ローカル部分が空", () => {
		it("@ の前が空は無効", () => {
			const result = validateEmail("@example.com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("ローカル部分が空")
			}
		})
	})

	describe("ドメイン部分が空", () => {
		it("@ の後が空は無効", () => {
			const result = validateEmail("user@")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("ドメイン部分が空")
			}
		})
	})

	describe("長さ制限チェック", () => {
		it("ローカル部分が64文字を超える場合は無効", () => {
			const local = "a".repeat(65)
			const result = validateEmail(`${local}@example.com`)
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("ローカル部分が長すぎます")
			}
		})

		it("ドメイン部分が253文字を超える場合は無効", () => {
			const labels: string[] = []
			while (labels.join(".").length < 254) {
				labels.push("a".repeat(63))
			}
			const domain = labels.join(".")
			const result = validateEmail(`user@${domain}`)
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("ドメイン部分が長すぎます")
			}
		})

		it("全体が320文字を超える場合は無効", () => {
			const local = "a".repeat(64)
			const domain = `${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.${"e".repeat(63)}`
			const address = `${local}@${domain}`
			if (address.length <= 320) {
				return
			}
			const result = validateEmail(address)
			expect(result.valid).toBe(false)
		})
	})

	describe("制御文字チェック", () => {
		it("制御文字を含むアドレスは無効", () => {
			const result = validateEmail("user\x00@example.com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("制御文字")
			}
		})

		it("タブ文字を含むアドレスは無効", () => {
			const result = validateEmail("user\t@example.com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("制御文字")
			}
		})
	})

	describe("ドットに関するチェック", () => {
		it("ローカル部分がドットで始まる場合は無効", () => {
			const result = validateEmail(".user@example.com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("ドットで始まっています")
			}
		})

		it("ローカル部分がドットで終わる場合は無効", () => {
			const result = validateEmail("user.@example.com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("ドットで終わっています")
			}
		})

		it("ローカル部分に連続ドットがある場合は無効", () => {
			const result = validateEmail("user..name@example.com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("連続するドット")
			}
		})

		it("ドメイン部分がドットで始まる場合は無効", () => {
			const result = validateEmail("user@.example.com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("ドットで始まっています")
			}
		})

		it("ドメイン部分がドットで終わる場合は無効", () => {
			const result = validateEmail("user@example.com.")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("ドットで終わっています")
			}
		})

		it("ドメイン部分に連続ドットがある場合は無効", () => {
			const result = validateEmail("user@example..com")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("連続するドット")
			}
		})
	})

	describe("ドメインにドットがない場合", () => {
		it("TLDのないドメインは無効", () => {
			const result = validateEmail("user@localhost")
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("ドットが含まれていません")
			}
		})
	})

	describe("ドメインラベル長チェック", () => {
		it("63文字を超えるラベルは無効", () => {
			const longLabel = "a".repeat(64)
			const result = validateEmail(`user@${longLabel}.com`)
			expect(result.valid).toBe(false)
			if (!result.valid) {
				expect(result.reason).toContain("長すぎます")
			}
		})

		it("63文字ちょうどのラベルは有効", () => {
			const label = "a".repeat(63)
			const result = validateEmail(`user@${label}.com`)
			expect(result.valid).toBe(true)
		})
	})

	describe("国際化ドメイン名 (IDN)", () => {
		it("日本語ドメインは許容される", () => {
			const result = validateEmail("user@例え.jp")
			expect(result.valid).toBe(true)
		})

		it("中国語ドメインは許容される", () => {
			const result = validateEmail("user@例子.中国")
			expect(result.valid).toBe(true)
		})
	})
})

describe("validateEmailBatch", () => {
	it("複数アドレスを一括バリデーションできる", () => {
		const addresses = ["valid@example.com", "invalid", "another@test.org", ""]
		const results = validateEmailBatch(addresses)

		expect(results.size).toBe(4)
		expect(results.get("valid@example.com")?.valid).toBe(true)
		expect(results.get("invalid")?.valid).toBe(false)
		expect(results.get("another@test.org")?.valid).toBe(true)
		expect(results.get("")?.valid).toBe(false)
	})

	it("空配列の場合は空のMapを返す", () => {
		const results = validateEmailBatch([])
		expect(results.size).toBe(0)
	})

	it("重複アドレスがある場合は最後の結果が保持される", () => {
		const results = validateEmailBatch(["user@example.com", "user@example.com"])
		expect(results.size).toBe(1)
		expect(results.get("user@example.com")?.valid).toBe(true)
	})
})
