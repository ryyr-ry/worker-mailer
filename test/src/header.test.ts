import { describe, expect, it } from "vitest"
import { encodeHeader, foldHeaderLine, resolveHeaders } from "../../src/email/header"

describe("encodeHeader (RFC 2047)", () => {
it("ASCII-only text returns unencoded", () => {
expect(encodeHeader("Hello World")).toBe("Hello World")
})

it("non-ASCII text returns =?UTF-8?Q?...?= encoded-word", () => {
const result = encodeHeader("\u65E5\u672C\u8A9E")
expect(result).toMatch(/^=\?UTF-8\?Q\?.+\?=$/)
})

it("each encoded-word does not exceed 75 characters (RFC 2047 Section 2)", () => {
const longJapanese = "\u3042".repeat(50)
const result = encodeHeader(longJapanese)
const words = result.split("\r\n ")
for (const word of words) {
expect(word.length).toBeLessThanOrEqual(75)
}
})

it("2-byte UTF-8 char boundary respected", () => {
const twoByteChars = "\u00E9".repeat(30)
const result = encodeHeader(twoByteChars)
const words = result.split("\r\n ")
for (const word of words) {
expect(word.length).toBeLessThanOrEqual(75)
// Each word must be a complete encoded-word
expect(word).toMatch(/^=\?UTF-8\?Q\?.+\?=$/)
}
})

it("3-byte UTF-8 char boundary respected (CJK)", () => {
const cjk = "\u6F22\u5B57\u4EEE\u540D".repeat(8)
const result = encodeHeader(cjk)
const words = result.split("\r\n ")
for (const word of words) {
expect(word.length).toBeLessThanOrEqual(75)
expect(word).toMatch(/^=\?UTF-8\?Q\?.+\?=$/)
}
})

it("4-byte UTF-8 char boundary respected (emoji)", () => {
const emojis = "\u{1F600}\u{1F4E7}\u{1F680}".repeat(5)
const result = encodeHeader(emojis)
const words = result.split("\r\n ")
for (const word of words) {
expect(word.length).toBeLessThanOrEqual(75)
expect(word).toMatch(/^=\?UTF-8\?Q\?.+\?=$/)
}
})

it("very long subject splits into multiple encoded-words", () => {
const long = "\u3042".repeat(100)
const result = encodeHeader(long)
const words = result.split("\r\n ")
expect(words.length).toBeGreaterThan(1)
})

it("spaces encoded as underscore in Q-encoding", () => {
const result = encodeHeader("\u00E9 test")
expect(result).toContain("_")
})
})

describe("foldHeaderLine (RFC 5322 Section 2.2.3)", () => {
it("short line returned as-is", () => {
expect(foldHeaderLine("Subject: Hello")).toBe("Subject: Hello")
})

it("long line folded at 78 characters by default", () => {
const long = `To: ${"recipient@example.com, ".repeat(10)}`
const result = foldHeaderLine(long)
const lines = result.split("\r\n")
for (const line of lines) {
expect(line.length).toBeLessThanOrEqual(78)
}
})

it("folds at whitespace or comma boundaries", () => {
const header = `To: ${Array.from({ length: 5 }, (_, i) => `user${i}@very-long-domain-name.example.com`).join(", ")}`
const result = foldHeaderLine(header)
const lines = result.split("\r\n")
// Continuation lines should start with whitespace
for (let i = 1; i < lines.length; i++) {
expect(lines[i][0]).toMatch(/[ \t]/)
}
})
})

describe("resolveHeaders (RFC 5322 Section 3.6)", () => {
it("populates Date header in RFC 5322 format", () => {
const headers: Record<string, string> = {}
resolveHeaders({
from: { email: "a@b.com" },
to: [{ email: "c@d.com" }],
subject: "Test",
headers,
})
expect(headers.Date).toBeTruthy()
expect(headers.Date).toMatch(/\+0000$/)
})

it("Date header follows RFC 5322 format (deterministic, not toUTCString)", () => {
const headers: Record<string, string> = {}
resolveHeaders({
from: { email: "a@b.com" },
to: [{ email: "c@d.com" }],
subject: "Test",
headers,
})
expect(headers.Date).toMatch(
/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} \+0000$/,
)
})

it("populates Message-ID in <...@domain> format", () => {
const headers: Record<string, string> = {}
resolveHeaders({
from: { email: "a@example.com" },
to: [{ email: "c@d.com" }],
subject: "Test",
headers,
})
expect(headers["Message-ID"]).toMatch(/^<.+@example\.com>$/)
})

it("From header with display name uses quoted format", () => {
const headers: Record<string, string> = {}
resolveHeaders({
from: { name: "John Doe", email: "john@example.com" },
to: [{ email: "c@d.com" }],
subject: "Test",
headers,
})
expect(headers.From).toContain('"John Doe"')
expect(headers.From).toContain("<john@example.com>")
})

it("BCC never appears in resolved headers (RFC 5322 Section 3.6.3)", () => {
const headers: Record<string, string> = { Bcc: "secret@example.com" }
resolveHeaders({
from: { email: "a@b.com" },
to: [{ email: "c@d.com" }],
subject: "Test",
headers,
})
expect(headers.Bcc).toBeUndefined()
expect(headers.bcc).toBeUndefined()
})

it("protected headers cannot be overridden by user", () => {
const headers: Record<string, string> = { From: "evil@attacker.com" }
resolveHeaders({
from: { email: "real@sender.com" },
to: [{ email: "c@d.com" }],
subject: "Test",
headers,
})
expect(headers.From).toContain("real@sender.com")
})

it("Reply-To set when reply is provided", () => {
const headers: Record<string, string> = {}
resolveHeaders({
from: { email: "a@b.com" },
to: [{ email: "c@d.com" }],
reply: { email: "reply@b.com" },
subject: "Test",
headers,
})
expect(headers["Reply-To"]).toBe("reply@b.com")
})

it("CC header set when cc is provided", () => {
const headers: Record<string, string> = {}
resolveHeaders({
from: { email: "a@b.com" },
to: [{ email: "c@d.com" }],
cc: [{ email: "cc1@b.com" }, { email: "cc2@b.com" }],
subject: "Test",
headers,
})
expect(headers.CC).toContain("cc1@b.com")
expect(headers.CC).toContain("cc2@b.com")
})

it("non-ASCII display name encoded via RFC 2047", () => {
const headers: Record<string, string> = {}
resolveHeaders({
from: { name: "\u7530\u4E2D\u592A\u90CE", email: "tanaka@example.com" },
to: [{ email: "c@d.com" }],
subject: "Test",
headers,
})
expect(headers.From).toContain("=?UTF-8?Q?")
})

it("empty subject omits Subject header (falsy check)", () => {
const headers: Record<string, string> = {}
resolveHeaders({
from: { email: "a@b.com" },
to: [{ email: "c@d.com" }],
subject: "",
headers,
})
// Empty subject should not set Subject header (falsy check)
expect(headers.Subject).toBeUndefined()
})
})
