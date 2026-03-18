import { describe, expect, it } from "vitest"
import { unsubscribeHeaders } from "../../src/unsubscribe"
import { CrlfInjectionError } from "../../src/errors"

describe("List-Unsubscribe headers (RFC 2369 / RFC 8058)", () => {
it("List-Unsubscribe contains HTTPS URL in angle brackets", () => {
const h = unsubscribeHeaders({ url: "https://example.com/unsub" })
expect(h["List-Unsubscribe"]).toBe("<https://example.com/unsub>")
})

it("List-Unsubscribe-Post is always One-Click (RFC 8058 Section 3)", () => {
const h = unsubscribeHeaders({ url: "https://example.com/unsub" })
expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click")
})

it("mailto in angle brackets when provided", () => {
const h = unsubscribeHeaders({
url: "https://example.com/unsub",
mailto: "unsub@example.com",
})
expect(h["List-Unsubscribe"]).toContain("<mailto:unsub@example.com>")
})

it("URL and mailto separated by comma", () => {
const h = unsubscribeHeaders({
url: "https://example.com/unsub",
mailto: "unsub@example.com",
})
expect(h["List-Unsubscribe"]).toContain(">, <")
})

it("CRLF in URL throws CrlfInjectionError", () => {
expect(() =>
unsubscribeHeaders({ url: "https://example.com/unsub\r\nEvil: header" }),
).toThrow(CrlfInjectionError)
})

it("CRLF in mailto throws CrlfInjectionError", () => {
expect(() =>
unsubscribeHeaders({
url: "https://example.com/unsub",
mailto: "unsub@example.com\r\nEvil: header",
}),
).toThrow(CrlfInjectionError)
})

it("non-HTTPS URL rejected (RFC 8058)", () => {
expect(() =>
unsubscribeHeaders({ url: "http://example.com/unsub" }),
).toThrow()
})

it("returns correct UnsubscribeHeaders type", () => {
const h = unsubscribeHeaders({ url: "https://example.com/unsub" })
expect(h).toHaveProperty("List-Unsubscribe")
expect(h).toHaveProperty("List-Unsubscribe-Post")
})
})
