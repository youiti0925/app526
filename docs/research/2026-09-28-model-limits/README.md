# AIモデルの能力と限界（2026-09-28 調査）

仕事ライン（/hustle/jobs）でどのモデルに何を任せるかを決めるための調査記録。
調査担当エージェント（Web検索・ページ取得あり、87回のツール使用、約12分）の報告を、そのまま保存したもの。
【公式】＝メーカーの一次情報、【第三者】＝第三者の測定、【推測】＝調査担当の推測。数値は出典を実際に開いて確認したものだけ。

> 注意: 第三者の数値（Artificial Analysis 等）は、グラフのページに埋め込まれたデータを読み取ったもので、
> 測定条件（思考量の設定など）で大きく変わる。傾向を見るためのもので、絶対値として使わない。

## 先に結論

- **事実（電話番号・URLなど）は、どのモデルにも記憶から答えさせてはいけない。**
  知識問題（Artificial Analysis）の「作り話率」＝正解できなかった問題のうち「分からない」と言わずに誤答した割合【第三者】:
  Haiku 4.5 約26〜27%、Opus 5.5 約59〜66%、Fable 5.1 約71〜73%。
  賢いモデルほど知識は多いが、知らないときにもっともらしく答える割合が高い。
  → 値は取得したページの原文から抜かせ、出典URLと引用をセットで保存する（仕事ラインの ai_lookup / ai_extract はこの設計）。
- **設定中の `gemini-3.5-flash-lite` は実在する安定版**【公式】。ただし無料枠では「Google検索による裏取り（grounding）」が使えない【公式】。
  無料枠に送った内容はGoogleの製品改善に使われ、人が読む可能性がある【公式】。
- **Claude Code の既定モデルは Pro・Max とも Opus 5.5**【公式】。`--model` を毎回指定しないと枠を早く使い切る
  （仕事ラインは毎回 `--model` を指定している）。Pro で `fable` を指定すると通常枠ではなく従量課金になる【公式】。
- **Haiku 4.5 は現行で最も古い世代**（知識は2025年2月まで）【公式】。引退日は「2026-10-15より前にはならない」とされ、
  告知は引退の60日以上前【公式】。→ 仕事ラインは `JOB_MODEL_LIGHT` などの環境変数でモデルを差し替えられるようにしてある。

## 1. モデル一覧

| モデル | 得意 | 苦手・できない | 上限（読める量／書ける量） | サブスクでの扱い | API換算（100万トークンあたり 入力／出力） |
|---|---|---|---|---|---|
| Haiku 4.5 | 最速・最安。大量処理、下請け役【公式】 | 知識問題の正答14〜18%・作り話率26〜27%（分からないと言うことが多い）【第三者】／長文中の情報探し（12.8万トークン）35.3%（Google測定）【第三者】／複数条件の指示を守る力（IFBench）42〜54%【第三者】／与えた資料の要約時の作り話率9.8%（英語）【第三者】／日本語の成績は英語の93.5%【公式】／思考量（effort）の調整不可【公式】 | 20万／6.4万。知識は2025年2月まで | 全有料プランで使える。枠の消費は最小【公式】 | $1／$5 |
| Sonnet 5 | 速さと賢さのバランス。データ分析・文章作成・画像理解【公式】 | 正答34〜40%、作り話率39〜73%（思考量の設定で大きく変わる）【第三者】／日本語専用テストの数値は見つからず | 100万／12.8万。知識は2026年1月まで | 全有料プランで使える | $2／$10【公式】 |
| Opus 5.5（9/22公開） | 長時間の自動作業・知識労働。公式は「迷ったらまずこれ」【公式】 | 思考を止められず遅く高くなりやすい【公式】／無害な作業でも安全装置の断りが起きうる【公式】／正答65〜66%、作り話率59〜66%【第三者】 | 100万／12.8万。知識は2026年6月まで | Pro以上。「OpusはSonnetの数倍の枠を1回ごとに消費」【公式】 | $4／$20 |
| Fable 5.1（9/1公開） | 最高性能。難しい推論、何時間も続く作業【公式】 | 最も遅く高い。安全装置の断りあり【公式】／正答66〜67%、作り話率71〜73%【第三者】 | 100万／12.8万。知識は2026年6月まで | Pro: 通常枠に含まれず従量課金のみ／Max 5x・20x: 週の上限の50%まで追加料金なし【公式】 | $10／$50 |
| Mythos 5.1 | Fable 5.1と同じ能力 | 招待制（Project Glasswing）のみ【公式】 | 同上 | 使えない | $10／$50 |
| Gemini 3.5 Flash-Lite（無料枠） | 大量の翻訳・単純なデータ処理【公式】。長文中の情報探し（12.8万）72.2%【公式】 | 無料枠ではGoogle検索の裏取り不可【公式】／100万トークン全部使うと情報探しは21.3%【公式】／正答29.5%、作り話率34%【第三者】 | 入力1,048,576／出力65,536 | 無料枠の回数上限は資料に数字なし（AI Studioの画面でのみ確認可）。1日の上限は太平洋時間0時（日本時間16〜17時）にリセット【公式】 | 無料（有料なら$0.30／$2.50） |

## 2. 作業ごとの目安

| 作業 | 目安 | 根拠 |
|---|---|---|
| 転記 | 軽いモデルで足りる。件数・合計はプログラムで照合 | 公式が「大量・単純作業は Haiku から」と推奨【公式】。数を数えるのは苦手【公式（画像内の物を数える）／推測（文字数・行数）】 |
| Web照合（電話番号・公式URL） | ページ取得はプログラムか検索ツール、突き合わせは軽いモデル、割れたら中くらい。最後は人の抜き取り確認 | 作り話率26〜73%【第三者】。Claude Code の WebFetch は小さなモデルがページを要約してから渡すため情報が落ちる設計【公式】。調査中も要約が2ページで3か所を取り違えた（例: Max 20x を$100と要約。正しくは$200） |
| 項目抽出 | 項目が少なく形が決まっていれば軽いモデル。条件が多い・長い表やページは中くらい | Haiku の指示遵守42〜54%、長文の情報探し35%【第三者】 |
| 分類（自由記述） | 多くは軽いモデル。区分が多い・定義があいまいなら中くらい | 【推測】人が数十件に正解を付け、一致率を測って決める |
| 文章の書き換え・校正 | 中くらい（Sonnet 5）が無難 | Haiku の日本語は英語の93.5%、旧 Sonnet 4.5 は96.8%【公式】。日本語テスト（Nejumi）上位は Opus 5 と Fable 5【第三者のまとめ】 |
| 仕様・形式の変換 | 形式が決まっていれば軽いモデル | .xlsx / .docx はAIが直接読めず変換が必要【公式】。変換はプログラムで【推測】 |
| 専門書類の下書き（SDS・リスクアセスメント） | 上位モデルで下書き＋専門家の確認が必須。AIだけで完成版は無理 | 作り話は減らせてもなくならない【公式】。化学・生物の話題で断ることがある【公式】 |
| 手順書づくり | 構成と文章は中くらい。現場固有の数値・安全上の注意は人が用意・確認 | 【推測】 |

## 3. 絶対にAIに任せてはいけないこと

- 電話番号・URL・住所・価格をAIの記憶や推測で埋めること（取れなかった行は空欄＋要確認。出典URLと引用が無い値は納品しない）
- SDSの危険有害性区分・法令該当・リスク評価の確定、法律・契約・税務の判断
- 件数・合計・文字数の最終確認（プログラムで数える）
- 依頼者の非公開情報・個人情報を Gemini 無料枠に送ること（規約に明記）【公式】
- 納品前の最終チェック（人の抜き取り検査）

## 4. 分からなかったこと・公開されていないこと

- サブスクの枠の具体量（5時間枠・週枠とも非公開。公式は「固定のメッセージ数はない」）
- モデルごとの枠の減り方の倍率（公式は「Opusは数倍」だけ）
- Gemini 無料枠の回数上限（RPM・RPD・TPM）は資料に記載なし
- Gemini の URL 読み込み機能が無料枠で使えるか
- 日本語専用テスト（Nejumi / JGLUE）の各モデルの点数
- Web検索の実力テスト（BrowseComp）の数値（公式はグラフのみ）
- 要約時の作り話率（Vectara）に Sonnet 5 / Opus 5.5 / Fable 5.1 / Gemini 3.5 Flash-Lite は未掲載
- 日本語の住所・氏名の正規化、スキャンPDFの文字読み取り精度、長い表での一貫性の信頼できる測定

→ 公開情報では分からない部分は、仕事ラインの「安いモデルで足りるか試す」（手本での一致率の実測）と、
  使用量の記録（/hustle/jobs の「AI使用量」）で、自分の仕事について実測していく。

## 5. 出典（すべて調査担当が実際に開いて確認）

Anthropic 公式:
- https://platform.claude.com/docs/en/about-claude/models/overview
- https://platform.claude.com/docs/en/about-claude/pricing
- https://platform.claude.com/docs/en/models/haiku-4-5/overview
- https://platform.claude.com/docs/en/models/sonnet-5/overview
- https://platform.claude.com/docs/en/models/opus-5-5/overview
- https://platform.claude.com/docs/en/models/fable-5-1/overview
- https://platform.claude.com/docs/en/about-claude/models/choosing-a-model
- https://platform.claude.com/docs/en/about-claude/model-deprecations
- https://platform.claude.com/docs/en/build-with-claude/multilingual-support
- https://platform.claude.com/docs/en/build-with-claude/vision
- https://platform.claude.com/docs/en/build-with-claude/pdf-support
- https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations
- https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
- https://www.anthropic.com/claude-opus-5-5
- https://www.anthropic.com/claude-fable-and-mythos-5-1
- https://www.anthropic.com/news/claude-haiku-4-5
- https://www.anthropic.com/news/claude-sonnet-5
- https://code.claude.com/docs/en/model-config
- https://code.claude.com/docs/en/tools-reference
- https://claude.com/pricing
- https://support.claude.com/en/articles/14552983-models-usage-and-limits-in-claude-code
- https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan
- https://support.claude.com/en/articles/11049741-what-is-the-max-plan
- https://support.claude.com/en/articles/8325606-what-is-the-pro-plan

Google 公式:
- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://ai.google.dev/gemini-api/terms
- https://ai.google.dev/gemini-api/docs/url-context
- https://deepmind.google/models/model-cards/gemini-3-5-flash-lite/

第三者:
- https://artificialanalysis.ai/evaluations/omniscience
- https://artificialanalysis.ai/models/claude-4-5-haiku
- https://artificialanalysis.ai/models/claude-sonnet-5
- https://artificialanalysis.ai/models/gemini-3-5-flash-lite
- https://github.com/vectara/hallucination-leaderboard/blob/main/README.md
- https://journal.qualiteg.com/llm-ranking-2026/ （Nejumi のまとめ。二次情報）
