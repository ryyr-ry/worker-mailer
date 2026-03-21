import type { EmailOptions } from "../email/types"
import type Logger from "../logger"
import type { SendResult } from "../result"
import { tryHook } from "./hook-utils"
import type { SendHooks } from "./types"

export type MailPlugin = {
	name: string
	beforeSend?: (
		email: EmailOptions,
	) => EmailOptions | false | undefined | Promise<EmailOptions | false | undefined>
	afterSend?: (email: EmailOptions, result: SendResult) => void | Promise<void>
	onSendError?: (email: EmailOptions, error: Error) => void | Promise<void>
	onConnected?: (info: { host: string; port: number }) => void | Promise<void>
	onDisconnected?: (info: { reason?: string }) => void | Promise<void>
	onReconnecting?: (info: { attempt: number }) => void
	onFatalError?: (error: Error) => void | Promise<void>
}

export function hooksToPlugin(hooks: SendHooks): MailPlugin {
	return { name: "__hooks__", ...hooks }
}

export class PluginRunner {
	private readonly plugins: MailPlugin[]
	private readonly logger: Logger

	constructor(logger: Logger, hooks?: SendHooks, plugins?: MailPlugin[]) {
		this.logger = logger
		this.plugins = []
		if (hooks) this.plugins.push(hooksToPlugin(hooks))
		if (plugins) this.plugins.push(...plugins)
	}

	get hasBeforeSend(): boolean {
		return this.plugins.some((p) => p.beforeSend !== undefined)
	}

	get hasFatalErrorHandler(): boolean {
		return this.plugins.some((p) => p.onFatalError !== undefined)
	}

	async beforeSend(email: EmailOptions): Promise<EmailOptions | false> {
		let current = email
		for (const plugin of this.plugins) {
			if (!plugin.beforeSend) continue
			const result = await plugin.beforeSend(current)
			if (result === false) return false
			if (result && typeof result === "object") current = result
		}
		return current
	}

	async afterSend(email: EmailOptions, result: SendResult): Promise<void> {
		for (const p of this.plugins)
			await tryHook(this.logger, `${p.name}.afterSend`, p.afterSend, email, result)
	}

	async onSendError(email: EmailOptions, error: Error): Promise<void> {
		for (const p of this.plugins)
			await tryHook(this.logger, `${p.name}.onSendError`, p.onSendError, email, error)
	}

	async onConnected(info: { host: string; port: number }): Promise<void> {
		for (const p of this.plugins)
			await tryHook(this.logger, `${p.name}.onConnected`, p.onConnected, info)
	}

	async onDisconnected(info: { reason?: string }): Promise<void> {
		for (const p of this.plugins)
			await tryHook(this.logger, `${p.name}.onDisconnected`, p.onDisconnected, info)
	}

	onReconnecting(info: { attempt: number }): void {
		for (const p of this.plugins) {
			if (!p.onReconnecting) continue
			try {
				p.onReconnecting(info)
			} catch (e) {
				this.logger.error(`[Plugin:${p.name}] onReconnecting error`, e)
			}
		}
	}

	async onFatalError(error: Error): Promise<void> {
		for (const p of this.plugins)
			await tryHook(this.logger, `${p.name}.onFatalError`, p.onFatalError, error)
	}
}
