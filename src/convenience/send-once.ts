import type { EmailOptions } from "../email"
import type { SendResult } from "../result"
import { createFromEnv } from "./env"

export async function sendOnce(
	env: Record<string, unknown>,
	emailOptions: EmailOptions,
	prefix = "SMTP_",
): Promise<SendResult> {
	const mailer = await createFromEnv(env, prefix)
	try {
		return await mailer.send(emailOptions)
	} finally {
		await mailer.close()
	}
}
