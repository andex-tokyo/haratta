# ハラッタ？

誰が払ったか、もう迷わない。

PayPay支払いリンクを保存して、身内の割り勘回収状況を管理する自分用MVPです。参加者はログイン不要で、イベントURLから自分の金額と支払い状況を確認し、「支払いました」を押すだけで使えます。

## 構成

- Frontend: React + Vite
- Backend: Cloudflare Workers + Hono
- DB: Cloudflare D1
- Styling: Tailwind CSS
- Deploy: Wrangler
- 定期実行: Cloudflare Workers Cron Triggers
- Slack通知: Slack Incoming Webhook

Workers 1本で React SPA の静的配信、Hono API、Cron Trigger をまとめています。

## 主な機能

- Slack通知先登録
- グループ作成
- メンバー登録
- PayPay送金先情報登録
- 3ステップのイベント作成
- 金額単位のPayPay支払いリンク登録
- 同額メンバーで1リンク共有
- 支払い済み、未払いの更新
- 0円メンバーの対象外表示
- 初回Slack通知
- 毎日10時JSTの未払いリマインド
- 全員支払い完了時のSlack通知
- Webhook URLを一覧/APIレスポンスへ返さない

## セットアップ

このリポジトリは asdf で Node.js を固定しています。

```bash
asdf install
node --version
```

`node --version` が `.tool-versions` と同じバージョンになっていることを確認してください。

```bash
pnpm install
```

D1データベースを作成します。

```bash
pnpm wrangler d1 create haratta-db
```

表示された `database_id` を `wrangler.jsonc` の `d1_databases[0].database_id` に設定してください。

ローカルDBへmigrationを適用します。

```bash
pnpm db:migrations:local
```

`.dev.vars` を作成します。

```bash
APP_BASE_URL=http://localhost:5173
```

`.dev.vars` は `.gitignore` 済みです。

## ローカル起動

```bash
pnpm dev
```

ブラウザで `http://localhost:5173` を開きます。

## デプロイ

本番D1へmigrationを適用します。

```bash
pnpm db:migrations:remote
```

本番URLをWrangler secretまたはvarsへ設定します。Cron通知でURL生成に使うため必須です。

```bash
pnpm wrangler secret put APP_BASE_URL
```

デプロイします。

```bash
pnpm deploy
```

## Cron

`wrangler.jsonc` で以下を設定しています。

```json
{
  "triggers": {
    "crons": ["0 1 * * *"]
  }
}
```

Cloudflare CronはUTC指定のため、`0 1 * * *` は日本時間10:00です。未払い者がいるイベントだけSlackへ日次リマインドします。同じJST日付で成功済みの `daily_reminder` がある場合は再送しません。

## API

- `POST /api/slack-destinations`
- `GET /api/slack-destinations`
- `POST /api/groups`
- `GET /api/groups/:groupToken`
- `POST /api/groups/:groupToken/events`
- `GET /api/events/:eventToken`
- `PATCH /api/events/:eventToken/members/:memberId/status`

## PayPay支払いリンクについて

PayPay API連携やApp Invokeはしていません。ハラッタ？では、ユーザーがPayPayアプリなどで作成した「PayPay支払いリンク」を保存して表示するだけです。

リンク未登録、期限切れ、リンクが使えない場合でも、PayPay送金先情報と金額コピーから支払える導線を残しています。

## 注意

- ログイン、権限管理はありません。
- URLを知っている人は閲覧、操作できます。
- お金は預かりません。
- Slack Incoming Webhook URLは画面一覧や取得APIでは返しません。
