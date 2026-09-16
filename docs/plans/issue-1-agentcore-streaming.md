# Issue #1: AgentCore回答のエンドツーエンド・ストリーミング

Issue: https://github.com/kmdwork/strands-app-client-cloudflare/issues/1

## Requirement Model

### Goal

AgentCore Runtimeから届く回答のテキストdeltaをCloudflare Worker経由で逐次ブラウザへ中継し、回答全文の完成を待たずに同じAssistantメッセージへリアルタイム表示する。

### Current Behavior

- `src/agentcore/invoke-runtime.ts` はAWS SDKの `response.response.transformToString()` で上流レスポンス全体をバッファし、完成済みの `InvokeRuntimeResult` を返している。
- SSE解析も完成済み文字列を改行で分割するため、AWS SDKのchunk境界をまたぐイベントを扱えない。
- `src/routes/chat.ts` は `invokeRuntime()` の完了後にJSONを返している。
- `public/app.js` は共通 `requestJson()` の `response.text()` でレスポンス全体を読み、完了後にAssistantメッセージを追加している。
- Runtimeのテキスト、usage、latency、および画像を完成後レスポンスとして正規化する処理は存在する。
- 認証、入力検証、画像入力、セッションID再利用は既存機能として維持対象である。

### Required Behavior

- `POST /api/chat` のリクエスト方式と認証境界を維持し、成功レスポンスを `text/event-stream` に変更する。
- WorkerはAgentCore固有イベントを直接公開せず、`session`、`delta`、`metadata`、`image`、`done`、`error` のdownstream SSEへ正規化する。
- AWS SDKのStreamingBlobを増分消費し、SSEイベントが複数chunkに分割された場合や、1chunkに複数イベントが含まれる場合も正しく処理する。
- ブラウザは `fetch()` と `ReadableStream` でSSEを増分処理し、同一Assistantメッセージを更新する。
- セッションID、usage、latency、画像レスポンスを維持する。
- ブラウザ切断時と上流エラー時に、可能な限り上流処理を中断し、AWSクライアントを確実に破棄する。
- ストリーム開始前の認証・入力検証エラーは従来の4xx JSONを維持する。

### Constraints and Non-goals

- `POST /api/chat` は維持し、EventSourceへ変更しない。
- AgentCore Runtime側のPython実装やイベント形式は変更しない。
- Better Auth、D1、画像入力形式、セッション所有権モデルは変更しない。
- Markdown風表示の構文やデザイン全体の刷新は行わない。
- Rate Limit、Durable Object、新規認証機能は対象外とする。
- 新しいテストフレームワークは導入せず、既存のVitestとリポジトリの検証コマンドを使用する。

### Assumptions

- 接続先Runtimeは通常応答として `text/event-stream` を返し、現在対応済みのStrands `contentBlockDelta.delta.text` とmetadataイベントを送る。
- 画像出力は既存の `RuntimeImage` へ正規化できるイベントとして扱い、既存UIのdata URL表示契約を維持する。
- Hono 4の `streamSSE`、`writeSSE`、`onAbort` を利用できる。

### Questions

- 実装開始を妨げる未決事項なし。想定外のRuntime `contentType` を受けた場合は、暗黙に全文バッファへフォールバックせず明示的なエラーとして扱う。

## Plan

- [ ] Phase 1: AgentCoreストリームを増分解析し、正規化イベントとして公開する
- [ ] Phase 2: `POST /api/chat` から正規化SSEを安全に中継する
- [ ] Phase 3: ブラウザの逐次描画と利用者向け仕様を完成させる

## Phase 1: AgentCoreストリームを増分解析する

### Scope

- 完成済み `InvokeRuntimeResult` を返す通常経路を、`RuntimeStreamEvent` の `AsyncIterable` 相当へ置き換える。
- `delta`、`metadata`、`image`、`done` を型で表現する。
- AWS SDK呼び出しの `accept` を `text/event-stream` とし、実際のレスポンスcontent typeとHTTPステータスを検証する。
- `TextDecoder` のstreaming decodeと未処理文字列バッファを用意し、空行で区切られるSSEイベントをchunk境界に依存せず復元する。
- コメント行、複数data行、CRLF、末尾の未完了バッファ、`[DONE]`、不正JSONに対する振る舞いを明示する。
- 正常完了、例外、キャンセルの全経路で上流readerとAWSクライアントをcleanupする。AWS SDKの `send(..., { abortSignal })` を切断伝播に利用する。

### Acceptance Criteria

- [ ] 通常経路で `transformToString()` を使用しない。
- [ ] 1イベント/1chunk、分割イベント、複数イベント/1chunkの全ケースでdelta順序が維持される。
- [ ] Strandsの `contentBlockDelta.delta.text` が逐次 `delta` に変換される。
- [ ] usageとlatencyが `metadata` に変換される。
- [ ] 既存の画像レスポンス契約が `image` イベントとして表現される。
- [ ] `[DONE]` と正常なストリーム終端から `done` が重複せず生成される。
- [ ] 不正イベントの扱いがテストで固定され、無関係な後続イベントを不必要に失わない。
- [ ] 中断・失敗を含めてreader解放と `client.destroy()` が確認できる。
- [ ] `test/runtime-response.test.ts` が増分入力を中心としたテストへ移行する。
- [ ] `npm run typecheck` と `npm test` が成功する。

## Phase 2: Honoからdownstream SSEを中継する

### Scope

- 認証、Content-Type、本文サイズ、スキーマ検証をストリーム開始前に完了する。
- 検証通過後はHonoの `streamSSE` で `session -> delta* -> image* / metadata? -> done` を中継する。
- `Content-Type: text/event-stream`、`Cache-Control: no-cache`、Cloudflareでのストリーミングを安定させる `Content-Encoding: Identity` を設定する。
- `stream.onAbort()` からAbortControllerへ切断を伝播する。
- 開始前エラーは既存JSONステータスを維持し、開始後エラーは安全な固定メッセージの `error` イベントを返して終了する。ログには秘密値や入力本文を含めない。
- route testを既存Vitest構成で追加可能な範囲に限定して追加する。

### Acceptance Criteria

- [ ] 認証失敗、JSON以外、本文超過、入力不正はストリーム開始前に従来どおり適切な4xx JSONを返す。
- [ ] 正常な `POST /api/chat` は `text/event-stream` とno-cache/Identityヘッダーを返す。
- [ ] 最初のdeltaは上流完了を待たずにdownstreamへ書き込まれる。
- [ ] 最初のイベントでsessionIdを返し、既存sessionIdも保持する。
- [ ] 正常系のイベント順序が `session -> delta* -> image* / metadata? -> done` として検証される。
- [ ] ストリーム開始後の失敗は `error` イベントとなり、HTTPレスポンスの再書き換えを試みない。
- [ ] ブラウザ切断が上流AbortSignalへ伝播する。
- [ ] `npm run typecheck` と `npm test` が成功する。

## Phase 3: ブラウザで逐次描画し、仕様を文書化する

### Scope

- `/api/chat` 専用の `streamChat()` を追加し、共通 `requestJson()` は認証API等のJSON用途に限定する。
- ブラウザ側にもchunk境界に依存しないSSE parserを設け、`session`、`delta`、`metadata`、`image`、`done`、`error` を処理する。
- 送信直後にAssistantメッセージの器を作り、最初のdeltaでtyping indicatorを外して同一メッセージ本文を更新する。
- 受信途中のテキストを保持し、既存Markdown風レンダリングを対象メッセージ内だけ再描画する。
- 途中エラーでは受信済み内容を残し、認証切れと一般エラーを既存UXに沿って表示する。
- READMEの制限事項とcurl例をSSE仕様へ更新する。

### Acceptance Criteria

- [ ] `/api/chat` に `response.text()` や `requestJson()` を使用しない。
- [ ] chunk境界に依存せず全SSEイベントを順番に処理する。
- [ ] 最初のdelta受信時点で回答が表示され、以後同じAssistantメッセージが更新される。
- [ ] sessionIdが次回リクエストへ再利用される。
- [ ] metadataを失わず受信でき、画像は既存Assistantメッセージへ追加される。
- [ ] ストリーム途中のエラーでも受信済みテキストが残る。
- [ ] 完了・失敗・認証切れの各経路で送信中状態が解除される。
- [ ] READMEに `curl -N` と `Accept: text/event-stream` を使う確認例、downstreamイベント契約、既知の制約が記載される。
- [ ] `node --check public/app.js`、`npm run typecheck`、`npm test` が成功する。
- [ ] 実ブラウザまたはcurlで、最初のdeltaが回答完了前に到着することを確認する。

## Dependencies

- Hono 4のstreaming helper（`streamSSE`、`writeSSE`、`onAbort`）。
- AWS SDK v3 `InvokeAgentRuntimeCommand` のStreamingBlobとAbortSignal対応。
- 接続先AgentCore Runtimeが返すStrands SSEイベント契約。
- 既存のBetter AuthセッションとRuntime ARN/AWS secret設定。

## Expected Change Boundary

- `src/agentcore/invoke-runtime.ts`
- `src/agentcore/types.ts`
- `src/routes/chat.ts`
- `public/app.js`
- `test/runtime-response.test.ts`
- 必要な場合のみ、新規route/browser parserテスト
- `README.md`

`package.json`、D1 migration、認証実装、Wrangler bindingsは、実装中に既存機能上の必須理由が判明しない限り変更しない。

## Risks

- SSEフレームとAWS SDK chunkの境界は一致しない。parserは未処理バッファを保持し、flush時の末尾も検証する。
- Honoのstream callback開始後は通常の `app.onError` でHTTPエラーへ置換できない。開始後の失敗は必ずSSE `error` として扱う。
- `stream.onAbort()` とAWS SDKのAbortSignalだけでは、すでに配信済みの全上流リソースを即時停止できない可能性がある。reader cancelと `client.destroy()` を併用し、冪等cleanupにする。
- deltaごとのMarkdown再描画は長文でDOM更新コストが増える。最初は対象メッセージのみ更新し、性能問題が確認された場合に限定してバッチ化する。
- Base64画像はSSEイベントを大きくする。既存上限とMIME検証を維持し、画像保存方式やバイナリ転送への変更は本Issueに含めない。
- AgentCoreが想定外content typeを返す場合の互換性より、ストリーミング契約の明示性を優先してエラー化する。
