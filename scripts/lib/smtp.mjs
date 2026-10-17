/**
 * Gメールへ1通送るだけの小さな SMTP クライアント（外部の部品を使わない）。
 * smtp.gmail.com:465（最初から暗号化）に、Googleの「アプリ パスワード」でログインして送る。
 * アプリ パスワードはあなたのPCの中のファイルにだけ置く（リポジトリには入れない）。
 */
import tls from "node:tls";

/** connect はテスト用に差し替えられる（既定は Gmail への TLS 接続）。 */
export async function sendMail({ user, pass, to, message, host = "smtp.gmail.com", port = 465, connect, timeoutMs = 30_000 }) {
  const sock = connect ? connect() : tls.connect({ host, port, servername: host });
  sock.setEncoding("utf8");
  let buf = "";
  const waiters = [];
  sock.on("data", (chunk) => {
    buf += chunk;
    flush();
  });
  const failAll = (err) => {
    while (waiters.length) waiters.shift().reject(err);
  };
  sock.on("error", failAll);
  sock.setTimeout(timeoutMs, () => {
    failAll(new Error("メールサーバーからの応答がありません（時間切れ）"));
    sock.destroy();
  });

  // 応答は「250-…」が続いたあと「250 …」で終わる
  function flush() {
    while (waiters.length) {
      const lines = buf.split("\r\n");
      const endIdx = lines.findIndex((l) => /^\d{3} /.test(l));
      if (endIdx < 0) return;
      const reply = lines.slice(0, endIdx + 1);
      buf = lines.slice(endIdx + 1).join("\r\n");
      waiters.shift().resolve({ code: Number(reply[endIdx].slice(0, 3)), text: reply.join("\n") });
    }
  }
  const read = () =>
    new Promise((resolve, reject) => {
      waiters.push({ resolve, reject });
      flush();
    });
  const expect = async (codes, what) => {
    const r = await read();
    if (!codes.includes(r.code)) {
      throw new Error(`${what}で失敗しました（${r.text.split("\n").pop()}）`);
    }
    return r;
  };
  const send = (line) => sock.write(`${line}\r\n`);

  try {
    await expect([220], "接続");
    send("EHLO cw-patrol");
    await expect([250], "あいさつ");
    send(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`, "utf8").toString("base64")}`);
    await expect([235], "ログイン（アプリ パスワードを確認してください）");
    send(`MAIL FROM:<${user}>`);
    await expect([250], "差出人の指定");
    send(`RCPT TO:<${to}>`);
    await expect([250, 251], "宛先の指定");
    send("DATA");
    await expect([354], "本文の送信開始");
    // 行頭の「.」は二重にする（本文の終わりと間違えられないように）
    sock.write(`${message.replace(/^\./gm, "..")}\r\n.\r\n`);
    await expect([250], "本文の送信");
    send("QUIT");
    await read().catch(() => {}); // 221。届かなくても送信は済んでいる
  } finally {
    sock.end();
  }
}
