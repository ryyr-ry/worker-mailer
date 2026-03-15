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
		return { valid: false, reason: "メールアドレスが空です" }
	}

	if (address.length > MAX_TOTAL_LENGTH) {
		return {
			valid: false,
			reason: `メールアドレスが長すぎます（${address.length}文字、上限${MAX_TOTAL_LENGTH}文字）`,
		}
	}

	if (containsControlChar(address)) {
		return { valid: false, reason: "メールアドレスに制御文字が含まれています" }
	}

	const atIndex = address.lastIndexOf("@")
	if (atIndex === -1) {
		return { valid: false, reason: "メールアドレスに @ が含まれていません" }
	}

	const localPart = address.slice(0, atIndex)
	const domainPart = address.slice(atIndex + 1)

	if (localPart === "") {
		return { valid: false, reason: "ローカル部分が空です" }
	}

	if (localPart.length > MAX_LOCAL_LENGTH) {
		return {
			valid: false,
			reason: `ローカル部分が長すぎます（${localPart.length}文字、上限${MAX_LOCAL_LENGTH}文字）`,
		}
	}

	if (localPart.startsWith(".")) {
		return { valid: false, reason: "ローカル部分がドットで始まっています" }
	}

	if (localPart.endsWith(".")) {
		return { valid: false, reason: "ローカル部分がドットで終わっています" }
	}

	if (localPart.includes("..")) {
		return { valid: false, reason: "ローカル部分に連続するドットが含まれています" }
	}

	if (domainPart === "") {
		return { valid: false, reason: "ドメイン部分が空です" }
	}

	if (domainPart.length > MAX_DOMAIN_LENGTH) {
		return {
			valid: false,
			reason: `ドメイン部分が長すぎます（${domainPart.length}文字、上限${MAX_DOMAIN_LENGTH}文字）`,
		}
	}

	if (domainPart.startsWith(".")) {
		return { valid: false, reason: "ドメイン部分がドットで始まっています" }
	}

	if (domainPart.endsWith(".")) {
		return { valid: false, reason: "ドメイン部分がドットで終わっています" }
	}

	if (domainPart.includes("..")) {
		return { valid: false, reason: "ドメイン部分に連続するドットが含まれています" }
	}

	if (!domainPart.includes(".")) {
		return {
			valid: false,
			reason: "ドメイン部分にドットが含まれていません（TLDが必要です）",
		}
	}

	const labels = domainPart.split(".")
	for (const label of labels) {
		if (label === "") {
			return { valid: false, reason: "ドメイン部分に空のラベルが含まれています" }
		}
		if (label.length > MAX_LABEL_LENGTH) {
			return {
				valid: false,
				reason: `ドメインラベル "${label}" が長すぎます（${label.length}文字、上限${MAX_LABEL_LENGTH}文字）`,
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
