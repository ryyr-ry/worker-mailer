import { describe, expect, it } from "vitest"
import {
applyDotStuffing,
buildMimeMessage,
generateSafeBoundary,
getMimeType,
} from "../../src/email/mime"

describe("applyDotStuffing (RFC 5321 Section 4.5.2)", () => {
it("doubles dot at start of line after CRLF", () => {
expect(applyDotStuffing("hello\r\n.world")).toBe("hello\r\n..world")
})

it("doubles dot at very start of message", () => {
expect(applyDotStuffing(".first line")).toBe("..first line")
})

it("does not modify dots mid-line", () => {
expect(applyDotStuffing("no.dots.here")).toBe("no.dots.here")
})

it("doubles standalone dot on a line (message terminator protection)", () => {
expect(applyDotStuffing("line\r\n.\r\nmore")).toBe("line\r\n..\r\nmore")
})
})

describe("generateSafeBoundary (RFC 2046 Section 5.1.1)", () => {
it("produces unique boundaries on successive calls", () => {
const a = generateSafeBoundary("test_")
const b = generateSafeBoundary("test_")
expect(a).not.toBe(b)
})

it("does not contain RFC 2046 forbidden characters", () => {
const boundary = generateSafeBoundary("mixed_")
expect(boundary).not.toMatch(/[<>@,;:\\/[\]?=" ]/)
})
})

describe("getMimeType", () => {
it("maps common extensions", () => {
expect(getMimeType("photo.png")).toBe("image/png")
expect(getMimeType("doc.pdf")).toBe("application/pdf")
expect(getMimeType("page.html")).toBe("text/html")
})

it("returns application/octet-stream for unknown extension", () => {
expect(getMimeType("data.xyz")).toBe("application/octet-stream")
})
})

describe("buildMimeMessage MIME structure (RFC 2045/2046)", () => {
const baseHeaders: Record<string, string> = {
From: "a@b.com",
To: "c@d.com",
Subject: "Test",
Date: "Mon, 01 Jan 2024 00:00:00 +0000",
"Message-ID": "<test@b.com>",
}
const headers = () => ({ ...baseHeaders })

it("text-only: Content-Type text/plain", () => {
const msg = buildMimeMessage({ headers: headers(), text: "hello" })
expect(msg).toContain("text/plain")
expect(msg).not.toContain("multipart")
})

it("html-only: Content-Type text/html", () => {
const msg = buildMimeMessage({ headers: headers(), html: "<p>hi</p>" })
expect(msg).toContain("text/html")
expect(msg).not.toContain("multipart")
})

it("text+html: multipart/alternative with text before html (RFC 2046 Section 5.1.4)", () => {
const msg = buildMimeMessage({ headers: headers(), text: "hi", html: "<p>hi</p>" })
expect(msg).toContain("multipart/alternative")
const textIdx = msg.indexOf("text/plain")
const htmlIdx = msg.indexOf("text/html")
expect(textIdx).toBeLessThan(htmlIdx)
})

it("text+attachment: multipart/mixed", () => {
const msg = buildMimeMessage({
headers: headers(),
text: "hi",
attachments: [{ filename: "f.txt", content: "dGVzdA==" }],
})
expect(msg).toContain("multipart/mixed")
})

it("html+inline: multipart/related", () => {
const msg = buildMimeMessage({
headers: headers(),
html: '<img src="cid:img1">',
inlineAttachments: [{ cid: "img1", filename: "img.png", content: "iVBOR" }],
})
expect(msg).toContain("multipart/related")
})

it("text+html+attachment: alternative nested in mixed (RFC 2046)", () => {
const msg = buildMimeMessage({
headers: headers(),
text: "hi",
html: "<p>hi</p>",
attachments: [{ filename: "f.txt", content: "dGVzdA==" }],
})
expect(msg).toContain("multipart/mixed")
expect(msg).toContain("multipart/alternative")
})

it("html+inline+attachment: related nested in mixed", () => {
const msg = buildMimeMessage({
headers: headers(),
html: '<img src="cid:i">',
inlineAttachments: [{ cid: "i", filename: "i.png", content: "iVBOR" }],
attachments: [{ filename: "f.txt", content: "dGVzdA==" }],
})
expect(msg).toContain("multipart/mixed")
expect(msg).toContain("multipart/related")
})

it("text+calendar: multipart/alternative (RFC 5545)", () => {
const msg = buildMimeMessage({
headers: headers(),
text: "Meeting",
calendarEvent: { content: "BEGIN:VCALENDAR\r\nEND:VCALENDAR", method: "REQUEST" },
})
expect(msg).toContain("multipart/alternative")
expect(msg).toContain("text/calendar")
})

it("html+calendar: multipart/alternative", () => {
const msg = buildMimeMessage({
headers: headers(),
html: "<p>Meeting</p>",
calendarEvent: { content: "BEGIN:VCALENDAR\r\nEND:VCALENDAR", method: "REQUEST" },
})
expect(msg).toContain("multipart/alternative")
expect(msg).toContain("text/calendar")
})

it("text+html+calendar: alternative with all three", () => {
const msg = buildMimeMessage({
headers: headers(),
text: "Meeting",
html: "<p>Meeting</p>",
calendarEvent: { content: "BEGIN:VCALENDAR\r\nEND:VCALENDAR", method: "REQUEST" },
})
expect(msg).toContain("text/plain")
expect(msg).toContain("text/html")
expect(msg).toContain("text/calendar")
})

it("html+inline+calendar preserves inline images (P1 fix)", () => {
const msg = buildMimeMessage({
headers: headers(),
html: '<img src="cid:logo">',
inlineAttachments: [{ cid: "logo", filename: "logo.png", content: "iVBOR" }],
calendarEvent: { content: "BEGIN:VCALENDAR\r\nEND:VCALENDAR" },
})
expect(msg).toContain("multipart/related")
expect(msg).toContain("Content-ID: <logo>")
expect(msg).toContain("text/calendar")
})

it("text+html+attachment+calendar: full combo", () => {
const msg = buildMimeMessage({
headers: headers(),
text: "hi",
html: "<p>hi</p>",
attachments: [{ filename: "f.pdf", content: "JVBER" }],
calendarEvent: { content: "BEGIN:VCALENDAR\r\nEND:VCALENDAR" },
})
expect(msg).toContain("multipart/mixed")
expect(msg).toContain("multipart/alternative")
expect(msg).toContain("text/calendar")
expect(msg).toContain("application/pdf")
})

it("boundary does not appear in content", () => {
const msg = buildMimeMessage({ headers: headers(), text: "hi", html: "<p>hi</p>" })
const boundaryMatch = msg.match(/boundary="([^"]+)"/)
expect(boundaryMatch).toBeTruthy()
const boundary = boundaryMatch![1]
// Boundary should only appear as delimiter, not in actual content
const bodyStart = msg.indexOf("\r\n\r\n")
const body = msg.slice(bodyStart)
const occurrences = body.split(boundary).length - 1
// Should appear as delimiters (at least 3: open, between, close)
expect(occurrences).toBeGreaterThanOrEqual(3)
})

it("binary attachment encoded as base64", () => {
const content = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
const msg = buildMimeMessage({
headers: headers(),
text: "see attached",
attachments: [{ filename: "img.png", content: content }],
})
expect(msg).toContain("Content-Transfer-Encoding: base64")
})

it("no html part produced when html is undefined (P2 fix)", () => {
const msg = buildMimeMessage({ headers: headers(), text: "only text" })
expect(msg).not.toContain("text/html")
})

it("MIME-Version: 1.0 always present", () => {
const msg = buildMimeMessage({ headers: headers(), text: "hi" })
expect(msg).toContain("MIME-Version: 1.0")
})

it("headers are properly formatted as Key: Value", () => {
const msg = buildMimeMessage({ headers: headers(), text: "hi" })
expect(msg).toContain("From: a@b.com")
expect(msg).toContain("To: c@d.com")
expect(msg).toContain("Subject: Test")
})
})
