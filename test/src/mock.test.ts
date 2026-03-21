import { describe, expect, it } from "vitest"
import { EmailValidationError, SmtpConnectionError } from "../../src/errors"
import { MockMailer } from "../../src/mock"
import {
	assertNotSentTo,
	assertNthSent,
	assertSendCount,
	assertSent,
} from "../../src/testing-entry"

describe("MockMailer", () => {
	it("send() stores email in sentEmails", async () => {
		const m = new MockMailer()
		await m.send({ from: "a@b.com", to: "c@d.com", subject: "Hi", text: "body" })
		expect(m.sentEmails).toHaveLength(1)
		expect(m.sentEmails[0].options.subject).toBe("Hi")
	})

	it("hasSentTo() finds matching recipient", async () => {
		const m = new MockMailer()
		await m.send({ from: "a@b.com", to: "target@x.com", subject: "S", text: "body" })
		expect(m.hasSentTo("target@x.com")).toBe(true)
		expect(m.hasSentTo("other@x.com")).toBe(false)
	})

	it("hasSentWithSubject() finds matching subject", async () => {
		const m = new MockMailer()
		await m.send({ from: "a@b.com", to: "c@d.com", subject: "Important", text: "body" })
		expect(m.hasSentWithSubject("Important")).toBe(true)
		expect(m.hasSentWithSubject("Other")).toBe(false)
	})

	it("clear() resets state", async () => {
		const m = new MockMailer()
		await m.send({ from: "a@b.com", to: "c@d.com", subject: "S", text: "body" })
		m.clear()
		expect(m.sendCount).toBe(0)
		expect(m.sentEmails).toHaveLength(0)
	})

	it("sendCount tracks count", async () => {
		const m = new MockMailer()
		await m.send({ from: "a@b.com", to: "c@d.com", subject: "1", text: "body" })
		await m.send({ from: "a@b.com", to: "c@d.com", subject: "2", text: "body" })
		expect(m.sendCount).toBe(2)
	})

	it("simulateError throws on send", async () => {
		const m = new MockMailer({ simulateError: new Error("forced") })
		await expect(
			m.send({ from: "a@b.com", to: "c@d.com", subject: "S", text: "body" }),
		).rejects.toThrow("forced")
	})

	it("send after close throws SmtpConnectionError", async () => {
		const m = new MockMailer()
		await m.close()
		await expect(
			m.send({ from: "a@b.com", to: "c@d.com", subject: "S", text: "body" }),
		).rejects.toThrow(SmtpConnectionError)
	})

	it("empty to array rejects EmailValidationError", async () => {
		const m = new MockMailer()
		await expect(m.send({ from: "a@b.com", to: [], subject: "S", text: "body" })).rejects.toThrow(
			EmailValidationError,
		)
	})

	it("dryRun returns a dry-run result and does not record a sent email", async () => {
		const m = new MockMailer()
		const result = await m.send(
			{ from: "a@b.com", to: ["c@d.com", "e@f.com"], subject: "S", text: "body" },
			{ dryRun: true },
		)
		expect(result.messageId).toBe("")
		expect(result.accepted).toEqual(["c@d.com", "e@f.com"])
		expect(result.response).toBe("DRY RUN: no message sent")
		expect(m.sendCount).toBe(0)
		expect(m.sentEmails).toHaveLength(0)
	})

	it("lastEmail returns most recent", async () => {
		const m = new MockMailer()
		await m.send({ from: "a@b.com", to: "c@d.com", subject: "first", text: "body" })
		await m.send({ from: "a@b.com", to: "c@d.com", subject: "second", text: "body" })
		expect(m.lastEmail?.options.subject).toBe("second")
	})

	it("assertSent supports chained filtering", async () => {
		const m = new MockMailer()
		await m.send({
			from: "author@test.com",
			to: "reader@test.com",
			subject: "Release notes",
			text: "hello reader",
			headers: { "X-Trace": "abc" },
		})
		const email = assertSent(m)
			.from("author@test.com")
			.to("reader@test.com")
			.withSubject(/Release/)
			.withText("reader")
			.withHeader("X-Trace", "abc")
			.exists()
		expect(email.options.subject).toBe("Release notes")
	})

	it("assertNthSent targets the requested message using one-based positions", async () => {
		const m = new MockMailer()
		await m.send({ from: "a@b.com", to: "c@d.com", subject: "first", text: "body" })
		await m.send({ from: "a@b.com", to: "c@d.com", subject: "second", text: "body" })
		const second = assertNthSent(m, 2).withSubject("second").exists()
		expect(second.options.subject).toBe("second")
	})

	it("MockMailer assertion helpers are available as instance methods", async () => {
		const m = new MockMailer()
		await m.send({ from: "a@b.com", to: "first@d.com", subject: "one", text: "body" })
		await m.send({ from: "a@b.com", to: "second@d.com", subject: "two", text: "body" })
		m.assertSendCount(2)
		m.assertNotSentTo("missing@d.com")
		expect(m.assertNthSent(2).withSubject("two").exists().options.subject).toBe("two")
		expect(m.assertSent().to("first@d.com").exactly(1)).toHaveLength(1)
	})

	it("assertSendCount and assertNotSentTo throw on mismatches", async () => {
		const m = new MockMailer()
		await m.send({ from: "a@b.com", to: "target@d.com", subject: "one", text: "body" })
		expect(() => assertSendCount(m, 2)).toThrow("Expected 2 sent email(s), got 1")
		expect(() => assertNotSentTo(m, "target@d.com")).toThrow(
			"Expected no email sent to target@d.com, but found one",
		)
	})
})
