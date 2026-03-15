# worker-mailer

## 2.0.0 (Unreleased)

### Breaking Changes

- **モジュラーアーキテクチャ**: `mailer.ts`（709行）と `email.ts`（473行）を13ファイルに分割。公開APIは完全後方互換だが、内部構造が大幅に変更。
- **ビルドツール移行**: pnpm → Bun + Biome（タブ、ダブルクォート、行幅100）。
- **中国語README削除**: `README_zh-CN.md` → `README_ja.md`（日本語版）に置換。

### Security Fixes (P0)

- `responseTimeoutMs` のコピペバグ修正（`socketTimeoutMs` が誤って使用されていた）。
- SMTP コマンドインジェクション防止（CRLF ガード）。
- ヘッダーインジェクション防止（CRLF バリデーション）。
- BCC ヘッダー漏洩修正（`resolveBCC()` を削除、BCC はエンベロープのみ）。
- `btoa()` UTF-8 エンコーディング失敗修正（`toBase64()` を新規作成）。

### RFC Compliance Fixes (P1)

- EHLO ドメインバリデーション。
- メールアドレスバリデーション強化（角括弧パターンガード）。
- MIME ファイル名エンコーディング修正。
- `encodeHeader()` 75文字制限準拠（UTF-8マルチバイト境界対応）。
- `foldHeaderLine()` 78文字制限準拠（既存折り返し認識）。
- CRAM-MD5 非推奨警告追加。

### Quality Improvements (P2)

- 指数バックオフリトライロジック。
- エラー伝播の改善（`onError` コールバック）。
- `close()` レースコンディション修正。
- 制御文字バリデーション。
- Base64 バリデーション。
- Content-Disposition ヘッダー修正。
- `BlockingQueue` の `close()`/`clear()`/`closed` getter 追加。
- Quoted-Printable 行幅オフバイワン修正。
- SMTP 認証情報のログマスキング。
- RFC 5322 準拠タイムスタンプ。
- エラーメッセージの統一化。

### New Features (DX Improvements)

- **`fromEnv()`**: 環境変数からゼロコンフィグ接続（カスタムプレフィックス対応）。
- **`createFromEnv()`**: 環境変数から直接 `WorkerMailer` インスタンス生成。
- **`sendOnce()`**: 接続→送信→切断をワンショットで実行。`SendResult` を返却。
- **プロバイダプリセット**: `gmailPreset()`, `outlookPreset()`, `sendgridPreset()`。
- **`SendResult` 型**: `messageId`, `accepted`, `rejected`, `responseTime`, `response`。
- **`validateEmail()`**: RFC準拠のメールアドレスバリデーション（日本語理由付き）。
- **`validateEmailBatch()`**: 一括バリデーション。
- **`EmailTemplate`**: HTMLメールテンプレート（`verification`, `passwordReset`, `notification`, `simple`）。テーブルベースレイアウト、インラインCSS、ダークモード対応、Outlook互換。
- **`html` テンプレートタグ**: `<heading>`, `<text>`, `<bold>`, `<button>`, `<divider>`, `<spacer>` タグ。XSS自動エスケープ。
- **`sendBatch()`**: バッチ送信（`concurrency` + `continueOnError` オプション）。
- **`WorkerMailerPool`**: コネクションプール（ラウンドロビン分散、`poolSize` 設定可能）。
- **`autoReconnect`**: 接続切断時の自動再接続。
- **`maxRetries`**: 送信リトライ回数制限（デフォルト3）。
- **`dsnOverride`**: メール単位での DSN 設定上書き。
- **`Symbol.asyncDispose`**: `await using` 対応。

### Architecture (Modular Refactoring)

- `src/email.ts` → `src/email/`（5ファイル: `types.ts`, `header.ts`, `mime.ts`, `email.ts`, `index.ts`）。
- `src/mailer.ts` → `src/mailer/`（8ファイル: `types.ts`, `transport.ts`, `handshake.ts`, `auth.ts`, `commands.ts`, `worker-mailer.ts`, `pool.ts`, `index.ts`）。
- `SmtpTransport` クラス: ソケットI/Oをカプセル化。不変パターン（再接続時は新インスタンス生成）。
- `parseCapabilities()` の蓄積バグ修正（STARTTLS 後の re-EHLO で認証タイプが重複していた問題）。
- 全ファイル200行以下。各ファイルの責務は単一。

### Infrastructure

- Bun + Biome 移行（pnpm + Prettier から）。
- CI/CD ワークフローを Bun 対応に書き換え。
- `prettier.config.js` 削除。
- `.npmignore` に `LICENSE` と `README_ja.md` 追加。
- `.changeset/config.json` の `access` を `public` に変更。
- `package.json` のリポジトリ URL をフォーク先に更新。
- 冗長な `.toString()` 削除（`transport.ts`）。

### Tests

- 354テスト全通過（Vitest 4.x + @cloudflare/vitest-pool-workers）。
- セキュリティテスト、RFC準拠テスト、DX機能テスト、バッチ送信テスト、テンプレートテストを追加。

---

## 1.2.1

### Patch Changes

- 18cd709: fix: implement SMTP dot-stuffing (rfc 5321)

## 1.2.0

### Minor Changes

- f3a7fb2: Implement quoted-printable encoding

## 1.1.5

### Patch Changes

- 02cc185: fix: Email headers override

## 1.1.4

### Patch Changes

- 159934d: fix: Mime boundary length too long.

## 1.1.3

### Patch Changes

- 55259f1: fix: Socket close timeout by ignoring promise result
- c385ba1: fix #23: some servers replied 550 MIME boundary length exceeded (see RFC 2046) to messages that were too long

## 1.1.2

### Patch Changes

- cb77d2b: fix: Socket close timeout by ignoring promise result
- 90d0631: fix #23: some servers replied 550 MIME boundary length exceeded (see RFC 2046) to messages that were too long

## 1.1.1

### Patch Changes

- e14a156: fix: Add missing space before NOTIFY=NEVER

## 1.1.0

### Minor Changes

- 15a2961: Add DSN & attachment features
- 15a2961: Add startTls options(default: true), upgrade to TLS if SMTP server supported.

## 1.0.1

### Patch Changes

- 248bb4a: Export LogLevel Enum while packaging
