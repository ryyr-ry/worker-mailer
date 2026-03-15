import type { EmailOptions } from "../email/types"
import type { SendResult } from "../result"
import type { Mailer, WorkerMailerOptions } from "./types"
import { WorkerMailer } from "./worker-mailer"

export class WorkerMailerPool implements Mailer {
	private readonly options: WorkerMailerOptions
	private readonly poolSize: number
	private readonly mailers: WorkerMailer[] = []
	private nextIndex = 0

	constructor(options: WorkerMailerOptions & { poolSize?: number }) {
		const { poolSize, ...mailerOptions } = options
		this.poolSize = poolSize ?? 3
		this.options = mailerOptions
	}

	async connect(): Promise<this> {
		const connections = Array.from({ length: this.poolSize }, () =>
			WorkerMailer.connect(this.options),
		)
		const mailers = await Promise.all(connections)
		this.mailers.push(...mailers)
		return this
	}

	send(options: EmailOptions): Promise<SendResult> {
		if (this.mailers.length === 0) {
			return Promise.reject(new Error("[WorkerMailerPool] Send failed: pool is not connected"))
		}
		const mailer = this.mailers[this.nextIndex % this.mailers.length]
		this.nextIndex++
		return mailer.send(options)
	}

	async ping(): Promise<boolean> {
		if (this.mailers.length === 0) return false
		const results = await Promise.all(this.mailers.map((m) => m.ping()))
		return results.every(Boolean)
	}

	async close(): Promise<void> {
		await Promise.all(this.mailers.map((mailer) => mailer.close()))
		this.mailers.length = 0
		this.nextIndex = 0
	}

	async [Symbol.asyncDispose](): Promise<void> {
		await this.close()
	}
}
