# strands-kamada-hono

Cloudflare Workers + Hono から Amazon Bedrock AgentCore Runtimeを呼び出すAPIです。テキストと画像の入力、Better AuthとD1によるメールアドレス・パスワード認証を備えています。

次のAPIを提供します。

- `GET /api/health`
- `GET|POST /api/auth/*`（Better Auth）
- `POST /api/chat`（認証必須）
- `POST /api/chat/resume`（認証必須・承認待ちRuntimeの再開）
- `POST /api/agent/aircon/changes/apply`（AgentCore用・Bearer write token必須）
- `POST /internal/auth/migrate`（ローカル開発専用）
- `GET /`（ログイン・チャット画面）

## Setup

コマンド実行とAWS認証情報の設定は、このリポジトリを利用する開発者が行います。

```bash
npm install
cp .dev.vars.example .dev.vars
```

`.dev.vars` にローカル開発用のAWS認証情報、`AGENTCORE_RUNTIME_ARN`、`BETTER_AUTH_SECRET`、`AGENT_API_TOKEN_SECRET` を設定してください。ルートユーザーや共用の管理者認証情報は使用せず、対象Runtimeに対する `bedrock-agentcore:InvokeAgentRuntime`（`runtimeUserId` を渡す場合は `bedrock-agentcore:InvokeAgentRuntimeForUser` も）だけを許可したIAMプリンシパルを使用してください。

`BETTER_AUTH_SECRET` には十分に長いランダム値を使用します。

```bash
openssl rand -base64 32
```

`AGENT_API_TOKEN_SECRET` にも別のランダム値を生成し、Better Authとは
署名鍵を共有しないでください。本番ではそれぞれをWrangler secretとして
登録します。

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

downstream SSEイベントは `session`、`delta`、`metadata`、`image`、`confirmation_required`、`done` です。

~~~text
event: session
data: {"sessionId":"..."}

event: delta
data: {"text":"回答の一部"}

event: metadata
data: {"usage":{"inputTokens":1,"outputTokens":2,"totalTokens":3},"latencyMs":123}

event: image
data: {"mediaType":"image/png","data":"Base64エンコードした画像データ"}

event: confirmation_required
data: {"interruptId":"...","toolName":"apply_aircon_changes","summary":{"operations":[{"type":"create_company","name":"東京本社"}]}}

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

## Aircon write approval / resume contract

`apply_aircon_changes` が承認待ちになると、`POST /api/chat` は
`confirmation_required` SSEイベントを返します。画面はこのイベントの
`interruptId`、`toolName`、`summary` を表示し、「実行する / キャンセル」操作を
提示します。表示用summaryは実行payloadとして利用しません。

```json
{
  "sessionId": "sessionイベントで返された値",
  "interruptId": "confirmation_requiredイベントで返された値",
  "decision": "approve"
}
```

`decision` は `approve` または `reject` のみです。Browserからoperationsやtool
input、DB値は再送しません。resumeは必ず同じログインユーザーのRuntime identityを
サーバー側で再利用します。approve時のみread + write権限を含む60秒tokenを、reject
時はread-only tokenを新規発行します。Cookie、token、actor IDはクライアントから
受け取りません。resumeのレスポンスも通常のchatと同じSSE形式です。

`POST /api/agent/aircon/changes/apply` は、Runtimeの
`apply_aircon_changes` 専用のwrite APIです。Better Auth Cookieは受け付けず、
`aircon:write` scopeを持つBearer tokenだけを受け付けます。通常chatのread-only
tokenでは403になります。

リクエストはoperationsだけを受け付けます。対応するのはcreate/updateのみで、
`delete_*`、任意SQL、任意のテーブル名は受け付けません。

```json
{
  "operations": [
    { "type": "create_company", "name": "むらしま生産" },
    { "type": "create_property", "name": "東京本社", "company_ref": 0 }
  ]
}
```

対応operationは `create_company`、`create_property`、`create_system`、
`create_model`、`create_unit`、および各 `update_*` です。新規レコードのIDは
Worker側で生成します。`*_ref` は同一リクエスト内の先行するcreate operationを
参照するゼロ始まりの番号です。

すべてのoperationは検証後にD1のprepared statement + `batch()` で1トランザクション
として実行されます。1件でも失敗した場合は全体がrollbackされ、内部SQLや認証情報は
レスポンスへ返しません。成功時は、AgentCoreが最終回答に使える構造化結果を返します。

```bash
curl -N -b cookies.txt -X POST http://localhost:8787/api/chat/resume \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{"sessionId":"sessionイベントで返された値","interruptId":"confirmation_requiredイベントで返された値","decision":"approve"}'
```

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

AgentCore Runtimeには、接続先の `MyAgent/main.py` が定義する `prompt`、
サーバー側で決定した `actor_id`、ログインユーザーに紐づく
`user_access_token`、任意の `media` を含む
JSONペイロードを送信します。Better AuthのCookieそのものは送信しません。

```json
{
  "prompt": "この画像を説明してください",
  "actor_id": "認証済みユーザーID",
  "user_access_token": "ログインユーザーに紐づく短期token",
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
