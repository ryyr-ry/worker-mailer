import type { EmailOptions } from "./email/types"

export type TestEmailOptions = {
	from: string
	to: string | string[]
	smtpHost?: string
}

export function createTestEmail(options: TestEmailOptions): EmailOptions {
	const timestamp = new Date().toISOString()
	const hostInfo = options.smtpHost
		? `<p>SMTP: <code>${escapeHtml(options.smtpHost)}</code></p>`
		: ""

	return {
		from: options.from,
		to: options.to,
		subject: `[worker-mailer] Send Test — ${timestamp}`,
		text: [
			"✅ worker-mailer: Send test succeeded",
			"",
			`From: ${options.from}`,
			`Time: ${timestamp}`,
			options.smtpHost ? `SMTP: ${options.smtpHost}` : "",
			"",
			"This email is for verifying worker-mailer functionality.",
		]
			.filter(Boolean)
			.join("\n"),
		html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:20px;background:#f9fafb;border-radius:8px">
<h1 style="color:#22c55e;font-size:24px">✅ Send test succeeded</h1>
<p style="color:#374151">Email from worker-mailer was successfully delivered.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">
<p>From: <code>${escapeHtml(options.from)}</code></p>
<p>Time: <code>${escapeHtml(timestamp)}</code></p>
${hostInfo}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">
<p style="color:#9ca3af;font-size:12px">This email was automatically generated for worker-mailer verification.</p>
</body>
</html>`,
	}
}

function escapeHtml(str: string): string {
	return str
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")
}
