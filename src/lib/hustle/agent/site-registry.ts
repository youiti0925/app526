/**
 * 案件が載っているサイトの候補一覧。
 *
 * ここは「取りに行く先」ではなく「調べる先」。
 * 登録してあるだけでは何も起きない。probe.ts が robots.txt を読んで
 * 取得していいかを判定し、通ったものだけがコネクタの候補になる。
 *
 * この形にした理由:
 * 私が手で1サイトずつ調べてコネクタを書いていくと、私が調べた数しか増えない。
 * サイトを1行足せばアプリが自分で可否を判定できる形にしておけば、
 * あなたが見つけたサイトもその場で足せる。
 */

export type SiteCategory =
  | "crowdsourcing" // クラウドソーシング
  | "agent" // フリーランスエージェント
  | "matching" // 業務委託・副業マッチング
  | "skill_market" // スキル出品
  | "public" // 官公需・公共調達
  | "writing" // ライティング・翻訳
  | "job_board"; // 求人

export const CATEGORY_LABELS: Record<SiteCategory, string> = {
  crowdsourcing: "クラウドソーシング",
  agent: "フリーランスエージェント",
  matching: "業務委託・副業マッチング",
  skill_market: "スキル出品",
  public: "官公需・公共調達",
  writing: "ライティング・翻訳",
  job_board: "求人",
};

export interface SiteCandidate {
  id: string;
  name: string;
  /** robots.txt を読む起点 */
  origin: string;
  category: SiteCategory;
  /** 案件ページのURLの形。分かっていれば入れる。 */
  detailPattern?: string;
  /** 公開APIがあれば。robots.txt より優先する。 */
  apiUrl?: string;
  /** 分かっている注意点 */
  note?: string;
}

export const SITE_CANDIDATES: SiteCandidate[] = [
  // --- クラウドソーシング ---
  { id: "crowdworks", name: "クラウドワークス", origin: "https://crowdworks.jp", category: "crowdsourcing", detailPattern: "/public/jobs/\\d+" },
  { id: "lancers", name: "ランサーズ", origin: "https://www.lancers.jp", category: "crowdsourcing", detailPattern: "/work/detail/\\d+" },
  { id: "shufti", name: "シュフティ", origin: "https://app.shufti.jp", category: "crowdsourcing", note: "【2026-08-24】完全SPA化で公開入口ゼロ（全ルートが空シェル1,434バイト）。規約に商用2次利用禁止。使えない。" },
  { id: "craudia", name: "クラウディア", origin: "https://www.craudia.com", category: "crowdsourcing", note: "【2026-08-24】robots実質全許可・参加申請数公開だが、募集中は10件前後しかない（7,289件はほぼアーカイブ）。規約に商用2次利用禁止条項。低頻度の手動確認のみ。" },

  // --- スキル出品 ---
  { id: "coconala", name: "ココナラ 公開依頼", origin: "https://coconala.com", category: "skill_market", detailPattern: "/requests/\\d+" },
  { id: "skima", name: "SKIMA", origin: "https://skima.jp", category: "skill_market" },
  { id: "timeticket", name: "タイムチケット", origin: "https://www.timeticket.jp", category: "skill_market", note: "【2026-08-24】全リクエスト403（WAF）。robots.txtすら取れない。そもそも出品型で案件掲載型ではない。" },
  { id: "streetacademy", name: "ストアカ", origin: "https://www.street-academy.com", category: "skill_market" },

  // --- フリーランスエージェント ---
  { id: "levtech", name: "レバテックフリーランス", origin: "https://freelance.levtech.jp", category: "agent", detailPattern: "/project/detail/\\d+" },
  { id: "freelance_start", name: "フリーランススタート", origin: "https://freelance-start.com", category: "agent", note: "複数エージェントの横断検索。取れれば一番効率がいい。" },
  { id: "midworks", name: "Midworks", origin: "https://mid-works.com", category: "agent" },
  { id: "itpropartners", name: "ITプロパートナーズ", origin: "https://itpropartners.com", category: "agent" },
  { id: "geechs", name: "ギークスジョブ", origin: "https://geechs-job.com", category: "agent" },
  { id: "pebank", name: "PE-BANK", origin: "https://pe-bank.jp", category: "agent" },
  { id: "furien", name: "フリエン", origin: "https://furien.jp", category: "agent" },
  { id: "techfree", name: "テックフリー", origin: "https://tech-free.jp", category: "agent" },
  { id: "relance", name: "Relance", origin: "https://relance.jp", category: "agent" },

  // --- 業務委託・副業マッチング ---
  { id: "sokudan", name: "SOKUDAN", origin: "https://sokudan.work", category: "matching" },
  { id: "offers", name: "Offers", origin: "https://offers.jp", category: "matching" },
  { id: "workship", name: "Workship", origin: "https://goworkship.com", category: "matching" },
  { id: "anycrew", name: "Anycrew", origin: "https://anycrew.jp", category: "matching" },
  { id: "lotsful", name: "lotsful", origin: "https://lotsful.jp", category: "matching" },
  { id: "wantedly", name: "Wantedly", origin: "https://www.wantedly.com", category: "matching" },

  // --- 官公需・公共 ---
  {
    id: "kkj",
    name: "官公需情報ポータル",
    origin: "https://www.kkj.go.jp",
    category: "public",
    apiUrl: "https://www.kkj.go.jp/api/",
    note: "中小企業庁の公開API。キー不要、XML、自動取得が明示的に許可されている。ただし中身は工事・清掃・給食が中心で、個人が単独で取れる役務は1日1〜2件。入札参加資格が要るものが多い。",
  },
  {
    id: "jgrants",
    name: "jGrants 補助金",
    origin: "https://api.jgrants-portal.go.jp",
    category: "public",
    apiUrl: "https://api.jgrants-portal.go.jp/exp/v1/public/subsidies?keyword=%E8%A3%9C%E5%8A%A9%E9%87%91&sort=created_date&order=DESC&acceptance=1",
    note: "デジタル庁の公開API。案件ではなく補助金の公募。申請書の有償作成代行は行政書士法違反なので、受注先ではなく「見込み客がどこにいるか」の手がかりとして使う。ポータル側(www)は robots.txt で全面禁止なので触らない。",
  },

  // --- ライティング・翻訳 ---
  { id: "sagooworks", name: "サグーワークス", origin: "https://works.sagooo.com", category: "writing" },
  { id: "amelia", name: "アメリア（翻訳）", origin: "https://www.amelia.ne.jp", category: "writing" },
  { id: "conyac", name: "Conyac", origin: "https://conyac.cc", category: "writing" },

  // --- 求人 ---
  { id: "indeed", name: "Indeed", origin: "https://jp.indeed.com", category: "job_board" },
  { id: "stanby", name: "スタンバイ", origin: "https://jp.stanby.com", category: "job_board" },
  { id: "green", name: "Green", origin: "https://www.green-japan.com", category: "job_board" },

  // --- 海外（2026-08-24 実地調査。robots.txt・規約・出金の一次確認済み）-----
  {
    id: "fiverr",
    name: "Fiverr",
    origin: "https://www.fiverr.com",
    category: "skill_market",
    note:
      "出品型の本命。AI利用を全カテゴリで明示的に許可している唯一のサイト（2026-08-23版ヘルプ）。" +
      "ただし『生のAI出力そのまま』は品質基準違反でアカウント永久停止までありうる。" +
      "顧客要件への実質的な作り込みが必須。日本からPayoneer経由で出金可。手数料20%。" +
      "新規はギグ4本まで・広告不可で、Level 1（5件受注・$400）までが立ち上がりの壁。" +
      "検索露出は過去の取引実績で決まり、24時間以内返信率80%以上の維持が要る。",
  },
  {
    id: "upwork",
    name: "Upwork",
    origin: "https://www.upwork.com",
    category: "matching",
    note:
      "日本が出金の明示サポート対象（$0.99/回・上限$8,500）。手数料0〜15%。" +
      "出品型のProject Catalogあり（29万件・新規は審査に数週間）。" +
      "応募型はConnects $0.15/枚の実費。Claude公式コネクタ経由の露出はJSS90%以上が条件で、実績ゼロでは構造的に不可。" +
      "本体はCloudflareで自動取得不可（robots.txt自体が403）。",
  },
  {
    id: "freelancer_com",
    name: "Freelancer.com",
    origin: "https://www.freelancer.com",
    category: "crowdsourcing",
    note:
      "応募型。実測で入札中央値19件（投稿1時間以内）〜33件。ココナラの23人と同水準で、応募型の期待値問題は万国共通と確認。" +
      "ToS第33条が書面許可のない自動アクセスを（公開APIも含めて）禁止しているため、収集ソースにもしない。",
  },
  {
    id: "codeable",
    name: "Codeable",
    origin: "https://www.codeable.io",
    category: "matching",
    note:
      "WordPress特化・時給$80〜120・価格の叩き合いを構造的に排除。日本在住の稼働実績者あり。" +
      "ただし現在は新規応募の窓口が閉鎖中（waitlistのみ）。再開したら最有力。",
  },
];

export const getCandidate = (id: string): SiteCandidate | undefined =>
  SITE_CANDIDATES.find((s) => s.id === id);
