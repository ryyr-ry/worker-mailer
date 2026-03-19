import {
	canonicalizeRelaxedBody,
	canonicalizeRelaxedHeader,
	canonicalizeSimpleBody,
	canonicalizeSimpleHeader,
	type ParsedHeader,
	parseHeaders,
	selectDefaultHeaders,
} from "./dkim-canonicalize"
import { DkimError } from "./errors"
import { arrayBufferToBase64, encode, fromBase64ToBytes } from "./utils"

export {
	canonicalizeRelaxedBody,
	canonicalizeRelaxedHeader,
	canonicalizeSimpleBody,
	canonicalizeSimpleHeader,
} from "./dkim-canonicalize"

export type Canonicalization =
	| "relaxed/relaxed"
	| "relaxed/simple"
	| "simple/relaxed"
	| "simple/simple"

export type DkimOptions = {
	domainName: string
	keySelector: string
	privateKey: string | CryptoKey
	headerFieldNames?: string[]
	canonicalization?: Canonicalization
}

type CanonPair = {
	header: "relaxed" | "simple"
	body: "relaxed" | "simple"
}

function parseCanonicalization(value: Canonicalization): CanonPair {
	const [header, body] = value.split("/") as ["relaxed" | "simple", "relaxed" | "simple"]
	return { header, body }
}

export async function importDkimKey(pem: string): Promise<CryptoKey> {
	if (/-----BEGIN RSA PRIVATE KEY-----/.test(pem)) {
		throw new DkimError(
			"[DKIM] PKCS#1 format (BEGIN RSA PRIVATE KEY) is not supported. " +
				"Convert to PKCS#8 (BEGIN PRIVATE KEY) format.",
		)
	}
	const pemBody = pem
		.replace(/-----BEGIN PRIVATE KEY-----/, "")
		.replace(/-----END PRIVATE KEY-----/, "")
		.replace(/\s/g, "")
	if (!pemBody) throw new DkimError("[DKIM] Private key PEM is empty or invalid")
	const bytes = fromBase64ToBytes(pemBody)
	return crypto.subtle.importKey(
		"pkcs8",
		bytes.buffer as ArrayBuffer,
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["sign"],
	)
}

function splitMessage(raw: string): { headers: string; body: string } {
	const idx = raw.indexOf("\r\n\r\n")
	if (idx === -1) return { headers: raw, body: "" }
	return { headers: raw.substring(0, idx), body: raw.substring(idx + 4) }
}

async function hashBody(canonicalizedBody: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", encode(canonicalizedBody))
	return arrayBufferToBase64(digest)
}

async function rsaSign(key: CryptoKey, data: string): Promise<string> {
	const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encode(data))
	return arrayBufferToBase64(signature)
}

function canonHeader(name: string, value: string, method: "relaxed" | "simple"): string {
	return method === "relaxed"
		? canonicalizeRelaxedHeader(name, value)
		: canonicalizeSimpleHeader(name, value)
}

function canonBody(body: string, method: "relaxed" | "simple"): string {
	return method === "relaxed" ? canonicalizeRelaxedBody(body) : canonicalizeSimpleBody(body)
}

function findHeaderReverse(headers: ParsedHeader[], name: string): ParsedHeader | undefined {
	const lower = name.toLowerCase()
	for (let i = headers.length - 1; i >= 0; i--) {
		if (headers[i].name.toLowerCase() === lower) return headers[i]
	}
	return undefined
}

function buildTemplate(options: DkimOptions, headerNames: string[], bodyHash: string): string {
	const canon = options.canonicalization ?? "relaxed/relaxed"
	return [
		`DKIM-Signature: v=1; a=rsa-sha256; c=${canon};`,
		`\td=${options.domainName}; s=${options.keySelector};`,
		`\th=${headerNames.join(":")};`,
		`\tbh=${bodyHash};`,
		"\tb=",
	].join("\r\n")
}

function buildSigningInput(
	headers: ParsedHeader[],
	headerNames: string[],
	template: string,
	method: "relaxed" | "simple",
): string {
	const parts: string[] = []
	for (const name of headerNames) {
		const header = findHeaderReverse(headers, name)
		if (header) {
			parts.push(canonHeader(header.name, header.value, method))
		}
	}
	const colonIdx = template.indexOf(":")
	parts.push(canonHeader(template.substring(0, colonIdx), template.substring(colonIdx + 1), method))
	return parts.join("\r\n")
}

function appendSignature(template: string, signature: string): string {
	const chunks = signature.match(/.{1,72}/g) ?? [signature]
	return `${template}${chunks.join("\r\n\t ")}`
}

export async function resolveDkimKey(options: DkimOptions, cached?: CryptoKey): Promise<CryptoKey> {
	if (cached) return cached
	return typeof options.privateKey === "string"
		? importDkimKey(options.privateKey)
		: options.privateKey
}

export async function signDkim(rawMessage: string, options: DkimOptions): Promise<string> {
	const { headers: headerSection, body: bodySection } = splitMessage(rawMessage)
	const headers = parseHeaders(headerSection)
	const canon = parseCanonicalization(options.canonicalization ?? "relaxed/relaxed")
	const canonicalizedBody = canonBody(bodySection, canon.body)
	const bodyHash = await hashBody(canonicalizedBody)
	const headerNames = options.headerFieldNames ?? selectDefaultHeaders(headers)
	const key =
		typeof options.privateKey === "string"
			? await importDkimKey(options.privateKey)
			: options.privateKey
	const template = buildTemplate(options, headerNames, bodyHash)
	const signingInput = buildSigningInput(headers, headerNames, template, canon.header)
	const signature = await rsaSign(key, signingInput)
	return `${appendSignature(template, signature)}\r\n${rawMessage}`
}
