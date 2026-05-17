import { Hono } from "hono";
import { cors } from "hono/cors";

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_BASE_URL: string;
};

type CfProperties = {
  country?: string;
};

type GroupRow = {
  id: string;
  public_token: string;
  name: string;
  default_payee_name: string;
  default_paypay_info: string;
  default_bank_info: string;
  management_password_hash: string | null;
  slack_destination_id: string | null;
  slack_destination_name: string | null;
  slack_channel_name: string | null;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  id: string;
  group_id: string;
  payer_id: string | null;
  public_token: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
};

type GroupPayerRow = {
  id: string;
  group_id: string;
  name: string;
  paypay_info: string;
  bank_info: string;
  created_at: string;
  updated_at: string;
};

type EventMemberRow = {
  id: string;
  event_id: string;
  group_member_id: string | null;
  name: string;
  slack_user_id: string | null;
  slack_display_name: string | null;
  member_type: "group" | "guest";
  amount: number;
  status: "unpaid" | "paid";
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

type PayPayLinkRow = {
  id: string;
  event_id: string;
  amount: number;
  url: string;
  created_at: string;
  updated_at: string;
};

type SlackDestinationRow = {
  id: string;
  name: string;
  channel_name: string;
  webhook_url: string;
  bot_token: string | null;
};

type GroupMemberRow = {
  id: string;
  name: string;
  slack_user_id: string | null;
  slack_display_name: string | null;
  created_at: string;
};

const app = new Hono<{ Bindings: Bindings }>();

const CRAWLER_USER_AGENT_PATTERN =
  /(bot|crawler|spider|scrapy|slurp|ahrefs|semrush|mj12|dotbot|bytespider|gptbot|claudebot|perplexity|ccbot|facebookexternalhit|twitterbot|discordbot|slackbot|linebot|embedly|preview|wget|curl|python-requests)/i;
const API_RATE_LIMIT = 60;
const API_RATE_WINDOW_SECONDS = 60;

function securityResponse(message: string, status: number, path: string) {
  if (path.startsWith("/api/")) {
    return jsonError(message, status);
  }
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function overApiRateLimit(db: D1Database, request: Request) {
  if (request.method === "OPTIONS") return false;
  const ip = request.headers.get("CF-Connecting-IP") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  const now = new Date();
  const bucket = Math.floor(now.getTime() / (API_RATE_WINDOW_SECONDS * 1000));
  const key = `${bucket}:${await sha256Hex(ip)}`;
  const resetAt = new Date((bucket + 1) * API_RATE_WINDOW_SECONDS * 1000).toISOString();
  const updatedAt = now.toISOString();
  const current = await db
    .prepare("SELECT count FROM security_rate_limits WHERE key = ?")
    .bind(key)
    .first<{ count: number }>();
  const nextCount = (current?.count ?? 0) + 1;
  if (current) {
    await db.prepare("UPDATE security_rate_limits SET count = ?, updated_at = ? WHERE key = ?").bind(nextCount, updatedAt, key).run();
  } else {
    await db
      .prepare("INSERT INTO security_rate_limits (key, count, reset_at, updated_at) VALUES (?, ?, ?, ?)")
      .bind(key, nextCount, resetAt, updatedAt)
      .run();
    if (Math.random() < 0.02) {
      await db.prepare("DELETE FROM security_rate_limits WHERE reset_at < ?").bind(updatedAt).run();
    }
  }
  return nextCount > API_RATE_LIMIT;
}

app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  const cf = c.req.raw.cf as CfProperties | undefined;
  const country = cf?.country;
  if (country && country !== "JP") {
    return securityResponse("Access is limited to Japan.", 403, url.pathname);
  }

  const userAgent = c.req.header("user-agent") ?? "";
  if (userAgent && CRAWLER_USER_AGENT_PATTERN.test(userAgent)) {
    return securityResponse("Crawler access is blocked.", 403, url.pathname);
  }

  if (url.pathname.startsWith("/api/") && (await overApiRateLimit(c.env.DB, c.req.raw))) {
    return securityResponse("Too many requests.", 429, url.pathname);
  }

  await next();
});

app.use("/api/*", cors());

const jsonError = (message: string, status = 400) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

const nowIso = () => new Date().toISOString();
const id = () => crypto.randomUUID();

async function hashPassword(password: string) {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function passwordMatches(password: string, hash: string | null) {
  return Boolean(hash && password && (await hashPassword(password)) === hash);
}

function publicToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("");
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function intAmount(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function validUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function parsePayers(body: Record<string, unknown>) {
  const rawPayers = Array.isArray(body.payers) ? body.payers : [];
  const payers = rawPayers
    .map((item) => {
      const row = asObject(item);
      if (!row) return null;
      return {
        id: text(row.id) || null,
        name: text(row.name),
        paypayInfo: optionalText(row.paypayInfo),
        bankInfo: optionalText(row.bankInfo)
      };
    })
    .filter((payer): payer is NonNullable<typeof payer> => Boolean(payer?.name));

  if (payers.length) return payers;

  const fallback = {
    id: null,
    name: text(body.defaultPayeeName),
    paypayInfo: optionalText(body.defaultPaypayInfo),
    bankInfo: optionalText(body.defaultBankInfo)
  };
  return fallback.name ? [fallback] : [];
}

function eventUrl(env: Bindings, token: string) {
  return `${env.APP_BASE_URL.replace(/\/$/, "")}/e/${token}`;
}

function jstDayBounds(date = new Date()) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const d = jst.getUTCDate();
  const start = new Date(Date.UTC(y, m, d) - 9 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(y, m, d + 1) - 9 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function sendSlack(webhookUrl: string, textBody: string) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: textBody })
  });
  if (!response.ok) {
    throw new Error(`Slack returned ${response.status}: ${await response.text()}`);
  }
}

function slackMention(member: Pick<EventMemberRow, "name" | "slack_user_id">) {
  return member.slack_user_id ? `<@${member.slack_user_id}>` : member.name;
}

function yenText(amount: number) {
  return `${amount.toLocaleString("ja-JP")}円`;
}

function slackPaymentLine(member: Pick<EventMemberRow, "name" | "slack_user_id" | "amount">) {
  const person = member.slack_user_id ? `<@${member.slack_user_id}>` : member.name;
  return `${person} ${yenText(member.amount)}`;
}

async function getSlackDestination(db: D1Database, eventId: string) {
  return db
    .prepare(
      `SELECT sd.id, sd.name, sd.channel_name, sd.webhook_url
       FROM events e
       JOIN groups g ON g.id = e.group_id
       JOIN slack_destinations sd ON sd.id = g.slack_destination_id
       WHERE e.id = ?`
    )
    .bind(eventId)
    .first<SlackDestinationRow>();
}

async function logNotification(
  db: D1Database,
  eventId: string,
  notificationType: "initial" | "daily_reminder" | "completion",
  success: boolean,
  errorMessage = ""
) {
  await db
    .prepare(
      `INSERT INTO slack_notification_logs
       (id, event_id, notification_type, sent_at, success, error_message)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id(), eventId, notificationType, nowIso(), success ? 1 : 0, errorMessage || null)
    .run();
}

async function notifyEvent(
  env: Bindings,
  event: Pick<EventRow, "id" | "title" | "public_token">,
  notificationType: "initial" | "daily_reminder" | "completion",
  reminderNames: string[] = []
) {
  const destination = await getSlackDestination(env.DB, event.id);
  if (!destination) return;

  let message = "";
  if (notificationType === "initial") {
    message = `💰「${event.title}」の精算です！${
      reminderNames.length ? `\n対象: ${reminderNames.join("、")}` : ""
    }\n\n支払い状況確認はこちら\n${eventUrl(env, event.public_token)}`;
  } else if (notificationType === "daily_reminder") {
    message = `💰「${event.title}」の未払いリマインドです。\n\n未払い: ${reminderNames.join("、")}\n${eventUrl(env, event.public_token)}`;
  } else {
    message = `✅「${event.title}」の精算が完了しました！`;
  }

  try {
    await sendSlack(destination.webhook_url, message);
    await logNotification(env.DB, event.id, notificationType, true);
  } catch (error) {
    await logNotification(
      env.DB,
      event.id,
      notificationType,
      false,
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function hasSuccessfulCompletionLog(db: D1Database, eventId: string) {
  const row = await db
    .prepare(
      `SELECT id FROM slack_notification_logs
       WHERE event_id = ? AND notification_type = 'completion' AND success = 1
       LIMIT 1`
    )
    .bind(eventId)
    .first();
  return Boolean(row);
}

async function maybeNotifyCompletion(env: Bindings, eventId: string) {
  if (await hasSuccessfulCompletionLog(env.DB, eventId)) return;

  const summary = await env.DB
    .prepare(
      `SELECT
        SUM(CASE WHEN amount > 0 THEN 1 ELSE 0 END) AS payable_count,
        SUM(CASE WHEN amount > 0 AND status = 'paid' THEN 1 ELSE 0 END) AS paid_count
       FROM event_members
       WHERE event_id = ?`
    )
    .bind(eventId)
    .first<{ payable_count: number | null; paid_count: number | null }>();

  const payableCount = summary?.payable_count ?? 0;
  if (payableCount === 0 || payableCount !== (summary?.paid_count ?? 0)) return;

  const event = await env.DB
    .prepare("SELECT id, title, public_token FROM events WHERE id = ?")
    .bind(eventId)
    .first<EventRow>();
  if (event) await notifyEvent(env, event, "completion");
}

async function buildEventResponse(db: D1Database, eventToken: string) {
  const event = await db
    .prepare(
      `SELECT e.*, g.name AS group_name, g.public_token AS group_public_token,
        COALESCE(p.name, g.default_payee_name) AS payee_name,
        COALESCE(p.paypay_info, g.default_paypay_info) AS paypay_info,
        COALESCE(p.bank_info, g.default_bank_info) AS bank_info
       FROM events e
       JOIN groups g ON g.id = e.group_id
       LEFT JOIN group_payers p ON p.id = e.payer_id
       WHERE e.public_token = ?`
    )
    .bind(eventToken)
    .first<
      EventRow & {
        group_name: string;
        group_public_token: string;
        payee_name: string;
        paypay_info: string;
        bank_info: string;
      }
    >();
  if (!event) return null;

  const members = (
    await db
      .prepare("SELECT * FROM event_members WHERE event_id = ? ORDER BY created_at ASC")
      .bind(event.id)
      .all<EventMemberRow>()
  ).results;
  const paypayLinks = (
    await db
      .prepare("SELECT * FROM event_paypay_links WHERE event_id = ? ORDER BY amount ASC")
      .bind(event.id)
      .all<PayPayLinkRow>()
  ).results;

  const payable = members.filter((member) => member.amount > 0);
  const paid = payable.filter((member) => member.status === "paid");
  return {
    id: event.id,
    publicToken: event.public_token,
    title: event.title,
    description: event.description,
    groupName: event.group_name,
    groupPublicToken: event.group_public_token,
    payerId: event.payer_id,
    payeeName: event.payee_name,
    paypayInfo: event.paypay_info,
    bankInfo: event.bank_info,
    createdAt: event.created_at,
    updatedAt: event.updated_at,
    summary: {
      totalAmount: payable.reduce((sum, member) => sum + member.amount, 0),
      payableCount: payable.length,
      paidCount: paid.length,
      unpaidCount: payable.length - paid.length
    },
    members: members.map((member) => ({
      id: member.id,
      groupMemberId: member.group_member_id,
      name: member.name,
      slackUserId: member.slack_user_id,
      slackDisplayName: member.slack_display_name,
      memberType: member.member_type,
      amount: member.amount,
      status: member.status,
      paidAt: member.paid_at,
      paypayLink: paypayLinks.find((link) => link.amount === member.amount)?.url ?? null
    })),
    paypayLinks: paypayLinks.map((link) => ({
      id: link.id,
      amount: link.amount,
      url: link.url
    }))
  };
}

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/slack-destinations", async (c) => {
  const body = asObject(await c.req.json().catch(() => null));
  if (!body) return jsonError("Invalid JSON");

  const name = text(body.name);
  const channelName = text(body.channelName);
  const webhookUrl = text(body.webhookUrl);
  const botToken = text(body.botToken) || null;
  if (!name || !channelName || !webhookUrl) return jsonError("必須項目を入力してください");
  if (!webhookUrl.startsWith("https://hooks.slack.com/")) {
    return jsonError("Slack Incoming Webhook URLを入力してください");
  }
  if (botToken && !botToken.startsWith("xoxb-")) {
    return jsonError("Slack Bot User OAuth Tokenはxoxb-で始まる値を入力してください");
  }

  const createdAt = nowIso();
  const destinationId = id();
  await c.env.DB.prepare(
    `INSERT INTO slack_destinations
     (id, name, channel_name, webhook_url, bot_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(destinationId, name, channelName, webhookUrl, botToken, createdAt, createdAt)
    .run();

  return c.json({ id: destinationId, name, channelName, createdAt, updatedAt: createdAt }, 201);
});

app.get("/api/slack-destinations/:id/users", async (c) => {
  const destination = await c.env.DB.prepare(
    "SELECT id, bot_token FROM slack_destinations WHERE id = ?"
  )
    .bind(c.req.param("id"))
    .first<{ id: string; bot_token: string | null }>();
  if (!destination) return jsonError("Slack通知先が見つかりません", 404);
  if (!destination.bot_token) return c.json([]);

  const response = await fetch("https://slack.com/api/users.list", {
    headers: { authorization: `Bearer ${destination.bot_token}` }
  });
  const body = (await response.json().catch(() => null)) as
    | {
        ok?: boolean;
        error?: string;
        members?: Array<{
          id: string;
          name?: string;
          deleted?: boolean;
          is_bot?: boolean;
          is_app_user?: boolean;
          profile?: { real_name?: string; display_name?: string; email?: string };
        }>;
      }
    | null;
  if (!body?.ok) return jsonError(`Slackユーザー一覧を取得できません: ${body?.error ?? "unknown_error"}`);

  return c.json(
    (body.members ?? [])
      .filter((member) => !member.deleted && !member.is_bot && !member.is_app_user)
      .map((member) => ({
        id: member.id,
        name: member.profile?.display_name || member.profile?.real_name || member.name || member.id,
        handle: member.name ?? "",
        email: member.profile?.email ?? ""
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"))
  );
});

app.get("/api/slack-destinations", async (c) => {
  const rows = (
    await c.env.DB.prepare(
      "SELECT id, name, channel_name, created_at, updated_at FROM slack_destinations ORDER BY created_at DESC"
    ).all<{
      id: string;
      name: string;
      channel_name: string;
      created_at: string;
      updated_at: string;
    }>()
  ).results;
  return c.json(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      channelName: row.channel_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  );
});

app.get("/api/groups", async (c) => {
  const rows = (
    await c.env.DB.prepare(
      `SELECT
        g.public_token,
        g.name,
        g.created_at,
        g.updated_at,
        COUNT(DISTINCT gm.id) AS member_count,
        COUNT(DISTINCT e.id) AS event_count
       FROM groups g
       LEFT JOIN group_members gm ON gm.group_id = g.id
       LEFT JOIN events e ON e.group_id = g.id
       GROUP BY g.id
       ORDER BY g.updated_at DESC, g.created_at DESC`
    ).all<{
      public_token: string;
      name: string;
      created_at: string;
      updated_at: string;
      member_count: number;
      event_count: number;
    }>()
  ).results;

  return c.json(
    rows.map((row) => ({
      publicToken: row.public_token,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      memberCount: row.member_count,
      eventCount: row.event_count
    }))
  );
});

app.post("/api/groups", async (c) => {
  const body = asObject(await c.req.json().catch(() => null));
  if (!body) return jsonError("Invalid JSON");

  const name = text(body.name);
  const payers = parsePayers(body);
  const primaryPayer = payers[0];
  const managementPassword = text(body.managementPassword);
  const slackDestinationId = text(body.slackDestinationId) || null;
  const members = Array.isArray(body.members)
    ? body.members
        .map((member) => {
          const row = asObject(member);
          if (row) {
            return {
              name: text(row.name),
              slackUserId: text(row.slackUserId) || null,
              slackDisplayName: text(row.slackDisplayName) || null
            };
          }
          return { name: text(member), slackUserId: null, slackDisplayName: null };
        })
        .filter((member) => member.name)
    : [];

  if (!name) {
    return jsonError("グループ名を入力してください");
  }
  if (!payers.length) {
    return jsonError("建て替え者を1人以上入力してください");
  }
  if (payers.some((payer) => !payer.paypayInfo && !payer.bankInfo)) {
    return jsonError("建て替え者ごとにPayPay送金先情報、または振込先情報のどちらかを入力してください");
  }
  if (managementPassword.length < 6) {
    return jsonError("管理パスワードは6文字以上で入力してください");
  }
  if (members.length < 1) return jsonError("メンバーを1人以上入力してください");

  if (slackDestinationId) {
    const destination = await c.env.DB.prepare("SELECT id FROM slack_destinations WHERE id = ?")
      .bind(slackDestinationId)
      .first();
    if (!destination) return jsonError("Slack通知先が見つかりません", 404);
  }

  const groupId = id();
  const token = publicToken();
  const createdAt = nowIso();
  const passwordHash = await hashPassword(managementPassword);
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO groups
       (id, public_token, name, default_payee_name, default_paypay_info, default_bank_info, management_password_hash, slack_destination_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      groupId,
      token,
      name,
      primaryPayer.name,
      primaryPayer.paypayInfo,
      primaryPayer.bankInfo,
      passwordHash,
      slackDestinationId,
      createdAt,
      createdAt
    ),
    ...payers.map((payer) =>
      c.env.DB.prepare(
        "INSERT INTO group_payers (id, group_id, name, paypay_info, bank_info, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(id(), groupId, payer.name, payer.paypayInfo, payer.bankInfo, createdAt, createdAt)
    ),
    ...members.map((member) =>
      c.env.DB.prepare(
        "INSERT INTO group_members (id, group_id, name, slack_user_id, slack_display_name, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(id(), groupId, member.name, member.slackUserId, member.slackDisplayName, createdAt)
    )
  ];
  await c.env.DB.batch(statements);

  return c.json({ id: groupId, publicToken: token, url: `/g/${token}` }, 201);
});

app.patch("/api/groups/:groupToken", async (c) => {
  const group = await c.env.DB.prepare("SELECT * FROM groups WHERE public_token = ?")
    .bind(c.req.param("groupToken"))
    .first<GroupRow>();
  if (!group) return jsonError("グループが見つかりません", 404);

  const body = asObject(await c.req.json().catch(() => null));
  if (!body) return jsonError("Invalid JSON");

  const managementPassword = text(body.managementPassword);
  const newManagementPassword = text(body.newManagementPassword);
  if (group.management_password_hash) {
    if (!(await passwordMatches(managementPassword, group.management_password_hash))) {
      return jsonError("管理パスワードが違います", 403);
    }
  } else if (newManagementPassword.length < 6) {
    return jsonError("このグループには管理パスワードが未設定です。6文字以上の新しい管理パスワードを設定してください");
  }

  const name = text(body.name);
  const payers = parsePayers(body);
  const primaryPayer = payers[0];
  const slackDestinationId = text(body.slackDestinationId) || null;
  const members = Array.isArray(body.members)
    ? body.members
        .map((member) => {
          const row = asObject(member);
          if (!row) return null;
          return {
            id: text(row.id) || null,
            name: text(row.name),
            slackUserId: text(row.slackUserId) || null,
            slackDisplayName: text(row.slackDisplayName) || null
          };
        })
        .filter((member): member is NonNullable<typeof member> => Boolean(member?.name))
    : [];

  if (!name) return jsonError("グループ名を入力してください");
  if (!payers.length) return jsonError("建て替え者を1人以上入力してください");
  if (payers.some((payer) => !payer.paypayInfo && !payer.bankInfo)) {
    return jsonError("建て替え者ごとにPayPay送金先情報、または振込先情報のどちらかを入力してください");
  }
  if (members.length < 1) return jsonError("メンバーを1人以上入力してください");
  if (slackDestinationId) {
    const destination = await c.env.DB.prepare("SELECT id FROM slack_destinations WHERE id = ?")
      .bind(slackDestinationId)
      .first();
    if (!destination) return jsonError("Slack通知先が見つかりません", 404);
  }

  const updatedAt = nowIso();
  const nextPasswordHash =
    newManagementPassword.length >= 6 ? await hashPassword(newManagementPassword) : group.management_password_hash;
  const existing = (
    await c.env.DB.prepare("SELECT id FROM group_members WHERE group_id = ?")
      .bind(group.id)
      .all<{ id: string }>()
  ).results;
  const existingPayers = (
    await c.env.DB.prepare("SELECT id FROM group_payers WHERE group_id = ?")
      .bind(group.id)
      .all<{ id: string }>()
  ).results;
  const incomingExistingIds = new Set(members.map((member) => member.id).filter(Boolean));
  const incomingPayerIds = new Set(payers.map((payer) => payer.id).filter(Boolean));
  const deletingPayerIds = existingPayers.filter((payer) => !incomingPayerIds.has(payer.id)).map((payer) => payer.id);
  if (deletingPayerIds.length) {
    const used = (
      await c.env.DB.prepare(
        `SELECT payer_id FROM events
         WHERE group_id = ? AND payer_id IN (${deletingPayerIds.map(() => "?").join(",")})
         LIMIT 1`
      )
        .bind(group.id, ...deletingPayerIds)
        .first<{ payer_id: string }>()
    );
    if (used) return jsonError("イベントで使われている建て替え者は削除できません");
  }
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE groups
       SET name = ?, default_payee_name = ?, default_paypay_info = ?, default_bank_info = ?,
           management_password_hash = ?, slack_destination_id = ?, updated_at = ?
       WHERE id = ?`
    ).bind(
      name,
      primaryPayer.name,
      primaryPayer.paypayInfo,
      primaryPayer.bankInfo,
      nextPasswordHash,
      slackDestinationId,
      updatedAt,
      group.id
    ),
    ...existing
      .filter((member) => !incomingExistingIds.has(member.id))
      .map((member) => c.env.DB.prepare("DELETE FROM group_members WHERE id = ? AND group_id = ?").bind(member.id, group.id)),
    ...existingPayers
      .filter((payer) => !incomingPayerIds.has(payer.id))
      .map((payer) => c.env.DB.prepare("DELETE FROM group_payers WHERE id = ? AND group_id = ?").bind(payer.id, group.id)),
    ...payers.map((payer) => {
      if (payer.id) {
        return c.env.DB.prepare(
          "UPDATE group_payers SET name = ?, paypay_info = ?, bank_info = ?, updated_at = ? WHERE id = ? AND group_id = ?"
        ).bind(payer.name, payer.paypayInfo, payer.bankInfo, updatedAt, payer.id, group.id);
      }
      return c.env.DB.prepare(
        "INSERT INTO group_payers (id, group_id, name, paypay_info, bank_info, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(id(), group.id, payer.name, payer.paypayInfo, payer.bankInfo, updatedAt, updatedAt);
    }),
    ...members.map((member) => {
      if (member.id) {
        return c.env.DB.prepare(
          "UPDATE group_members SET name = ?, slack_user_id = ?, slack_display_name = ? WHERE id = ? AND group_id = ?"
        ).bind(member.name, member.slackUserId, member.slackDisplayName, member.id, group.id);
      }
      return c.env.DB.prepare(
        "INSERT INTO group_members (id, group_id, name, slack_user_id, slack_display_name, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(id(), group.id, member.name, member.slackUserId, member.slackDisplayName, updatedAt);
    })
  ];
  await c.env.DB.batch(statements);

  return c.json({ ok: true });
});

app.delete("/api/groups/:groupToken", async (c) => {
  const group = await c.env.DB.prepare("SELECT * FROM groups WHERE public_token = ?")
    .bind(c.req.param("groupToken"))
    .first<GroupRow>();
  if (!group) return jsonError("グループが見つかりません", 404);
  const body = asObject(await c.req.json().catch(() => null));
  const managementPassword = text(body?.managementPassword);
  if (!(await passwordMatches(managementPassword, group.management_password_hash))) {
    return jsonError("管理パスワードが違います", 403);
  }
  await c.env.DB.prepare("DELETE FROM groups WHERE id = ?").bind(group.id).run();
  return c.json({ ok: true });
});

app.get("/api/groups/:groupToken", async (c) => {
  const group = await c.env.DB.prepare(
    `SELECT g.*, sd.name AS slack_destination_name, sd.channel_name AS slack_channel_name
     FROM groups g
     LEFT JOIN slack_destinations sd ON sd.id = g.slack_destination_id
     WHERE g.public_token = ?`
  )
    .bind(c.req.param("groupToken"))
    .first<GroupRow>();
  if (!group) return jsonError("グループが見つかりません", 404);

  const members = (
    await c.env.DB.prepare("SELECT id, name, slack_user_id, slack_display_name, created_at FROM group_members WHERE group_id = ?")
      .bind(group.id)
      .all<GroupMemberRow>()
  ).results;
  const payers = (
    await c.env.DB.prepare("SELECT * FROM group_payers WHERE group_id = ? ORDER BY created_at ASC")
      .bind(group.id)
      .all<GroupPayerRow>()
  ).results;
  const events = (
    await c.env.DB.prepare(
      `SELECT e.id, e.public_token, e.title, e.description, e.created_at,
        SUM(CASE WHEN em.amount > 0 THEN 1 ELSE 0 END) AS payable_count,
        SUM(CASE WHEN em.amount > 0 AND em.status = 'paid' THEN 1 ELSE 0 END) AS paid_count
       FROM events e
       LEFT JOIN event_members em ON em.event_id = e.id
       WHERE e.group_id = ?
       GROUP BY e.id
       ORDER BY e.created_at DESC`
    )
      .bind(group.id)
      .all<{
        id: string;
        public_token: string;
        title: string;
        description: string;
        created_at: string;
        payable_count: number | null;
        paid_count: number | null;
      }>()
  ).results;

  return c.json({
    id: group.id,
    publicToken: group.public_token,
    name: group.name,
    defaultPayeeName: group.default_payee_name,
    defaultPaypayInfo: group.default_paypay_info,
    defaultBankInfo: group.default_bank_info,
    payers: (payers.length
      ? payers
      : [
          {
            id: "",
            group_id: group.id,
            name: group.default_payee_name,
            paypay_info: group.default_paypay_info,
            bank_info: group.default_bank_info,
            created_at: group.created_at,
            updated_at: group.updated_at
          }
        ]
    ).map((payer) => ({
      id: payer.id,
      name: payer.name,
      paypayInfo: payer.paypay_info,
      bankInfo: payer.bank_info,
      createdAt: payer.created_at,
      updatedAt: payer.updated_at
    })),
    managementPasswordSet: Boolean(group.management_password_hash),
    slackDestination: group.slack_destination_id
      ? {
          id: group.slack_destination_id,
          name: group.slack_destination_name,
          channelName: group.slack_channel_name
        }
      : null,
    members: members.map((member) => ({
      id: member.id,
      name: member.name,
      slackUserId: member.slack_user_id,
      slackDisplayName: member.slack_display_name,
      createdAt: member.created_at
    })),
    events: events.map((event) => ({
      id: event.id,
      publicToken: event.public_token,
      title: event.title,
      description: event.description,
      createdAt: event.created_at,
      payableCount: event.payable_count ?? 0,
      paidCount: event.paid_count ?? 0
    }))
  });
});

app.post("/api/groups/:groupToken/events", async (c) => {
  const group = await c.env.DB.prepare("SELECT * FROM groups WHERE public_token = ?")
    .bind(c.req.param("groupToken"))
    .first<GroupRow>();
  if (!group) return jsonError("グループが見つかりません", 404);

  const body = asObject(await c.req.json().catch(() => null));
  if (!body) return jsonError("Invalid JSON");

  const title = text(body.title);
  const description = optionalText(body.description);
  const payerId = text(body.payerId);
  const memberAmounts = Array.isArray(body.memberAmounts) ? body.memberAmounts : [];
  const extraMembers = Array.isArray(body.extraMembers) ? body.extraMembers : [];
  const paypayLinks = Array.isArray(body.paypayLinks) ? body.paypayLinks : [];
  if (!title) return jsonError("イベント名を入力してください");
  if (memberAmounts.length < 1) return jsonError("メンバー金額を入力してください");

  const members = (
    await c.env.DB.prepare("SELECT id, name, slack_user_id, slack_display_name, created_at FROM group_members WHERE group_id = ?")
      .bind(group.id)
      .all<GroupMemberRow>()
  ).results;
  const payers = (
    await c.env.DB.prepare("SELECT * FROM group_payers WHERE group_id = ? ORDER BY created_at ASC")
      .bind(group.id)
      .all<GroupPayerRow>()
  ).results;
  const selectedPayer = payerId ? payers.find((payer) => payer.id === payerId) : payers[0];
  if (payers.length && !selectedPayer) return jsonError("建て替え者が見つかりません", 404);
  const memberMap = new Map(members.map((member) => [member.id, member]));
  const parsedAmounts: {
    memberId: string | null;
    name: string;
    slackUserId: string | null;
    slackDisplayName: string | null;
    memberType: "group" | "guest";
    amount: number;
  }[] = [];
  for (const item of memberAmounts) {
    const row = asObject(item);
    const memberId = text(row?.memberId);
    const amount = intAmount(row?.amount);
    const member = memberMap.get(memberId);
    if (!member) return jsonError("不正なメンバーが含まれています");
    if (amount === null) return jsonError("金額は0以上の整数で入力してください");
    parsedAmounts.push({
      memberId,
      name: member.name,
      slackUserId: member.slack_user_id,
      slackDisplayName: member.slack_display_name,
      memberType: "group",
      amount
    });
  }
  for (const item of extraMembers) {
    const row = asObject(item);
    const name = text(row?.name);
    const amount = intAmount(row?.amount);
    const slackUserId = text(row?.slackUserId) || null;
    const slackDisplayName = text(row?.slackDisplayName) || null;
    if (!name) continue;
    if (amount === null) return jsonError("追加メンバーの金額は0以上の整数で入力してください");
    parsedAmounts.push({
      memberId: null,
      name,
      slackUserId,
      slackDisplayName,
      memberType: "guest",
      amount
    });
  }
  if (new Set(parsedAmounts.filter((item) => item.memberId).map((item) => item.memberId)).size !== parsedAmounts.filter((item) => item.memberId).length) {
    return jsonError("同じグループメンバーが重複しています");
  }
  if (parsedAmounts.length < 1) {
    return jsonError("参加メンバーを1人以上選択してください");
  }

  const parsedLinks: { amount: number; url: string }[] = [];
  for (const item of paypayLinks) {
    const row = asObject(item);
    const amount = intAmount(row?.amount);
    const url = text(row?.url);
    if (amount === null || amount <= 0) return jsonError("PayPayリンクの金額が不正です");
    if (!url) continue;
    if (!validUrl(url)) return jsonError("PayPay支払いリンクのURL形式が不正です");
    parsedLinks.push({ amount, url });
  }
  if (new Set(parsedLinks.map((link) => link.amount)).size !== parsedLinks.length) {
    return jsonError("同じ金額のPayPay支払いリンクが重複しています");
  }
  const positiveAmounts = new Set(parsedAmounts.filter((item) => item.amount > 0).map((item) => item.amount));
  if (parsedLinks.some((link) => !positiveAmounts.has(link.amount))) {
    return jsonError("対象金額にないPayPay支払いリンクが含まれています");
  }

  const eventId = id();
  const token = publicToken();
  const createdAt = nowIso();
  const eventStatement = c.env.DB.prepare(
    `INSERT INTO events (id, group_id, payer_id, public_token, title, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(eventId, group.id, selectedPayer?.id ?? null, token, title, description, createdAt, createdAt);
  const memberStatements = parsedAmounts.map((item) => {
    return c.env.DB.prepare(
      `INSERT INTO event_members
       (id, event_id, group_member_id, name, slack_user_id, slack_display_name, member_type, amount, status, paid_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', NULL, ?, ?)`
    ).bind(
      id(),
      eventId,
      item.memberId,
      item.name,
      item.slackUserId,
      item.slackDisplayName,
      item.memberType,
      item.amount,
      createdAt,
      createdAt
    );
  });
  const linkStatements = parsedLinks.map((link) =>
    c.env.DB.prepare(
      `INSERT INTO event_paypay_links (id, event_id, amount, url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id(), eventId, link.amount, link.url, createdAt, createdAt)
  );
  await c.env.DB.batch([eventStatement, ...memberStatements, ...linkStatements]);

  await notifyEvent(
    c.env,
    { id: eventId, title, public_token: token },
    "initial",
    parsedAmounts
      .filter((member) => member.amount > 0)
      .map((member) => {
        const person = member.slackUserId ? `<@${member.slackUserId}>` : member.name;
        return `${person} ${yenText(member.amount)}`;
      })
  );

  return c.json({ id: eventId, publicToken: token, url: `/e/${token}` }, 201);
});

app.get("/api/events/:eventToken", async (c) => {
  const response = await buildEventResponse(c.env.DB, c.req.param("eventToken"));
  if (!response) return jsonError("イベントが見つかりません", 404);
  return c.json(response);
});

app.patch("/api/events/:eventToken", async (c) => {
  const event = await c.env.DB.prepare(
    `SELECT e.*, g.management_password_hash
     FROM events e
     JOIN groups g ON g.id = e.group_id
     WHERE e.public_token = ?`
  )
    .bind(c.req.param("eventToken"))
    .first<EventRow & { management_password_hash: string | null }>();
  if (!event) return jsonError("イベントが見つかりません", 404);

  const body = asObject(await c.req.json().catch(() => null));
  if (!body) return jsonError("Invalid JSON");
  if (!(await passwordMatches(text(body.managementPassword), event.management_password_hash))) {
    return jsonError("管理パスワードが違います", 403);
  }

  const title = text(body.title);
  const description = optionalText(body.description);
  const payerId = text(body.payerId);
  const members = Array.isArray(body.members) ? body.members : [];
  const paypayLinks = Array.isArray(body.paypayLinks) ? body.paypayLinks : [];
  if (!title) return jsonError("イベント名を入力してください");
  if (members.length < 1) return jsonError("参加メンバーを1人以上入力してください");

  const currentMembers = (
    await c.env.DB.prepare("SELECT * FROM event_members WHERE event_id = ?")
      .bind(event.id)
      .all<EventMemberRow>()
  ).results;
  const currentById = new Map(currentMembers.map((member) => [member.id, member]));
  const groupMembers = (
    await c.env.DB.prepare("SELECT id, name, slack_user_id, slack_display_name, created_at FROM group_members WHERE group_id = ?")
      .bind(event.group_id)
      .all<GroupMemberRow>()
  ).results;
  const groupMemberMap = new Map(groupMembers.map((member) => [member.id, member]));
  const payers = (
    await c.env.DB.prepare("SELECT * FROM group_payers WHERE group_id = ? ORDER BY created_at ASC")
      .bind(event.group_id)
      .all<GroupPayerRow>()
  ).results;
  const selectedPayer = payerId ? payers.find((payer) => payer.id === payerId) : payers[0];
  if (payers.length && !selectedPayer) return jsonError("建て替え者が見つかりません", 404);

  const parsedMembers: {
    id: string | null;
    groupMemberId: string | null;
    name: string;
    slackUserId: string | null;
    slackDisplayName: string | null;
    memberType: "group" | "guest";
    amount: number;
  }[] = [];
  for (const item of members) {
    const row = asObject(item);
    const existingId = text(row?.id) || null;
    const groupMemberId = text(row?.groupMemberId) || null;
    const amount = intAmount(row?.amount);
    if (amount === null) return jsonError("金額は0以上の整数で入力してください");
    if (existingId && !currentById.has(existingId)) return jsonError("不正なイベントメンバーが含まれています");

    if (groupMemberId) {
      const groupMember = groupMemberMap.get(groupMemberId);
      if (!groupMember) return jsonError("不正なグループメンバーが含まれています");
      parsedMembers.push({
        id: existingId,
        groupMemberId,
        name: groupMember.name,
        slackUserId: groupMember.slack_user_id,
        slackDisplayName: groupMember.slack_display_name,
        memberType: "group",
        amount
      });
    } else {
      const name = text(row?.name);
      if (!name) return jsonError("追加メンバー名を入力してください");
      parsedMembers.push({
        id: existingId,
        groupMemberId: null,
        name,
        slackUserId: text(row?.slackUserId) || null,
        slackDisplayName: text(row?.slackDisplayName) || null,
        memberType: "guest",
        amount
      });
    }
  }
  const groupMemberIds = parsedMembers.filter((member) => member.groupMemberId).map((member) => member.groupMemberId);
  if (new Set(groupMemberIds).size !== groupMemberIds.length) return jsonError("同じグループメンバーが重複しています");

  const parsedLinks: { amount: number; url: string }[] = [];
  for (const item of paypayLinks) {
    const row = asObject(item);
    const amount = intAmount(row?.amount);
    const url = text(row?.url);
    if (amount === null || amount <= 0) return jsonError("PayPayリンクの金額が不正です");
    if (!url) continue;
    if (!validUrl(url)) return jsonError("PayPay支払いリンクのURL形式が不正です");
    parsedLinks.push({ amount, url });
  }
  if (new Set(parsedLinks.map((link) => link.amount)).size !== parsedLinks.length) {
    return jsonError("同じ金額のPayPay支払いリンクが重複しています");
  }
  const positiveAmounts = new Set(parsedMembers.filter((member) => member.amount > 0).map((member) => member.amount));
  if (parsedLinks.some((link) => !positiveAmounts.has(link.amount))) {
    return jsonError("対象金額にないPayPay支払いリンクが含まれています");
  }

  const updatedAt = nowIso();
  const incomingIds = new Set(parsedMembers.map((member) => member.id).filter(Boolean));
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare("UPDATE events SET payer_id = ?, title = ?, description = ?, updated_at = ? WHERE id = ?").bind(
      selectedPayer?.id ?? null,
      title,
      description,
      updatedAt,
      event.id
    ),
    ...currentMembers
      .filter((member) => !incomingIds.has(member.id))
      .map((member) => c.env.DB.prepare("DELETE FROM event_members WHERE id = ? AND event_id = ?").bind(member.id, event.id)),
    c.env.DB.prepare("DELETE FROM event_paypay_links WHERE event_id = ?").bind(event.id),
    ...parsedMembers.map((member) => {
      if (member.id) {
        const current = currentById.get(member.id);
        const amountChanged = current?.amount !== member.amount;
        return c.env.DB.prepare(
          `UPDATE event_members
           SET group_member_id = ?, name = ?, slack_user_id = ?, slack_display_name = ?, member_type = ?,
               amount = ?, status = ?, paid_at = ?, updated_at = ?
           WHERE id = ? AND event_id = ?`
        ).bind(
          member.groupMemberId,
          member.name,
          member.slackUserId,
          member.slackDisplayName,
          member.memberType,
          member.amount,
          amountChanged ? "unpaid" : current?.status ?? "unpaid",
          amountChanged ? null : current?.paid_at ?? null,
          updatedAt,
          member.id,
          event.id
        );
      }
      return c.env.DB.prepare(
        `INSERT INTO event_members
         (id, event_id, group_member_id, name, slack_user_id, slack_display_name, member_type, amount, status, paid_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', NULL, ?, ?)`
      ).bind(
        id(),
        event.id,
        member.groupMemberId,
        member.name,
        member.slackUserId,
        member.slackDisplayName,
        member.memberType,
        member.amount,
        updatedAt,
        updatedAt
      );
    }),
    ...parsedLinks.map((link) =>
      c.env.DB.prepare(
        "INSERT INTO event_paypay_links (id, event_id, amount, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(id(), event.id, link.amount, link.url, updatedAt, updatedAt)
    )
  ];
  await c.env.DB.batch(statements);

  const response = await buildEventResponse(c.env.DB, c.req.param("eventToken"));
  return c.json(response);
});

app.delete("/api/events/:eventToken", async (c) => {
  const event = await c.env.DB.prepare(
    `SELECT e.*, g.management_password_hash
     FROM events e
     JOIN groups g ON g.id = e.group_id
     WHERE e.public_token = ?`
  )
    .bind(c.req.param("eventToken"))
    .first<EventRow & { management_password_hash: string | null }>();
  if (!event) return jsonError("イベントが見つかりません", 404);
  const body = asObject(await c.req.json().catch(() => null));
  if (!(await passwordMatches(text(body?.managementPassword), event.management_password_hash))) {
    return jsonError("管理パスワードが違います", 403);
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM slack_notification_logs WHERE event_id = ?").bind(event.id),
    c.env.DB.prepare("DELETE FROM event_paypay_links WHERE event_id = ?").bind(event.id),
    c.env.DB.prepare("DELETE FROM event_members WHERE event_id = ?").bind(event.id),
    c.env.DB.prepare("DELETE FROM events WHERE id = ?").bind(event.id)
  ]);
  return c.json({ ok: true });
});

app.patch("/api/events/:eventToken/members/:memberId/status", async (c) => {
  const event = await c.env.DB.prepare("SELECT * FROM events WHERE public_token = ?")
    .bind(c.req.param("eventToken"))
    .first<EventRow>();
  if (!event) return jsonError("イベントが見つかりません", 404);

  const body = asObject(await c.req.json().catch(() => null));
  const status = text(body?.status);
  if (status !== "paid" && status !== "unpaid") return jsonError("statusが不正です");

  const member = await c.env.DB.prepare(
    "SELECT * FROM event_members WHERE id = ? AND event_id = ?"
  )
    .bind(c.req.param("memberId"), event.id)
    .first<EventMemberRow>();
  if (!member) return jsonError("メンバーが見つかりません", 404);
  if (member.amount <= 0) return jsonError("対象外メンバーは更新できません");

  const updatedAt = nowIso();
  await c.env.DB.prepare(
    "UPDATE event_members SET status = ?, paid_at = ?, updated_at = ? WHERE id = ?"
  )
    .bind(status, status === "paid" ? updatedAt : null, updatedAt, member.id)
    .run();

  if (status === "paid") await maybeNotifyCompletion(c.env, event.id);

  const response = await buildEventResponse(c.env.DB, c.req.param("eventToken"));
  return c.json(response);
});

async function runDailyReminders(env: Bindings) {
  if (!env.APP_BASE_URL) return;
  const { start, end } = jstDayBounds();
  const events = (
    await env.DB.prepare(
      `SELECT e.id, e.title, e.public_token
       FROM events e
       JOIN event_members em ON em.event_id = e.id
       JOIN groups g ON g.id = e.group_id
       WHERE em.amount > 0
         AND em.status = 'unpaid'
         AND g.slack_destination_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM slack_notification_logs l
           WHERE l.event_id = e.id
             AND l.notification_type = 'daily_reminder'
             AND l.success = 1
             AND l.sent_at >= ?
             AND l.sent_at < ?
         )
       GROUP BY e.id
       ORDER BY e.created_at ASC`
    )
      .bind(start, end)
      .all<Pick<EventRow, "id" | "title" | "public_token">>()
  ).results;

  for (const event of events) {
    const unpaid = (
      await env.DB.prepare(
        "SELECT name, slack_user_id, amount FROM event_members WHERE event_id = ? AND amount > 0 AND status = 'unpaid' ORDER BY created_at ASC"
      )
        .bind(event.id)
        .all<Pick<EventMemberRow, "name" | "slack_user_id" | "amount">>()
    ).results;
    await notifyEvent(
      env,
      event,
      "daily_reminder",
      unpaid.map(slackPaymentLine)
    );
  }
}

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(runDailyReminders(env));
  }
};
