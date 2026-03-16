export class WorkerMailerError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "WorkerMailerError"
	}
}

export class CrlfInjectionError extends WorkerMailerError {
	constructor(context: string) {
		super(`CRLF injection detected in ${context}`)
		this.name = "CrlfInjectionError"
	}
}

export class EmailValidationError extends WorkerMailerError {
	constructor(message: string) {
		super(message)
		this.name = "EmailValidationError"
	}
}

export class SmtpAuthError extends WorkerMailerError {
	constructor(message: string) {
		super(message)
		this.name = "SmtpAuthError"
	}
}

export class SmtpCommandError extends WorkerMailerError {
	readonly command: string
	readonly response: string
	constructor(command: string, response: string) {
		super(`[WorkerMailer] ${command} failed: ${response}`)
		this.name = "SmtpCommandError"
		this.command = command
		this.response = response
	}
}

export class SmtpConnectionError extends WorkerMailerError {
	constructor(message: string) {
		super(message)
		this.name = "SmtpConnectionError"
	}
}

export class ConfigurationError extends WorkerMailerError {
	constructor(message: string) {
		super(message)
		this.name = "ConfigurationError"
	}
}

export class DkimError extends WorkerMailerError {
	constructor(message: string) {
		super(message)
		this.name = "DkimError"
	}
}

export class CalendarValidationError extends WorkerMailerError {
	constructor(message: string) {
		super(message)
		this.name = "CalendarValidationError"
	}
}

export class QueueClosedError extends WorkerMailerError {
	constructor() {
		super("Queue is closed")
		this.name = "QueueClosedError"
	}
}
