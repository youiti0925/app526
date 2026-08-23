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
  { id: "shufti", name: "シュフティ", origin: "https://app.shufti.jp", category: "crowdsourcing" },
  { id: "craudia", name: "クラウディア", origin: "https://www.craudia.com", category: "crowdsourcing" },

  // --- スキル出品 ---
  { id: "coconala", name: "ココナラ 公開依頼", origin: "https://coconala.com", category: "skill_market", detailPattern: "/requests/\\d+" },
  { id: "skima", name: "SKIMA", origin: "https://skima.jp", category: "skill_market" },
  { id: "timeticket", name: "タイムチケット", origin: "https://www.timeticket.jp", category: "skill_market" },
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
];

export const getCandidate = (id: string): SiteCandidate | undefined =>
  SITE_CANDIDATES.find((s) => s.id === id);
