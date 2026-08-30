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

手順（Renderの例）:
1. Renderで「Web Service」を作り、このGitHubリポジトリを接続（Runtime: Docker）
2. 「Disk」を追加してマウント先を `/data` に（1GBで十分）
3. 上の環境変数を設定してデプロイ
4. 開くとブラウザが合言葉を聞いてくる。ユーザー名は何でもよく、パスワードに `APP_PASSWORD` の値

デーモンは同じコンテナ内で一緒に起動し、`APP_PASSWORD` があれば自分で認証して巡回します。

### C. VPS（さくら/ConoHa等、月600円前後）

Dockerが動くならBと同じ。`docker build -t app526 . && docker run -d -p 3000:3000 -v /srv/app526:/data -e APP_PASSWORD=... app526`

## やってはいけないこと

- `APP_PASSWORD` なしで公開URLに置く（キー流出・データ改ざん・AI枠の横取り）
- Vercel/Netlifyのサーバーレスに載せる（データが消える）
- `APP_DATA_DIR` を永続ディスク以外に向ける（再デプロイでDBが消える）

## バックアップ

データは `APP_DATA_DIR` の `videosop.db` 1ファイル。これをコピーすれば全部残ります。
