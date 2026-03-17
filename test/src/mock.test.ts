import { describe, expect, it } from "vitest"
import { SmtpConnectionError } from "../../src/errors"
import { MockMailer } from "../../src/mock"

describe("MockMailer", () => {
it("send() stores email in sentEmails", async () => {
const m = new MockMailer()
await m.send({ from: "a@b.com", to: "c@d.com", subject: "Hi" })
expect(m.sentEmails).toHaveLength(1)
expect(m.sentEmails[0].options.subject).toBe("Hi")
})

it("hasSentTo() finds matching recipient", async () => {
const m = new MockMailer()
await m.send({ from: "a@b.com", to: "target@x.com", subject: "S" })
expect(m.hasSentTo("target@x.com")).toBe(true)
expect(m.hasSentTo("other@x.com")).toBe(false)
})

it("hasSentWithSubject() finds matching subject", async () => {
const m = new MockMailer()
await m.send({ from: "a@b.com", to: "c@d.com", subject: "Important" })
expect(m.hasSentWithSubject("Important")).toBe(true)
expect(m.hasSentWithSubject("Other")).toBe(false)
})

it("clear() resets state", async () => {
const m = new MockMailer()
await m.send({ from: "a@b.com", to: "c@d.com", subject: "S" })
m.clear()
expect(m.sendCount).toBe(0)
expect(m.sentEmails).toHaveLength(0)
})

it("sendCount tracks count", async () => {
const m = new MockMailer()
await m.send({ from: "a@b.com", to: "c@d.com", subject: "1" })
await m.send({ from: "a@b.com", to: "c@d.com", subject: "2" })
expect(m.sendCount).toBe(2)
})

it("simulateError throws on send", async () => {
const m = new MockMailer({ simulateError: new Error("forced") })
await expect(m.send({ from: "a@b.com", to: "c@d.com", subject: "S" }))
.rejects.toThrow("forced")
})

it("send after close throws SmtpConnectionError", async () => {
const m = new MockMailer()
await m.close()
await expect(m.send({ from: "a@b.com", to: "c@d.com", subject: "S" }))
.rejects.toThrow(SmtpConnectionError)
})

it("lastEmail returns most recent", async () => {
const m = new MockMailer()
await m.send({ from: "a@b.com", to: "c@d.com", subject: "first" })
await m.send({ from: "a@b.com", to: "c@d.com", subject: "second" })
expect(m.lastEmail?.options.subject).toBe("second")
})
})
