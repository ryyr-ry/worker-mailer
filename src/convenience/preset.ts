import type { WorkerMailerOptions } from "../mailer"
import { getString } from "./env"

export type SmtpProvider = "gmail" | "outlook" | "sendgrid"

const SMTP_HOSTS: Record<SmtpProvider, string> = {
	gmail: "smtp.gmail.com",
	outlook: "smtp.office365.com",
	sendgrid: "smtp.sendgrid.net",
}

export function preset(provider: SmtpProvider, env: Record<string, unknown>): WorkerMailerOptions {
	const user = getString(env, "SMTP_USER")
	const pass = getString(env, "SMTP_PASS")
	const options: WorkerMailerOptions = {
		host: SMTP_HOSTS[provider],
		port: 587,
		secure: false,
		startTls: true,
		authType: ["plain"],
	}
	if (user !== undefined && pass !== undefined) {
		options.username = user
		options.password = pass
	}
	return options
}
