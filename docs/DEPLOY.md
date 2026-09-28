# 公開デプロイの考え方と手順

## 先に結論

- このアプリは **SQLite（ファイルDB）への書き込み** と **常駐クロール** があるので、
  Vercelのようなサーバーレスには載せられません（リクエストごとに書いたものが消える）。
- 載せる先は「**常時起動していて、ディスクが残るNodeの置き場所**」です。
- どこに置くにしても、公開URLに出すなら **環境変数 `APP_PASSWORD` の設定が必須** です。
  未設定のまま公開すると、APIキー・案件データ・収支が誰でも読み書きできます。

## 選択肢（上から推奨順）

### A. 自分のPCで動かす（無料・一番簡単）

公開の必要がなければこれで足ります。承認はアーティファクト/チャット経由でもできるので、
PCが点いている時間だけ回れば実用上は困りません。

```bash
npm install
npm run build
npm run start          # 画面: http://localhost:3000
npm run agent          # 別ターミナルで常駐（30分おきに巡回）
```

- ローカルだけなら `APP_PASSWORD` は不要。
- PCを閉じると止まる。それが困るならBへ。

### B. Render / Railway / Fly.io など（月500〜1,000円前後・常時起動）

リポジトリ直下の `Dockerfile` がそのまま使えます。共通の設定:

| 環境変数 | 値 | 必須 |
|---|---|---|
| `APP_PASSWORD` | 長めの合言葉 | **必須**（公開URLに出すなら） |
| `APP_DATA_DIR` | `/data`（永続ディスクのマウント先） | **必須** |
| `GEMINI_API_KEY` | AIを使うなら | 任意 |
| `AGENT_INTERVAL_MIN` | 巡回間隔（既定30分） | 任意 |
| `CLAUDE_CODE_OAUTH_TOKEN` | 仕事ラインでClaudeをサブスクで使うなら（下の「Claudeの接続」） | 任意 |
| `JOB_TICK_MIN` | 仕事ラインの見回り間隔（既定5分） | 任意 |

手順（Renderの例）:
1. Renderで「Web Service」を作り、このGitHubリポジトリを接続（Runtime: Docker）
2. 「Disk」を追加してマウント先を `/data` に（1GBで十分）
3. 上の環境変数を設定してデプロイ
4. 開くとブラウザが合言葉を聞いてくる。ユーザー名は何でもよく、パスワードに `APP_PASSWORD` の値

デーモンは同じコンテナ内で一緒に起動し、`APP_PASSWORD` があれば自分で認証して巡回します。

### C. VPS（さくら/ConoHa等、月600円前後）

Dockerが動くならBと同じ。`docker build -t app526 . && docker run -d -p 3000:3000 -v /srv/app526:/data -e APP_PASSWORD=... app526`

## Claudeの接続（仕事ライン）

仕事ライン（/hustle/jobs）は Claude Code の CLI をサブスクのログインで呼びます。APIキーは要りません。

- **自分のPC（A）**: `npm install -g @anthropic-ai/claude-code` → 一度 `claude` を起動して /login。これだけ。
- **Render等（B・C）**: 画面でログインできないので、手元のPCで `claude setup-token` を実行し、
  表示された値を環境変数 `CLAUDE_CODE_OAUTH_TOKEN` に設定する。Dockerfile は CLI を入れてある。
- 画面上部に「Claude: サブスクで接続済み」と出れば接続できている（`claude auth status` の結果。使用量は消費しない）。
- `ANTHROPIC_API_KEY` は仕事ラインの子プロセスには渡さない（入っていると気づかず従量課金になるため）。
  APIキーで動かしたいときだけ `JOB_CLAUDE_USE_API_KEY=1`。
- 使うモデルは `JOB_MODEL_LIGHT`（既定 haiku）/ `JOB_MODEL_STANDARD`（sonnet）/ `JOB_MODEL_HEAVY`（opus）で差し替えられる。
  Haiku 4.5 は2026-10-15以降に引退があり得る（docs/research/2026-09-28-model-limits）。
- サブスクの利用枠は claude.ai と共有。上限に当たった依頼は止まり、`JOB_QUOTA_RETRY_MIN`（既定60分）後に続きから再開する。

## やってはいけないこと

- `APP_PASSWORD` なしで公開URLに置く（キー流出・データ改ざん・AI枠の横取り）
- Vercel/Netlifyのサーバーレスに載せる（データが消える）
- `APP_DATA_DIR` を永続ディスク以外に向ける（再デプロイでDBが消える）

## バックアップ

データは `APP_DATA_DIR` の `videosop.db` 1ファイル。これをコピーすれば全部残ります。
