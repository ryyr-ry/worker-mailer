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
		subject: `[worker-mailer] 送信テスト — ${timestamp}`,
		text: [
			"✅ worker-mailer: 送信テスト成功",
			"",
			`送信元: ${options.from}`,
			`時刻: ${timestamp}`,
			options.smtpHost ? `SMTP: ${options.smtpHost}` : "",
			"",
			"このメールは worker-mailer の動作確認用です。",
		]
			.filter(Boolean)
			.join("\n"),
		html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:20px;background:#f9fafb;border-radius:8px">
<h1 style="color:#22c55e;font-size:24px">✅ 送信テスト成功</h1>
<p style="color:#374151">worker-mailer からのメールが正常に届きました。</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">
<p>送信元: <code>${escapeHtml(options.from)}</code></p>
<p>時刻: <code>${escapeHtml(timestamp)}</code></p>
${hostInfo}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">
<p style="color:#9ca3af;font-size:12px">このメールは worker-mailer の動作確認用に自動生成されました。</p>
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
