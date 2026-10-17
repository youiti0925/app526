# クラウドワークスの画面を、自分のログインのまま取り込む

メッセージの本文は、クラウドワークスにログインした人にしか見えません（通知メールには本文がなく、リンクだけです）。
Claude はあなたのIDやパスワードを持たず、持つ必要もありません。代わりに、**あなたが開いている画面のテキストを1タップでコピーする**道具を使います。

- 動くのは、あなたの端末で、あなたがログイン済みの、あなたが開いている1画面だけです。自動で巡回したり、送信・応募・返信をしたりはしません。
- 読んだ結果（返事待ち・危険信号・金額のミス）は、AIを使わないルールだけで出すので、使用量はかかりません。

## 1. 道具を登録する（1回だけ・iPhoneのSafari）

1. Safari で適当なページ（例: https://crowdworks.jp ）をブックマークに追加し、名前を「CW取り込み」にする
2. ブックマークの編集で、**アドレス（URL）を下の1行に丸ごと置き換える**

```
javascript:(function(){if(location.hostname.indexOf('crowdworks.jp')<0){alert('クラウドワークスの画面で押してください');return;}var t='【取り込み】'+location.href+'\n'+document.body.innerText;var done=function(m){alert(m+'（'+t.length+'文字）')};var fb=function(){var a=document.createElement('textarea');a.value=t;a.style.cssText='position:fixed;top:0;left:0;opacity:0';document.body.appendChild(a);a.focus();a.select();var ok=false;try{ok=document.execCommand('copy')}catch(e){}document.body.removeChild(a);done(ok?'コピーしました':'コピーできませんでした。画面を全選択してコピーしてください')};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){done('コピーしました')},fb)}else{fb()}})();
```

PCのChromeなら、ブックマークバーに新しいブックマークを作り、URLに同じ1行を貼ります。

## 2. 使う

1. Safari（またはPCのブラウザ）でクラウドワークスにログインし、「相談から契約まで」の画面（やり取りの画面）を開く
2. ブックマーク「CW取り込み」をタップ → 「コピーしました（◯◯文字）」と出る
3. 専用の会話に貼り付ける（何件か続けて貼ってもよい。1件ずつ「相談から契約まで：」の見出しで分けて読む）

専用の会話は、貼られたものを `outbox/in/画面.txt` に保存して次を1回実行する:

```
node scripts/job.mjs thread --text outbox/in/画面.txt --me あなたのID
```

出るもの: 状態・最後の発言（誰がいつ）・返事が要るか・危険信号・「あなたの提示額が募集の上限を大きく超えている」などのミス。

## できないこと

- クラウドワークスのアプリ（ネイティブ）の画面は、この道具では取れません。Safari で crowdworks.jp を開いてください。
- 通知メールだけでは、返事をしたかどうかは分かりません。画面を取り込めば分かります。
- 画面の作りが変わると読めなくなることがあります。読めなければ「メッセージが読めませんでした」と出ます。
