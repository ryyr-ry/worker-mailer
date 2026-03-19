export type ValidationResult = { valid: true } | { valid: false; reason: string }

const MAX_LOCAL_LENGTH = 64
const MAX_DOMAIN_LENGTH = 253
const MAX_TOTAL_LENGTH = 320
const MAX_LABEL_LENGTH = 63

function containsControlChar(str: string): boolean {
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i)
		if ((code >= 0x00 && code <= 0x1f) || code === 0x7f) return true
	}
	return false
}

export function validateEmail(address: string): ValidationResult {
	if (address === "") return { valid: false, reason: "Email address is empty" }
	if (address.length > MAX_TOTAL_LENGTH) {
		return {
			valid: false,
			reason: `Email address is too long (${address.length} chars, max ${MAX_TOTAL_LENGTH})`,
		}
	}
	if (containsControlChar(address))
		return { valid: false, reason: "Email address contains control characters" }

	const atIndex = address.lastIndexOf("@")
	if (atIndex === -1) return { valid: false, reason: "Email address does not contain @" }

	const localPart = address.slice(0, atIndex)
	const domainPart = address.slice(atIndex + 1)

	return validateLocalPart(localPart) ?? validateDomainPart(domainPart) ?? { valid: true }
}

function validateLocalPart(local: string): ValidationResult | undefined {
	if (local === "") return { valid: false, reason: "Local part is empty" }
	if (local.length > MAX_LOCAL_LENGTH) {
		return {
			valid: false,
			reason: `Local part is too long (${local.length} chars, max ${MAX_LOCAL_LENGTH})`,
		}
	}
	if (local.startsWith('"')) {
		if (!local.endsWith('"') || local.length < 2) {
			return { valid: false, reason: "Quoted local part is missing closing quote" }
		}
		const inner = local.slice(1, -1)
		if (/(?<!\\)"/.test(inner)) {
			return { valid: false, reason: "Quoted local part contains unescaped quote" }
		}
	} else {
		if (local.includes("@")) {
			return { valid: false, reason: "Local part contains unquoted @" }
		}
	}
	if (local.startsWith(".")) return { valid: false, reason: "Local part starts with a dot" }
	if (local.endsWith(".")) return { valid: false, reason: "Local part ends with a dot" }
	if (local.includes("..")) return { valid: false, reason: "Local part contains consecutive dots" }
}

function validateDomainPart(domain: string): ValidationResult | undefined {
	if (domain === "") return { valid: false, reason: "Domain part is empty" }
	if (domain.length > MAX_DOMAIN_LENGTH) {
		return {
			valid: false,
			reason: `Domain part is too long (${domain.length} chars, max ${MAX_DOMAIN_LENGTH})`,
		}
	}
	if (domain.startsWith(".")) return { valid: false, reason: "Domain part starts with a dot" }
	if (domain.endsWith(".")) return { valid: false, reason: "Domain part ends with a dot" }
	if (domain.includes(".."))
		return { valid: false, reason: "Domain part contains consecutive dots" }
	if (!domain.includes("."))
		return { valid: false, reason: "Domain part does not contain a dot (TLD required)" }
	for (const label of domain.split(".")) {
		if (label === "") return { valid: false, reason: "Domain part contains an empty label" }
		if (label.length > MAX_LABEL_LENGTH) {
			return {
				valid: false,
				reason: `Domain label "${label}" is too long (${label.length} chars, max ${MAX_LABEL_LENGTH})`,
			}
		}
		if (label.startsWith("-") || label.endsWith("-")) {
			return { valid: false, reason: `Domain label "${label}" starts or ends with a hyphen` }
		}
	}
}

export function validateEmailBatch(addresses: string[]): Map<string, ValidationResult> {
	const results = new Map<string, ValidationResult>()
	for (const address of addresses) {
		results.set(address, validateEmail(address))
	}
	return results
}
