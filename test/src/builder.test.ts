import { describe, expect, it } from "vitest"
import { MailBuilder } from "../../src/builder"

describe("MailBuilder", () => {
const minimal = () => new MailBuilder().from("a@b.com").to("c@d.com").subject("Hi")

it("method chaining returns same instance", () => {
const b = new MailBuilder()
expect(b.from("a@b.com")).toBe(b)
expect(b.to("c@d.com")).toBe(b)
expect(b.subject("Hi")).toBe(b)
expect(b.text("body")).toBe(b)
expect(b.html("<b>body</b>")).toBe(b)
})

it("build() returns EmailOptions with from/to/subject", () => {
const opts = minimal().build()
expect(opts.from).toBe("a@b.com")
expect(opts.to).toBe("c@d.com")
expect(opts.subject).toBe("Hi")
})

it("cc() and bcc() set recipients", () => {
const opts = minimal().cc("x@y.com").bcc("z@w.com").build()
expect(opts.cc).toBe("x@y.com")
expect(opts.bcc).toBe("z@w.com")
})

it("text() and html() set body", () => {
const opts = minimal().text("plain").html("<b>rich</b>").build()
expect(opts.text).toBe("plain")
expect(opts.html).toBe("<b>rich</b>")
})

it("attach() accumulates attachments", () => {
const a1 = { filename: "a.txt", content: "A" }
const a2 = { filename: "b.txt", content: "B" }
const opts = minimal().attach(a1).attach(a2).build()
expect(opts.attachments).toHaveLength(2)
})

it("header() adds custom header", () => {
const opts = minimal().header("X-Custom", "val").build()
expect(opts.headers?.["X-Custom"]).toBe("val")
})

it("headers() merges multiple headers", () => {
const opts = minimal().headers({ "X-A": "1", "X-B": "2" }).build()
expect(opts.headers?.["X-A"]).toBe("1")
expect(opts.headers?.["X-B"]).toBe("2")
})

it("replyTo() sets reply field", () => {
const opts = minimal().replyTo("reply@x.com").build()
expect(opts.reply).toBe("reply@x.com")
})

it("build() without from throws Error", () => {
expect(() => new MailBuilder().to("c@d.com").subject("Hi").build())
.toThrow("from is required")
})

it("build() without to throws Error", () => {
expect(() => new MailBuilder().from("a@b.com").subject("Hi").build())
.toThrow("to is required")
})

it("build() without subject throws Error", () => {
expect(() => new MailBuilder().from("a@b.com").to("c@d.com").build())
.toThrow("subject is required")
})

it("multiple to() recipients via varargs", () => {
const opts = new MailBuilder().from("a@b.com").to("a@a.com", "b@b.com").subject("Hi").build()
expect(opts.to).toEqual(["a@a.com", "b@b.com"])
})
})
