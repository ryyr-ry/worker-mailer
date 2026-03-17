import { beforeAll, describe, expect, it } from "vitest"
import {
canonicalizeRelaxedBody,
canonicalizeRelaxedHeader,
canonicalizeSimpleBody,
canonicalizeSimpleHeader,
importDkimKey,
resolveDkimKey,
signDkim,
type DkimOptions,
} from "../../src/dkim"
import { DkimError } from "../../src/errors"

function toBase64(buf: ArrayBuffer): string {
const bytes = new Uint8Array(buf)
let bin = ""
for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
return btoa(bin)
}

function exportKeyToPem(buf: ArrayBuffer): string {
const b64 = toBase64(buf)
const lines = b64.match(/.{1,64}/g) ?? [b64]
return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----`
}

let keyPair: CryptoKeyPair
let pem: string
let opts: DkimOptions

beforeAll(async () => {
keyPair = await crypto.subtle.generateKey(
{ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
true, ["sign", "verify"],
)
const exported = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey)
pem = exportKeyToPem(exported)
opts = { domainName: "example.com", keySelector: "test", privateKey: pem }
})

const MSG = "From: a@example.com\r\nTo: b@example.com\r\nSubject: Hi\r\n\r\nHello"

describe("Canonicalization (RFC 6376 Section 3.4)", () => {
it("relaxed header: lowercases name and collapses whitespace", () => {
expect(canonicalizeRelaxedHeader("Subject", "  Hello   World "))
.toBe("subject:Hello World")
})

it("relaxed header: unfolds continuation lines", () => {
expect(canonicalizeRelaxedHeader("Subject", " line1\r\n\tline2"))
.toBe("subject:line1 line2")
})

it("relaxed body: strips trailing whitespace per line", () => {
expect(canonicalizeRelaxedBody("Hello  \r\nWorld \r\n"))
.toBe("Hello\r\nWorld\r\n")
})

it("relaxed body: removes trailing empty lines", () => {
expect(canonicalizeRelaxedBody("Hello\r\n\r\n\r\n"))
.toBe("Hello\r\n")
})

it("relaxed body: collapses internal whitespace to single space", () => {
expect(canonicalizeRelaxedBody("a  b\t\tc\r\n"))
.toBe("a b c\r\n")
})

it("relaxed body: empty body returns CRLF", () => {
expect(canonicalizeRelaxedBody("")).toBe("\r\n")
})

it("simple header: preserves original exactly", () => {
expect(canonicalizeSimpleHeader("Subject", " Hello  World "))
.toBe("Subject: Hello  World ")
})

it("simple body: removes only trailing empty lines", () => {
expect(canonicalizeSimpleBody("Hello  \r\n\r\n\r\n"))
.toBe("Hello  \r\n")
})

it("simple body: preserves internal whitespace", () => {
expect(canonicalizeSimpleBody("a  b\t\tc\r\n"))
.toBe("a  b\t\tc\r\n")
})

it("simple body: empty body returns CRLF", () => {
expect(canonicalizeSimpleBody("")).toBe("\r\n")
})
})

describe("Key management", () => {
it("importDkimKey imports PKCS#8 PEM as CryptoKey", async () => {
const key = await importDkimKey(pem)
expect(key.type).toBe("private")
expect(key.algorithm).toMatchObject({ name: "RSASSA-PKCS1-v1_5" })
})

it("importDkimKey rejects PKCS#1 format with clear error", async () => {
const pkcs1 = "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----"
await expect(importDkimKey(pkcs1)).rejects.toThrow(DkimError)
await expect(importDkimKey(pkcs1)).rejects.toThrow("PKCS#1")
})

it("importDkimKey rejects empty PEM", async () => {
await expect(importDkimKey("-----BEGIN PRIVATE KEY----------END PRIVATE KEY-----"))
.rejects.toThrow(DkimError)
})

it("resolveDkimKey returns cached key when provided", async () => {
const cached = keyPair.privateKey
const result = await resolveDkimKey(opts, cached)
expect(result).toBe(cached)
})

it("resolveDkimKey accepts CryptoKey directly", async () => {
const result = await resolveDkimKey({ ...opts, privateKey: keyPair.privateKey })
expect(result).toBe(keyPair.privateKey)
})

it("resolveDkimKey imports PEM string", async () => {
const result = await resolveDkimKey(opts)
expect(result.type).toBe("private")
})
})

describe("signDkim (RFC 6376 Section 3.5)", () => {
it("prepends DKIM-Signature as first header", async () => {
const signed = await signDkim(MSG, opts)
expect(signed.startsWith("DKIM-Signature:")).toBe(true)
})

it("DKIM-Signature has required tags v,a,d,s,h,bh,b", async () => {
const signed = await signDkim(MSG, opts)
const sigLine = signed.split("\r\n\r\n")[0].split("\r\n")
.filter(l => l.startsWith("DKIM-Signature:") || /^[\t ]/.test(l)).join("")
for (const tag of ["v=1", "a=rsa-sha256", "d=example.com", "s=test", "h=", "bh=", "b="]) {
expect(sigLine).toContain(tag)
}
})

it("b= value is valid base64", async () => {
const signed = await signDkim(MSG, opts)
const sigHeader = signed.substring(0, signed.indexOf("\r\nFrom:"))
const bMatch = sigHeader.match(/b=([A-Za-z0-9+/=\s]+)/)
expect(bMatch).toBeTruthy()
const b64 = bMatch![1].replace(/\s/g, "")
expect(() => atob(b64)).not.toThrow()
})

it("bh= matches SHA-256 of canonicalized body", async () => {
const signed = await signDkim(MSG, opts)
const bhMatch = signed.match(/bh=([A-Za-z0-9+/=]+)/)
expect(bhMatch).toBeTruthy()
const canonBody = canonicalizeRelaxedBody("Hello")
const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonBody))
const expected = toBase64(digest)
expect(bhMatch![1]).toBe(expected)
})

it("signature is verifiable with public key", async () => {
const signed = await signDkim(MSG, opts)
const headerEnd = signed.indexOf("\r\n\r\n")
const headerSection = signed.substring(0, headerEnd)
const lines = headerSection.split("\r\n")
const sigLines: string[] = []
for (const line of lines) {
if (line.startsWith("DKIM-Signature:") || (sigLines.length > 0 && /^[\t ]/.test(line))) {
sigLines.push(line)
} else if (sigLines.length > 0) break
}
const sigRaw = sigLines.join("\r\n")
const bMatch = sigRaw.match(/b=([A-Za-z0-9+/=\s]+)$/)
expect(bMatch).toBeTruthy()
const sigBytes = atob(bMatch![1].replace(/\s/g, ""))
const sigBuffer = new Uint8Array(sigBytes.length)
for (let i = 0; i < sigBytes.length; i++) sigBuffer[i] = sigBytes.charCodeAt(i)
const templateNoB = sigRaw.replace(/b=[A-Za-z0-9+/=\s]+$/, "b=")
const signingParts: string[] = []
for (const h of ["from", "to", "subject", "date", "message-id", "mime-version", "content-type"]) {
const found = lines.find(l => l.toLowerCase().startsWith(`${h}:`))
if (found) {
const colonIdx = found.indexOf(":")
signingParts.push(canonicalizeRelaxedHeader(found.substring(0, colonIdx), found.substring(colonIdx + 1)))
}
}
const tmplColon = templateNoB.indexOf(":")
signingParts.push(canonicalizeRelaxedHeader(templateNoB.substring(0, tmplColon), templateNoB.substring(tmplColon + 1)))
const signingInput = signingParts.join("\r\n")
const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", keyPair.publicKey, sigBuffer, new TextEncoder().encode(signingInput))
expect(valid).toBe(true)
})

it("relaxed/simple canonicalization sets c= correctly", async () => {
const signed = await signDkim(MSG, { ...opts, canonicalization: "relaxed/simple" })
expect(signed).toContain("c=relaxed/simple")
})

it("simple/simple canonicalization sets c= correctly", async () => {
const signed = await signDkim(MSG, { ...opts, canonicalization: "simple/simple" })
expect(signed).toContain("c=simple/simple")
})

it("custom headerFieldNames signs only specified headers", async () => {
const signed = await signDkim(MSG, { ...opts, headerFieldNames: ["from", "subject"] })
const sigHeader = signed.split("\r\n\r\n")[0]
expect(sigHeader).toContain("h=from:subject")
})

it("signature line folded at 72 chars", async () => {
const signed = await signDkim(MSG, opts)
const headerEnd = signed.indexOf("\r\n\r\n")
const headerLines = signed.substring(0, headerEnd).split("\r\n")
for (const line of headerLines) {
if (line.startsWith("DKIM-Signature:") || /^[\t ]/.test(line)) {
expect(line.length).toBeLessThanOrEqual(80)
}
}
})

it("original message preserved after signature", async () => {
const signed = await signDkim(MSG, opts)
expect(signed).toContain(MSG)
})

it("empty body signs without error", async () => {
const noBody = "From: a@example.com\r\nTo: b@example.com\r\nSubject: Hi\r\n\r\n"
const signed = await signDkim(noBody, opts)
expect(signed).toContain("DKIM-Signature:")
})
})
