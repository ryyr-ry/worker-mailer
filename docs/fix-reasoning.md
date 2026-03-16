# 全34件問題修正 — 思考過程記録

## フェーズ1: P1/P2セキュリティ修正

### #1 mimeType CRLFインジェクション (P1)

**問題の本質:**
`src/email/mime.ts`の`buildAttachmentPart()`と`buildInlinePart()`で`attachment.mimeType`が
`Content-Type`ヘッダーにそのまま埋め込まれる。TypeScriptの型は`string?`であり、
実行時にCRLFを含む文字列を渡すとMIMEヘッダーインジェクションが成立する。

例: `mimeType: "text/plain\r\nBcc: attacker@evil.com"` →
```
Content-Type: text/plain
Bcc: attacker@evil.com; name="file.txt"
```

**修正方針:**
- `Email`クラスの`validateAttachmentEntry()`にmimeTypeのCRLFチェックを追加
- 入力バリデーションは境界（Emailクラスのコンストラクタ）で行うのが正しい設計
- `getMimeType()`が返す値はハードコードされた安全な文字列なので問題なし
- 追加で制御文字（0x00-0x1F）も拒否する（RFC 2045違反防止）

**影響範囲:** `src/email/email.ts`のstaticメソッド`validateAttachmentEntry`

---

### #2 calendarEvent.method CRLFインジェクション (P1)

**問題の本質:**
`CalendarEventPart.method`はTypeScript型で`"REQUEST" | "CANCEL" | "REPLY"`に制限されているが、
実行時（JavaScript）では任意の文字列が渡せる。`buildCalendarPart()`で
`Content-Type: text/calendar; charset="UTF-8"; method=${method}`として埋め込まれるため、
CRLFを含む値でヘッダーインジェクションが可能。

**修正方針:**
- `Email.validateCalendarEvent()`にmethod値のランタイムバリデーションを追加
- 許可値を`"REQUEST" | "CANCEL" | "REPLY"`のホワイトリストで検証
- TypeScript型に依存せず、実行時に不正値を拒否する防御的プログラミング

**影響範囲:** `src/email/email.ts`の`validateCalendarEvent()`

---

### #3 DSN envelopeIdパラメータインジェクション (P2)

**問題の本質:**
`src/mailer/commands.ts:18-22`でenvelopeIdのCRLFチェックは存在するが、
スペースを含む値が通過する。SMTPの`MAIL FROM`コマンドでは
`ENVID=value`の後にスペースで区切った追加パラメータを注入できる。

例: `envelopeId: "myid SIZE=999999999"` →
`MAIL FROM: <sender@test.com> RET=HDRS ENVID=myid SIZE=999999999`

RFC 3461 Section 4.4によるとENVIDの値はxtext形式で、
printable ASCII（0x21-0x7E）から`+`と`=`を除いた文字のみ許可される。
スペース（0x20）は許可されない。

**修正方針:**
- envelopeIdのバリデーションを強化: xtextルールに従い、
  スペースと制御文字を拒否する正規表現を追加
- 既存のCRLFチェックに追加する形で実装

**影響範囲:** `src/mailer/commands.ts`の`mailFrom()`

---

### #4 AUTH認証情報ログ漏洩 (P2)

**問題の本質:**
`src/logger.ts`の`sanitize()`メソッドは以下のパターンで認証情報をマスクする:
1. `AUTH_CREDENTIAL_PATTERN`: `AUTH PLAIN|LOGIN <base64>` 形式
2. `BASE64_LONG_PATTERN`: 64文字以上のbase64文字列

AUTH LOGINフローでは、ユーザー名とパスワードがそれぞれ独立した行で
base64エンコードされて送信される。これらは:
- "AUTH"プレフィックスがない（パターン1に合致しない）
- 典型的に短い（パターン2の64文字閾値を下回る）

例: `"Write to socket:\ndXNlcm5hbWU=\r\n"` (base64 of "username") →
12文字のbase64で、どちらのパターンにも合致せず素通りする。

**修正方針:**
- 独立した行に出現するbase64文字列を検出するパターンを追加
- `\n`の後に8文字以上のbase64文字列が`\r\n`で終わるパターンを検出
- 閾値を8文字にする理由: 一般的なSMTP応答コード（250, 334等）は数字であり
  base64パターンに合致しない。8文字以上のpure base64は認証情報の可能性が高い

**影響範囲:** `src/logger.ts`の`sanitize()`メソッドと関連パターン定数

---
