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
	if (address === "") {
		return { valid: false, reason: "Email address is empty" }
	}

	if (address.length > MAX_TOTAL_LENGTH) {
		return {
			valid: false,
			reason: `Email address is too long (${address.length} chars, max ${MAX_TOTAL_LENGTH})`,
		}
	}

	if (containsControlChar(address)) {
		return { valid: false, reason: "Email address contains control characters" }
	}

	const atIndex = address.lastIndexOf("@")
	if (atIndex === -1) {
		return { valid: false, reason: "Email address does not contain @" }
	}

	const localPart = address.slice(0, atIndex)
	const domainPart = address.slice(atIndex + 1)

	if (localPart === "") {
		return { valid: false, reason: "Local part is empty" }
	}

	if (localPart.length > MAX_LOCAL_LENGTH) {
		return {
			valid: false,
			reason: `Local part is too long (${localPart.length} chars, max ${MAX_LOCAL_LENGTH})`,
		}
	}

	if (localPart.startsWith(".")) {
		return { valid: false, reason: "Local part starts with a dot" }
	}

	if (localPart.endsWith(".")) {
		return { valid: false, reason: "Local part ends with a dot" }
	}

	if (localPart.includes("..")) {
		return { valid: false, reason: "Local part contains consecutive dots" }
	}

	if (domainPart === "") {
		return { valid: false, reason: "Domain part is empty" }
	}

	if (domainPart.length > MAX_DOMAIN_LENGTH) {
		return {
			valid: false,
			reason: `Domain part is too long (${domainPart.length} chars, max ${MAX_DOMAIN_LENGTH})`,
		}
	}

	if (domainPart.startsWith(".")) {
		return { valid: false, reason: "Domain part starts with a dot" }
	}

	if (domainPart.endsWith(".")) {
		return { valid: false, reason: "Domain part ends with a dot" }
	}

	if (domainPart.includes("..")) {
		return { valid: false, reason: "Domain part contains consecutive dots" }
	}

	if (!domainPart.includes(".")) {
		return {
			valid: false,
			reason: "Domain part does not contain a dot (TLD required)",
		}
	}

	const labels = domainPart.split(".")
	for (const label of labels) {
		if (label === "") {
			return { valid: false, reason: "Domain part contains an empty label" }
		}
		if (label.length > MAX_LABEL_LENGTH) {
			return {
				valid: false,
				reason: `Domain label "${label}" is too long (${label.length} chars, max ${MAX_LABEL_LENGTH})`,
			}
		}
	}

	return { valid: true }
}

export function validateEmailBatch(addresses: string[]): Map<string, ValidationResult> {
	const results = new Map<string, ValidationResult>()
	for (const address of addresses) {
		results.set(address, validateEmail(address))
	}
	return results
}
