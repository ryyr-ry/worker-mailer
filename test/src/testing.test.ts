import { describe, expect, it } from "vitest"
import { Email } from "../../src/email/email"
import { createTestEmail } from "../../src/testing"

describe("createTestEmail", () => {
	it("subject is auto-generated with timestamp", () => {
		const opts = createTestEmail({ from: "a@b.com", to: "c@d.com" })
		expect(opts.subject).toContain("[worker-mailer]")
	})

	it("custom smtpHost included in body", () => {
		const opts = createTestEmail({ from: "a@b.com", to: "c@d.com", smtpHost: "smtp.test.com" })
		expect(opts.text).toContain("smtp.test.com")
	})

	it("returned options valid for Email constructor", () => {
		const opts = createTestEmail({ from: "a@b.com", to: "c@d.com" })
		expect(() => new Email(opts)).not.toThrow()
	})
})
