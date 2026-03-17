import { describe, expect, it } from "vitest"
import { MailBuilder } from "../../src/builder"

describe("MailBuilder", () => {
	describe("基本構築", () => {
		it("最小限のメールを構築する", () => {
			const email = new MailBuilder()
				.from("sender@example.com")
				.to("recipient@example.com")
				.subject("Test")
				.build()

			expect(email.from).toBe("sender@example.com")
			expect(email.to).toBe("recipient@example.com")
			expect(email.subject).toBe("Test")
		})

		it("テキスト本文を設定する", () => {
			const email = new MailBuilder()
				.from("a@x.com")
				.to("b@x.com")
				.subject("S")
				.text("Hello")
				.build()
			expect(email.text).toBe("Hello")
		})

		it("HTML本文を設定する", () => {
			const email = new MailBuilder()
				.from("a@x.com")
				.to("b@x.com")
				.subject("S")
				.html("<h1>Hello</h1>")
				.build()
			expect(email.html).toBe("<h1>Hello</h1>")
		})
	})

	describe("メソッドチェーン", () => {
		it("全メソッドをチェーンできる", () => {
			const email = new MailBuilder()
				.from({ name: "Sender", email: "sender@example.com" })
				.to("to@example.com")
				.cc("cc@example.com")
				.bcc("bcc@example.com")
				.replyTo("reply@example.com")
				.subject("Subject")
				.text("Text body")
				.html("<p>HTML body</p>")
				.header("X-Custom", "value")
				.build()

			expect(email.from).toEqual({ name: "Sender", email: "sender@example.com" })
			expect(email.to).toBe("to@example.com")
			expect(email.cc).toBe("cc@example.com")
			expect(email.bcc).toBe("bcc@example.com")
			expect(email.reply).toBe("reply@example.com")
			expect(email.subject).toBe("Subject")
			expect(email.text).toBe("Text body")
			expect(email.html).toBe("<p>HTML body</p>")
			expect(email.headers).toEqual({ "X-Custom": "value" })
		})

		it("各メソッドがthisを返す", () => {
			const builder = new MailBuilder()
			expect(builder.from("a@x.com")).toBe(builder)
			expect(builder.to("b@x.com")).toBe(builder)
			expect(builder.subject("S")).toBe(builder)
			expect(builder.text("T")).toBe(builder)
			expect(builder.html("H")).toBe(builder)
		})
	})

	describe("複数宛先", () => {
		it("複数のtoを設定する", () => {
			const email = new MailBuilder()
				.from("a@x.com")
				.to("b@x.com", "c@x.com")
				.subject("S")
				.build()
			expect(email.to).toEqual(["b@x.com", "c@x.com"])
		})

		it("複数のccを設定する", () => {
			const email = new MailBuilder()
				.from("a@x.com")
				.to("b@x.com")
				.cc("c@x.com", "d@x.com")
				.subject("S")
				.build()
			expect(email.cc).toEqual(["c@x.com", "d@x.com"])
		})

		it("複数のbccを設定する", () => {
			const email = new MailBuilder()
				.from("a@x.com")
				.to("b@x.com")
				.bcc("e@x.com", "f@x.com")
				.subject("S")
				.build()
			expect(email.bcc).toEqual(["e@x.com", "f@x.com"])
		})

		it("User型で宛先を指定する", () => {
			const email = new MailBuilder()
				.from("a@x.com")
				.to({ name: "Alice", email: "alice@x.com" }, { name: "Bob", email: "bob@x.com" })
				.subject("S")
				.build()
			expect(email.to).toEqual([
				{ name: "Alice", email: "alice@x.com" },
				{ name: "Bob", email: "bob@x.com" },
			])
		})

		it("単一宛先を配列でなく値で返す", () => {
			const email = new MailBuilder()
				.from("a@x.com")
				.to("b@x.com")
				.subject("S")
				.build()
			expect(email.to).toBe("b@x.com")
		})
	})

	describe("ヘッダー", () => {
		it("個別ヘッダーを追加する", () => {
			const email = new MailBuilder()
				.from("a@x.com")
				.to("b@x.com")
				.subject("S")
				.header("X-Priority", "1")
				.header("X-Mailer", "test")
				.build()
			expect(email.headers).toEqual({ "X-Priority": "1", "X-Mailer": "test" })
		})

		it("ヘッダーオブジェクトを一括追加する", () => {
			const email = new MailBuilder()
				.from("a@x.com")
				.to("b@x.com")
				.subject("S")
				.headers({ "X-A": "1", "X-B": "2" })
				.build()
			expect(email.headers).toEqual({ "X-A": "1", "X-B": "2" })
		})

		it("ヘッダーが蓄積される", () => {
			const email = new MailBuilder()
				.from("a@x.com")
				.to("b@x.com")
				.subject("S")
				.header("X-A", "1")
				.headers({ "X-B": "2" })
				.header("X-C", "3")
				.build()
			expect(email.headers).toEqual({ "X-A": "1", "X-B": "2", "X-C": "3" })
		})
	})

	describe("添付ファイル", () => {
		it("ファイルを添付する", () => {
			const email = new MailBuilder()
				.from("a@x.com")
				.to("b@x.com")
				.subject("S")
				.attach({ filename: "file.txt", content: "data" })
				.build()
			expect(email.attachments).toHaveLength(1)
			expect(email.attachments?.[0].filename).toBe("file.txt")
		})

		it("複数ファイルを添付する", () => {
			const email = new MailBuilder()
				.from("a@x.com")
				.to("b@x.com")
				.subject("S")
				.attach({ filename: "a.txt", content: "data1" })
				.attach({ filename: "b.txt", content: "data2" })
				.build()
			expect(email.attachments).toHaveLength(2)
		})

		it("インライン添付を追加する", () => {
			const email = new MailBuilder()
				.from("a@x.com")
				.to("b@x.com")
				.subject("S")
				.inlineAttach({ cid: "img1", filename: "logo.png", content: "png-data" })
				.build()
			expect(email.inlineAttachments).toHaveLength(1)
			expect(email.inlineAttachments?.[0].cid).toBe("img1")
		})
	})

	describe("カレンダー・DSN", () => {
		it("カレンダーイベントを設定する", () => {
			const email = new MailBuilder()
				.from("a@x.com")
				.to("b@x.com")
				.subject("S")
				.calendarEvent({ content: "BEGIN:VCALENDAR...", method: "REQUEST" })
				.build()
			expect(email.calendarEvent?.method).toBe("REQUEST")
		})

		it("DSNオプションを設定する", () => {
			const email = new MailBuilder()
				.from("a@x.com")
				.to("b@x.com")
				.subject("S")
				.dsn({ NOTIFY: { SUCCESS: true } })
				.build()
			expect(email.dsnOverride?.NOTIFY?.SUCCESS).toBe(true)
		})
	})

	describe("バリデーション", () => {
		it("fromがない場合エラーを投げる", () => {
			expect(() => new MailBuilder().to("b@x.com").subject("S").build()).toThrow(
				"from is required",
			)
		})

		it("toがない場合エラーを投げる", () => {
			expect(() => new MailBuilder().from("a@x.com").subject("S").build()).toThrow(
				"to is required",
			)
		})

		it("subjectがない場合エラーを投げる", () => {
			expect(() => new MailBuilder().from("a@x.com").to("b@x.com").build()).toThrow(
				"subject is required",
			)
		})
	})
})
