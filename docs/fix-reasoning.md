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

## フェーズ2: P1アーキテクチャ修正

### #5 close()/executeSend()レースコンディション (P1)

**問題の本質:**
JavaScript（Workers）はシングルスレッドだが、async/awaitによるインターリーブで
レースコンディションが発生する。具体的には:
1. `executeSend()`が`await mailFrom()`等でsuspend中
2. その間に外部から`close()`が呼ばれる
3. `close()`は即座に`transport.quit()`を呼ぶ
4. `executeSend()`が再開すると、閉じられたトランスポートで操作を試みる

**修正方針:**
- `sendingPromise`フィールドを追加し、現在の送信処理を追跡
- `start()`で`processEmailWithRetry()`の戻り値をsendingPromiseに保存
- `close()`は`sendingPromise`をawaitしてからtransport.quit()を実行
- これにより送信中のトランスポートを安全にシャットダウンできる

**影響範囲:** `src/mailer/worker-mailer.ts`の`close()`, `start()`

---

### #6 RSET失敗時の無意味リトライ (P1)

**問題の本質:**
`handleSendFailure()`でRSETが失敗した場合、以下のフローで問題が発生:
- `autoReconnect=false`かつ`attempt < maxRetries`の場合
- catchブロック内の2つのif文を両方スキップ
- catchブロックを抜けてL208のbackoff+return falseに到達
- 壊れた接続でリトライを続ける（無意味）

RSETの失敗 = 接続が壊れている。再接続できないなら即座に終了すべき。

**修正方針:**
- catchブロック内で、再接続に成功しなかった場合は常にエラーで終了
- 2つ目のif文の`attempt >= maxRetries`条件を削除し、
  再接続不可なら常にclose+fatalエラーとする

**影響範囲:** `src/mailer/worker-mailer.ts`の`handleSendFailure()`

---

## フェーズ3: P2修正 — mime.ts / calendar.ts

### #7 buildAltParts 7引数→オブジェクト引数 (P2)

**問題の本質:**
`buildAltParts(hasText, hasInline, textPart, htmlOrRelated, htmlPart, calPart, hasCal)`
は7個の引数を取り、制限値4個を大幅に超過。可読性が低い。

**修正方針:**
- `ContentBuildContext`型を定義し、`buildWithAttachAndCal`と`buildAltParts`で共有
- buildAltPartsはコンテキストオブジェクト1引数に変更
- これにより引数数は7→1に削減

### #14 buildWithAttachAndCal 30行超過 (P2)

**問題の本質:**
型定義込みで約49行。if-elseの分岐チェーンが長い。

**修正方針:**
- `ContentBuildContext`型をfunction外に抽出（約12行を型定義として分離）
- 関数本体は型参照のみとなり、22行程度に収まる

### #15 buildAltParts → 30行は超過していなかった（15行）

実測したところ15行で問題なし。レビューの誤検出。ただし#7の引数修正は実施。

### #34 calendarEvent負のreminderMinutes (中)

**問題の本質:**
`appendReminder()`で`TRIGGER:-PT${reminderMinutes}M`を生成するが、
負の値（例: -15）を渡すと`TRIGGER:-PT-15M`となりRFC 5545違反。

**修正方針:**
- `validateCalendarOptions()`に`reminderMinutes >= 0`のバリデーションを追加
- 負の値はCalendarValidationErrorをthrow
