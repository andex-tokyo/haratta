import { Hono } from "hono";
import { cors } from "hono/cors";

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_BASE_URL: string;
};

type GroupRow = {
  id: string;
  public_token: string;
  name: string;
  default_payee_name: string;
  default_paypay_info: string;
  slack_destination_id: string | null;
  slack_destination_name: string | null;
  slack_channel_name: string | null;
};

type EventRow = {
  id: string;
  group_id: string;
  public_token: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
};

type EventMemberRow = {
  id: string;
  event_id: string;
  group_member_id: string;
  name: string;
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
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("/api/*", cors());

const jsonError = (message: string, status = 400) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

const nowIso = () => new Date().toISOString();
const id = () => crypto.randomUUID();

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
    message = `💰「${event.title}」の精算です！\n\n支払い状況確認はこちら\n${eventUrl(env, event.public_token)}`;
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
      `SELECT e.*, g.name AS group_name, g.default_payee_name, g.default_paypay_info
       FROM events e
       JOIN groups g ON g.id = e.group_id
       WHERE e.public_token = ?`
    )
    .bind(eventToken)
    .first<
      EventRow & {
        group_name: string;
        default_payee_name: string;
        default_paypay_info: string;
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
    payeeName: event.default_payee_name,
    paypayInfo: event.default_paypay_info,
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
  if (!name || !channelName || !webhookUrl) return jsonError("必須項目を入力してください");
  if (!webhookUrl.startsWith("https://hooks.slack.com/")) {
    return jsonError("Slack Incoming Webhook URLを入力してください");
  }

  const createdAt = nowIso();
  const destinationId = id();
  await c.env.DB.prepare(
    `INSERT INTO slack_destinations
     (id, name, channel_name, webhook_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(destinationId, name, channelName, webhookUrl, createdAt, createdAt)
    .run();

  return c.json({ id: destinationId, name, channelName, createdAt, updatedAt: createdAt }, 201);
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

app.post("/api/groups", async (c) => {
  const body = asObject(await c.req.json().catch(() => null));
  if (!body) return jsonError("Invalid JSON");

  const name = text(body.name);
  const defaultPayeeName = text(body.defaultPayeeName);
  const defaultPaypayInfo = text(body.defaultPaypayInfo);
  const slackDestinationId = text(body.slackDestinationId) || null;
  const members = Array.isArray(body.members)
    ? body.members.map((member) => text(member)).filter(Boolean)
    : [];

  if (!name || !defaultPayeeName || !defaultPaypayInfo) {
    return jsonError("グループ名、支払先名、PayPay送金先情報を入力してください");
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
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO groups
       (id, public_token, name, default_payee_name, default_paypay_info, slack_destination_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      groupId,
      token,
      name,
      defaultPayeeName,
      defaultPaypayInfo,
      slackDestinationId,
      createdAt,
      createdAt
    ),
    ...members.map((memberName) =>
      c.env.DB.prepare(
        "INSERT INTO group_members (id, group_id, name, created_at) VALUES (?, ?, ?, ?)"
      ).bind(id(), groupId, memberName, createdAt)
    )
  ];
  await c.env.DB.batch(statements);

  return c.json({ id: groupId, publicToken: token, url: `/g/${token}` }, 201);
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
    await c.env.DB.prepare("SELECT id, name, created_at FROM group_members WHERE group_id = ?")
      .bind(group.id)
      .all<{ id: string; name: string; created_at: string }>()
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
  const memberAmounts = Array.isArray(body.memberAmounts) ? body.memberAmounts : [];
  const paypayLinks = Array.isArray(body.paypayLinks) ? body.paypayLinks : [];
  if (!title) return jsonError("イベント名を入力してください");
  if (memberAmounts.length < 1) return jsonError("メンバー金額を入力してください");

  const members = (
    await c.env.DB.prepare("SELECT id, name FROM group_members WHERE group_id = ?")
      .bind(group.id)
      .all<{ id: string; name: string }>()
  ).results;
  const memberMap = new Map(members.map((member) => [member.id, member]));
  const parsedAmounts: { memberId: string; amount: number }[] = [];
  for (const item of memberAmounts) {
    const row = asObject(item);
    const memberId = text(row?.memberId);
    const amount = intAmount(row?.amount);
    if (!memberMap.has(memberId)) return jsonError("不正なメンバーが含まれています");
    if (amount === null) return jsonError("金額は0以上の整数で入力してください");
    parsedAmounts.push({ memberId, amount });
  }
  if (new Set(parsedAmounts.map((item) => item.memberId)).size !== members.length) {
    return jsonError("すべてのメンバーの金額を入力してください");
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
    `INSERT INTO events (id, group_id, public_token, title, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(eventId, group.id, token, title, description, createdAt, createdAt);
  const memberStatements = parsedAmounts.map((item) => {
    const member = memberMap.get(item.memberId);
    return c.env.DB.prepare(
      `INSERT INTO event_members
       (id, event_id, group_member_id, name, amount, status, paid_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'unpaid', NULL, ?, ?)`
    ).bind(id(), eventId, item.memberId, member?.name ?? "", item.amount, createdAt, createdAt);
  });
  const linkStatements = parsedLinks.map((link) =>
    c.env.DB.prepare(
      `INSERT INTO event_paypay_links (id, event_id, amount, url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id(), eventId, link.amount, link.url, createdAt, createdAt)
  );
  await c.env.DB.batch([eventStatement, ...memberStatements, ...linkStatements]);

  await notifyEvent(c.env, { id: eventId, title, public_token: token }, "initial");

  return c.json({ id: eventId, publicToken: token, url: `/e/${token}` }, 201);
});

app.get("/api/events/:eventToken", async (c) => {
  const response = await buildEventResponse(c.env.DB, c.req.param("eventToken"));
  if (!response) return jsonError("イベントが見つかりません", 404);
  return c.json(response);
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
        "SELECT name FROM event_members WHERE event_id = ? AND amount > 0 AND status = 'unpaid' ORDER BY created_at ASC"
      )
        .bind(event.id)
        .all<{ name: string }>()
    ).results;
    await notifyEvent(
      env,
      event,
      "daily_reminder",
      unpaid.map((member) => member.name)
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
