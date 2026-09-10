# strands-kamada-hono

Cloudflare Workers + Hono から Amazon Bedrock AgentCore Runtimeを呼び出すAPIです。テキストと画像の入力、Better AuthとD1によるメールアドレス・パスワード認証を備えています。

次のAPIを提供します。

- `GET /api/health`
- `GET|POST /api/auth/*`（Better Auth）
- `POST /api/chat`（認証必須）
- `POST /internal/auth/migrate`（ローカル開発専用）
- `GET /`（ログイン・チャット画面）

## Setup

コマンド実行とAWS認証情報の設定は、このリポジトリを利用する開発者が行います。

```bash
npm install
cp .dev.vars.example .dev.vars
```

`.dev.vars` にローカル開発用のAWS認証情報、`AGENTCORE_RUNTIME_ARN`、`BETTER_AUTH_SECRET` を設定してください。ルートユーザーや共用の管理者認証情報は使用せず、対象Runtimeに対する `bedrock-agentcore:InvokeAgentRuntime`（`runtimeUserId` を渡す場合は `bedrock-agentcore:InvokeAgentRuntimeForUser` も）だけを許可したIAMプリンシパルを使用してください。

`BETTER_AUTH_SECRET` には十分に長いランダム値を使用します。

```bash
openssl rand -base64 32
```

現在の最小実装はアクセスキーIDとシークレットアクセスキーの組み合わせを対象にしています。一時認証情報の `AWS_SESSION_TOKEN` 対応は、接続確認後の認証強化時に追加します。

設定後、Worker bindingsの型を生成します。

```bash
npm run types
npm run typecheck
npm test
npm run dev
```

## Local check

以下の操作は、別のターミナルで `npm run dev` が動いている状態で行います。

```bash
curl http://localhost:8787/api/health
```

最初にBetter AuthのテーブルをローカルD1へ作成します。このAPIは開発環境かつループバックホストでのみ利用できます。

```bash
curl -X POST http://localhost:8787/internal/auth/migrate
```

新規ユーザー登録は無効です。すでにD1へ登録したユーザーでログインする場合：

```bash
curl -i -c cookies.txt -X POST http://localhost:8787/api/auth/sign-in/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"change-this-password"}'
```

保存したCookieを使って、新しいAgentCoreセッションを開始します。

```bash
curl -N -b cookies.txt -X POST http://localhost:8787/api/chat \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{"message":"Knowledge Baseを検索して、営業時間について教えてください"}'
```

`POST /api/chat` の成功レスポンスはSSE（`text/event-stream`）です。ブラウザは
`fetch()` と `ReadableStream` で増分処理し、回答全文の完成を待たずに同じ
Assistantメッセージを更新します。`session` イベントの `sessionId` を次の
リクエストでも指定すると、同じAgentCoreセッションを継続できます。

downstream SSEイベントは `session`、`delta`、`metadata`、`image`、`done` です。

~~~text
event: session
data: {"sessionId":"..."}

event: delta
data: {"text":"回答の一部"}

event: metadata
data: {"usage":{"inputTokens":1,"outputTokens":2,"totalTokens":3},"latencyMs":123}

event: image
data: {"mediaType":"image/png","data":"Base64エンコードした画像データ"}

event: done
data: {}
~~~

ストリーム開始後の失敗は、可能な範囲で `error` イベントとして返します。
認証・Content-Type・本文サイズ・入力形式のエラーは、ストリーム開始前の
HTTP 4xx JSONレスポンスです。

```bash
curl -N -b cookies.txt -X POST http://localhost:8787/api/chat \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{"message":"もう少し詳しく教えてください","sessionId":"前回返されたsessionId"}'
```

AgentCoreにはBetter AuthのユーザーIDを `runtimeUserId` として渡します。これにより、AgentCoreのメモリを認証ユーザー単位で分離できます。

画像を添付する場合、`POST /api/chat` に次のJSONを送ります。接続先Runtimeに合わせてJPEG、PNG、WebPを受け付け、上限は2 MiBです。

```json
{
  "message": "この画像を説明してください",
  "image": {
    "mediaType": "image/png",
    "data": "Base64エンコードした画像データ"
  }
}
```

AgentCore Runtimeには、接続先の `MyAgent/main.py` が定義する `prompt` と `media` を含むJSONペイロードを送信します。

```json
{
  "prompt": "この画像を説明してください",
  "media": {
    "type": "image",
    "format": "png",
    "data": "Base64エンコードした画像データ"
  }
}
```

Runtimeは `text/event-stream` でStrandsイベントを返します。
`contentBlockDelta.delta.text` はブラウザ向けの `delta` イベントへ変換され、
usage・latencyと画像もそれぞれ `metadata`・`image` イベントとして中継されます。
画像を返す場合は、イベントデータに次の形式を使用できます。

```json
{
  "message": "画像を生成しました",
  "images": [
    { "data": "Base64エンコードした画像データ", "mediaType": "image/png" }
  ]
}
```

ブラウザでは次のURLを開き、同じ登録済みユーザーでログインします。

```text
http://localhost:8787/
```

## Current limitations

- Rate LimitとDurable Objectによるセッション所有権管理は未実装です。
- Base64画像はSSEイベントとして送るため、テキストだけのイベントよりサイズが大きくなります。
- `sessionId` は一時的にクライアントへ公開しています。
- 新規ユーザー登録、メールアドレスによる本人確認、パスワードリセットは無効です。

公開前に `BETTER_AUTH_URL` を本番URLへ変更してください。現在は `emailAndPassword.disableSignUp` を有効にしており、D1に登録済みのユーザーだけがログインできます。

本番D1のマイグレーションはローカル専用APIでは実行できません。本番デプロイへ進む段階で、バージョン管理されたD1マイグレーションを作成して適用します。
