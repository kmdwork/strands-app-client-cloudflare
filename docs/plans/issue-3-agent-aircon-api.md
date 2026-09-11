# Issue #3: AgentCore向け認証付きエアコン管理Read API

Issue: https://github.com/kmdwork/strands-app-client-cloudflare/issues/3

## Requirement Model

### Goal

Better Authでログイン済みのユーザーからAgentCore Runtimeへ、ユーザーIDとread scopeを持つ短期アクセストークンを委譲し、そのBearer tokenを検証したCloudflare APIだけがエアコン管理D1を取得・検索できるようにする。

### Current Behavior

- `POST /api/chat` は `requireSession` によりBetter Authセッションを必須とし、未ログイン時はAgentCoreを呼ばず401を返す。
- AgentCore呼び出しではBetter AuthのユーザーIDを `runtimeUserId` に設定しているが、Runtime payloadは `prompt` と任意の `media` のみで、委譲トークンは含まれない。
- ブラウザ向け `GET /api/aircon` はBetter Authセッションで保護され、5テーブルをD1から取得する。
- エアコン管理SQL、行型、上限値は `src/routes/aircon.ts` に直接置かれ、他のAPIから再利用できない。
- Agent専用Bearer認証、短期トークンの生成・検証、scope判定、`/api/agent/aircon/*` は存在しない。
- 現在のSecret設定にはAgent API専用署名鍵がなく、JWTライブラリも依存関係にない。
- テストはVitestを使用し、認証middlewareとAgentCore呼び出し、D1 prepared statementをモックする既存パターンがある。

### Required Behavior

- ログイン済みの `authSession.user.id` を `sub` とし、約3分で失効するAgent API専用JWTをCloudflare側で発行する。
- JWTは専用の `AGENT_API_TOKEN_SECRET` で署名し、Better AuthのCookieおよび `BETTER_AUTH_SECRET` と分離する。
- 初期実装で発行するtokenは `aud: "aircon-agent-api"` と `scope: ["aircon:read"]` を持つ。
- AgentCore Runtime payloadへ、既存の画像payloadを壊さず `user_access_token` キーでtokenを追加する。
- Agent向けAPIは `Authorization: Bearer <token>` のみを受け付け、Cookie認証との併用やフォールバックを行わない。
- Bearer tokenの署名、許可アルゴリズム、有効期限、audience、subject、scopeを検証し、検証済みclaimsをHono contextに保持する。
- AgentCoreからPOSTで会社、物件、設備系統、機器、型式を取得・検索し、親IDを使って階層を辿れるようにする。
- 複数テーブルをJOINする横断検索で、unitからmodel、system、property、companyまでの関係を返す。
- Browser APIとAgent APIは同じrepository層を利用し、SQLはprepared statementとbindを維持する。
- token、Authorization header、署名鍵、入力本文をログへ出さない。

### Constraints and Non-goals

- Better Authのsession CookieをAgentCoreへ渡さない。
- `/api/chat` のBetter Auth認証、SSEレスポンス、画像入出力、sessionId、`runtimeUserId` の既存契約を維持する。
- Browser API `/api/aircon` はBetter Auth Session認証を維持する。
- Agent向けAPIはIssue指定どおりPOSTに限定し、REST GETへ変更しない。
- 本Issueではcreate/update/delete APIを実装せず、D1 schemaやmigrationも変更しない。
- `aircon:write` はscope境界と拒否動作だけを定義し、実際の書き込みはユーザー確認・監査ログを含む将来Issueへ分離する。
- AgentCore側Pythonツールの実装はこのリポジトリの変更対象外とし、固定されたpayload/header契約をCloudflare側のテストと文書で保証する。
- 新しいテストフレームワークは導入しない。

### Assumptions

- token形式はIssue例に合わせてcompact JWTとし、Cloudflare Workers対応の `jose` を利用してHS256の署名・検証、claim検証、許可アルゴリズム固定を行う。
- `AGENT_API_TOKEN_SECRET` は十分に長いランダム値をWrangler secretとして設定し、ローカルでは `.dev.vars` から供給する。
- token TTLは180秒、audienceは `aircon-agent-api` とし、期限判定はJWT検証ライブラリへ委ねる。時計ずれ許容を追加する場合も短い固定値に限定する。
- 個別search endpointは空オブジェクトを「上限付き一覧」として扱う。横断検索 `/search` は意図しない全件走査を避けるため、少なくとも1つの対応フィルターを必須とする。
- 入力キーはIssueのAgentCore契約に合わせてsnake_case、Cloudflare内部の型と既存BrowserレスポンスはcamelCaseを維持する。
- 既存の1テーブル最大1,000件という境界をrepositoryへ移し、すべての検索結果に決定的なorderと上限を設ける。

### Questions

- 実装開始を妨げる未決事項なし。署名鍵はユーザー確認によりAgent API専用の新しいSecretを使用する。

## Plan

- [ ] Phase 1: ログインユーザーからAgentCoreへ短期read tokenを安全に委譲する
- [ ] Phase 2: 共通repositoryと階層別Agent Read APIを実装する
- [ ] Phase 3: 横断検索、文書化、統合検証を完成させる

## Phase 1: ログインユーザーからAgentCoreへ短期read tokenを安全に委譲する

### Scope

- Cloudflare Workers対応のJWT生成・検証ライブラリを依存関係へ追加し、署名方式と許可アルゴリズムを固定する。
- `AGENT_API_TOKEN_SECRET` をWranglerのrequired secret、生成Env型、`.dev.vars.example`、READMEの設定手順へ追加する。実値はリポジトリへ保存しない。
- `src/auth/agent-token.ts` に発行・検証処理を追加し、`sub`、`aud`、`scope`、`iat`、`exp` を型付きclaimsとして扱う。
- `src/auth/agent-middleware.ts` に厳密なBearer抽出、token検証、claimsのcontext格納、`requireAgentScope()` を追加する。
- `POST /api/chat` で既存セッション検証後にread-only tokenを生成し、AgentCore呼び出し入力へ渡す。
- `InvokeRuntimeInput` とRuntime payloadを拡張し、`userAccessToken` をJSONの `user_access_token` として送る。既存の `prompt`、`media`、`runtimeUserId`、stream処理は維持する。
- tokenの値を例外メッセージ、構造化ログ、テストスナップショットへ含めない。

### Acceptance Criteria

- [ ] 有効な専用Secretから、`sub` がBetter Auth user id、`aud` が `aircon-agent-api`、scopeが `aircon:read`、TTLが180秒のtokenを生成・検証できる。
- [ ] 署名不正、期限切れ、audience不一致、必須claim欠落、許可外アルゴリズムのtokenを401相当の認証失敗として拒否できる。
- [ ] `requireAgentScope("aircon:read")` はread tokenを許可し、`requireAgentScope("aircon:write")` は同じtokenを403で拒否する。
- [ ] Authorizationなし、Bearer形式不正、空token、複数資格情報に対する拒否動作がroute/middlewareテストで固定される。
- [ ] 未ログインの `POST /api/chat` は401を返し、token発行もAgentCore呼び出しも実行しない。
- [ ] ログイン済みの `POST /api/chat` は `authSession.user.id` と一致する `sub` のtokenを1つ生成する。
- [ ] AgentCoreへ送るJSONに `user_access_token` が常に含まれ、Python側の `payload.get("user_access_token")` で取得できる。
- [ ] 画像あり・なしの両方で既存 `prompt` / `media` payloadとストリーミング契約が維持される。
- [ ] `AGENT_API_TOKEN_SECRET` の実値、発行token、Authorization headerがログやリポジトリに現れない。
- [ ] `npm run types`、`npm run typecheck`、`npm test` が成功する。

## Phase 2: 共通repositoryと階層別Agent Read APIを実装する

### Scope

- `src/repositories/aircon.ts` にD1行型、結果上限、並び順、フィルター付きqueryを集約する。
- 既存Browser APIをrepository利用へ移し、レスポンス、最大件数、Better Auth Session認証を回帰させない。
- `src/routes/agent-aircon.ts` を追加し、以下のPOST endpointを提供する。
  - `/companies/search`: 任意の `query`
  - `/properties/search`: 任意の `query` と `company_id`
  - `/systems/search`: 任意の `query` と `property_id`
  - `/units/search`: 任意の `query` と `system_id`
  - `/models/search`: 任意の `query`
- 各入力をJSON形式、本文サイズ、型、文字数、許可キーについて検証し、未知キーや不正値を400で拒否する。
- 全endpointにAgent Bearer認証と `aircon:read` scopeを要求し、`src/index.ts` の `/api/agent/aircon` 配下へ登録する。
- IDと検索語は必ずprepared statementへbindし、SQL文字列へ連結しない。
- JOINを使うunits取得では任意のairconModelを安全に扱い、既存のmodel情報を維持する。

### Acceptance Criteria

- [ ] `/api/agent/aircon/*` は有効なBearer tokenなしではD1へ到達せず401を返す。
- [ ] read scopeがない有効tokenは403となり、D1へ到達しない。
- [ ] Agent endpointはPOSTのみで利用でき、Cookieだけでは認証されない。
- [ ] companiesを一覧取得および名前検索できる。
- [ ] `company_id` でpropertiesを絞り込み、`property_id` でsystemsを絞り込み、`system_id` でunitsを絞り込める。
- [ ] unitsの結果にLEFT JOINされたmanufacturer/modelNumberが含まれ、model未設定のunitも失われない。
- [ ] modelsを一覧取得し、manufacturerまたはmodelNumberで検索できる。
- [ ] 空の結果は200と空配列を返し、不正JSON、未対応キー、上限超過文字列、不正なID型は400を返す。
- [ ] SQL injection文字列を入力してもSQL構造が変わらず、prepared statementのbind値として扱われることをテストで確認できる。
- [ ] 検証済みtokenの `sub` をHono contextから取得でき、元のBetter Auth user idとして後続処理へ引き渡せる。
- [ ] Browser API `/api/aircon` の認証、レスポンス構造、取得内容が既存テストで維持される。
- [ ] `npm run typecheck` と `npm test` が成功する。

## Phase 3: 横断検索、文書化、統合検証を完成させる

### Scope

- `POST /api/agent/aircon/search` を追加し、`company_name`、`property_name`、`model_number` などの許可済みフィルターを組み合わせてunitを検索する。
- repositoryのJOINで `unit -> airconModel` と `unit -> system -> property -> company` を一度に辿り、Issue記載のネストしたレスポンスへ正規化する。
- 少なくとも1フィルターを必須とし、結果上限、決定的な並び順、空結果、nullable modelを明示する。
- READMEへSecret生成・登録、AgentCore payload、Bearer呼び出し、各POST endpoint、エラー境界、ローカル確認例を追加する。
- 固定されたPython呼び出し形式とCloudflare側契約を照合する統合寄りテストを追加する。
- 実環境ではログイン済みチャットから発行したtokenでAgentCore toolがCloudflare APIを呼べることを、token値を表示せずに確認する。

### Acceptance Criteria

- [ ] 横断検索は対応フィルターを単独または組み合わせて利用でき、フィルターなしは400を返す。
- [ ] 結果の各unitにmodel、system、property、companyの識別子と表示名が正しい親子関係で含まれる。
- [ ] model未設定unitの扱いがレスポンス契約とテストで明示され、LEFT JOINにより意図せず除外されない。
- [ ] 複数フィルターはAND条件となり、空結果は200と `{"units":[]}` を返す。
- [ ] 横断検索もすべての外部入力をbindし、SQL injection入力でクエリ構造が変わらない。
- [ ] READMEだけで `AGENT_API_TOKEN_SECRET` の生成・ローカル設定・Wrangler secret登録と、AgentCoreの `user_access_token` / Authorization契約を確認できる。
- [ ] Browser session CookieとAgent Bearer tokenの認証境界、401と403の違い、write APIが未実装であることが文書化される。
- [ ] token期限切れ、audience不一致、scope不足を含む主要な失敗経路でtokenやAuthorization headerがログへ出ない。
- [ ] モックされたチャット→Runtime payload→Agent API→D1の経路で、同一user idの委譲とread scopeが検証される。
- [ ] 接続可能な環境では、固定されたAgentCore Pythonインターフェースからread APIを呼び出す手動確認手順が成功する。
- [ ] `npm run types`、`npm run typecheck`、`npm test`、`npm run deploy:dry` が成功する。

## Dependencies

- Better Authが提供する既存の認証済み `authSession.user.id`。
- 専用Wrangler secret `AGENT_API_TOKEN_SECRET`。
- Cloudflare Workersで動作する `jose` の `SignJWT` / `jwtVerify`。
- AgentCore Runtimeが `payload.get("user_access_token")` でtokenを受け取り、HTTP POSTのAuthorization BearerとしてCloudflareへ転送する固定インターフェース。
- D1の `companies`、`properties`、`systems`、`units`、`airconModels` と既存外部キー。
- 既存のVitest、Wrangler型生成、typecheck、dry-runコマンド。

## Expected Change Boundary

- `src/auth/agent-token.ts`（新規）
- `src/auth/agent-middleware.ts`（新規）
- `src/auth/types.ts`
- `src/agentcore/types.ts`
- `src/agentcore/invoke-runtime.ts`
- `src/routes/chat.ts`
- `src/routes/agent-aircon.ts`（新規）
- `src/routes/aircon.ts`
- `src/repositories/aircon.ts`（新規）
- `src/index.ts`
- `.dev.vars.example`
- `wrangler.jsonc`
- `worker-configuration.d.ts`（Wrangler生成）
- `package.json` / `package-lock.json`（JWT依存関係）
- 関連する既存・新規Vitest
- `README.md`

D1 migration、ブラウザUI、AgentCore側Pythonソースは変更しない。

## Risks

- symmetric signing keyが漏洩すると有効期限内のtokenを偽造できる。Better Authとは鍵を分離し、十分な長さの専用Secret、短いTTL、許可アルゴリズム固定、ログ抑制で影響を限定する。
- AgentCoreはtokenを一時的に保持するため、Runtimeログ・toolログ・例外へpayloadやAuthorizationを出さないことがCloudflare外でも必要である。
- 180秒のTTLは長時間のAgent処理中に失効する可能性がある。初期実装では再発行やrefresh tokenを導入せず、必要ならユーザーの新しいチャット要求で再試行する。
- HS256はCloudflareとAgent APIが同じ署名鍵を共有する。将来、発行者と検証者を別サービスへ分離する場合は非対称鍵への移行を別Issueで検討する。
- LIKE検索の `%` と `_` はワイルドカードとして働く。文字どおり検索するかはrepositoryテストで仕様を固定し、意図しない全件検索を避ける。
- 1,000件上限は既存Browser APIとの互換性を優先する暫定値であり、データ増加時はcursor paginationが必要になる。
- D1にはテナント所有権列がないため、tokenの `sub` を検証してもユーザー単位の行アクセス制御はできない。本Issueは「ログインユーザーから委譲された呼び出し」の保証までとし、ユーザー別・会社別認可は別途データモデルと要件が必要である。
- AgentCore側Pythonは別リポジトリにあるため、このリポジトリの自動テストだけでは実RuntimeからのHTTP到達性、時計ずれ、Secret設定を完全には保証できない。手動統合確認をリリース条件に含める。
- `aircon:write` middlewareは境界を先に定義するが、ユーザー確認、監査ログ、競合制御が未設計のため書き込みendpointは公開しない。
