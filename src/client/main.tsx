import {
  ArrowLeft,
  Bell,
  Check,
  ChevronRight,
  Clipboard,
  ExternalLink,
  Plus,
  RotateCcw,
  Send,
  Users
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type SlackDestination = {
  id: string;
  name: string;
  channelName: string;
};

type Group = {
  id: string;
  publicToken: string;
  name: string;
  defaultPayeeName: string;
  defaultPaypayInfo: string;
  slackDestination: SlackDestination | null;
  members: { id: string; name: string }[];
  events: {
    id: string;
    publicToken: string;
    title: string;
    description: string;
    payableCount: number;
    paidCount: number;
  }[];
};

type EventDetail = {
  publicToken: string;
  title: string;
  description: string;
  groupName: string;
  payeeName: string;
  paypayInfo: string;
  summary: {
    totalAmount: number;
    payableCount: number;
    paidCount: number;
    unpaidCount: number;
  };
  members: {
    id: string;
    groupMemberId: string;
    name: string;
    amount: number;
    status: "unpaid" | "paid";
    paidAt: string | null;
    paypayLink: string | null;
  }[];
  paypayLinks: { amount: number; url: string }[];
};

type Draft = {
  step: 1 | 2 | 3;
  title: string;
  description: string;
  amountMode: "same" | "individual";
  sameAmount: number;
  memberAmounts: Record<string, number>;
  paypayLinks: Record<string, string>;
};

const yen = new Intl.NumberFormat("ja-JP");
const defaultDraft: Draft = {
  step: 1,
  title: "",
  description: "",
  amountMode: "same",
  sameAmount: 0,
  memberAmounts: {},
  paypayLinks: {}
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "通信に失敗しました" }));
    const errorBody = body && typeof body === "object" ? (body as { error?: string }) : {};
    throw new Error(errorBody.error ?? "通信に失敗しました");
  }
  return response.json();
}

function path() {
  return window.location.pathname;
}

function go(to: string) {
  window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function App() {
  const [route, setRoute] = useState(path());
  useEffect(() => {
    const onPop = () => setRoute(path());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  if (route === "/slack-destinations") return <SlackDestinations />;
  if (route === "/slack-destinations/new") return <NewSlackDestination />;
  if (route === "/groups/new") return <NewGroup />;
  if (route.startsWith("/g/")) return <GroupDetail token={route.split("/")[2]} />;
  if (route.startsWith("/e/")) return <EventPage token={route.split("/")[2]} />;
  return <Home />;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-8">
        {children}
      </div>
    </main>
  );
}

function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const styles = {
    primary: "bg-leaf text-white hover:bg-ink",
    secondary: "border border-line bg-white text-ink hover:border-leaf",
    ghost: "text-ink hover:bg-mint",
    danger: "border border-coral bg-white text-coral hover:bg-coral hover:text-white"
  };
  return (
    <button
      className={`focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  children,
  hint
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-semibold text-ink">
      {label}
      {children}
      {hint ? <span className="text-xs font-normal text-ink/60">{hint}</span> : null}
    </label>
  );
}

function inputClass() {
  return "focus-ring min-h-11 rounded-lg border border-line bg-white px-3 py-2 text-base text-ink placeholder:text-ink/40";
}

function Home() {
  return (
    <Shell>
      <section className="flex min-h-[72vh] flex-col justify-between gap-8">
        <div className="pt-10">
          <p className="mb-3 text-sm font-bold text-leaf">誰が払ったか、もう迷わない。</p>
          <h1 className="text-5xl font-black tracking-normal text-ink sm:text-6xl">ハラッタ？</h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-ink/70">
            PayPay支払いリンクを金額ごとにまとめて、未払いの確認、支払い済み更新、Slack通知まで身内でさっと回せます。
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button onClick={() => go("/groups/new")} className="justify-between">
            <span className="inline-flex items-center gap-2">
              <Users size={18} /> グループを作成
            </span>
            <ChevronRight size={18} />
          </Button>
          <Button variant="secondary" onClick={() => go("/slack-destinations/new")} className="justify-between">
            <span className="inline-flex items-center gap-2">
              <Bell size={18} /> Slack通知先を登録
            </span>
            <ChevronRight size={18} />
          </Button>
          <Button variant="ghost" onClick={() => go("/slack-destinations")} className="sm:col-span-2">
            通知先一覧を見る
          </Button>
        </div>
      </section>
    </Shell>
  );
}

function SlackDestinations() {
  const [items, setItems] = useState<SlackDestination[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api<SlackDestination[]>("/api/slack-destinations").then(setItems).catch((e) => setError(e.message));
  }, []);
  return (
    <Shell>
      <TopBar title="Slack通知先" />
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border border-line bg-white p-4 shadow-soft">
            <p className="font-bold">{item.name}</p>
            <p className="mt-1 text-sm text-ink/60">{item.channelName}</p>
          </div>
        ))}
        {items.length === 0 ? <Empty text="通知先はまだ登録されていません。" /> : null}
      </div>
      <Button onClick={() => go("/slack-destinations/new")}>
        <Plus size={18} /> 通知先を追加
      </Button>
    </Shell>
  );
}

function NewSlackDestination() {
  const [form, setForm] = useState({ name: "", channelName: "", webhookUrl: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api("/api/slack-destinations", { method: "POST", body: JSON.stringify(form) });
      go("/slack-destinations");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <Shell>
      <TopBar title="Slack通知先登録" />
      <form className="grid gap-4" onSubmit={submit}>
        {error ? <Alert>{error}</Alert> : null}
        <Field label="通知先表示名">
          <input className={inputClass()} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Slackチャンネル名">
          <input className={inputClass()} placeholder="#paypay" value={form.channelName} onChange={(e) => setForm({ ...form, channelName: e.target.value })} />
        </Field>
        <Field label="Incoming Webhook URL" hint="保存後、このURLは画面に表示しません。">
          <input className={inputClass()} value={form.webhookUrl} onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })} />
        </Field>
        <Button disabled={loading}>
          <Check size={18} /> 登録
        </Button>
      </form>
    </Shell>
  );
}

function NewGroup() {
  const [destinations, setDestinations] = useState<SlackDestination[]>([]);
  const [form, setForm] = useState({
    name: "",
    members: "",
    defaultPayeeName: "",
    defaultPaypayInfo: "",
    slackDestinationId: ""
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    api<SlackDestination[]>("/api/slack-destinations").then(setDestinations).catch(() => undefined);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await api<{ url: string }>("/api/groups", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          members: form.members.split(/\n|,/).map((v) => v.trim()).filter(Boolean)
        })
      });
      go(result.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell>
      <TopBar title="グループ作成" />
      <form className="grid gap-4" onSubmit={submit}>
        {error ? <Alert>{error}</Alert> : null}
        <Field label="グループ名">
          <input className={inputClass()} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="メンバー一覧" hint="改行またはカンマ区切りで入力できます。">
          <textarea className={`${inputClass()} min-h-28`} value={form.members} onChange={(e) => setForm({ ...form, members: e.target.value })} />
        </Field>
        <Field label="支払先名">
          <input className={inputClass()} value={form.defaultPayeeName} onChange={(e) => setForm({ ...form, defaultPayeeName: e.target.value })} />
        </Field>
        <Field label="PayPay送金先情報">
          <textarea className={`${inputClass()} min-h-24`} value={form.defaultPaypayInfo} onChange={(e) => setForm({ ...form, defaultPaypayInfo: e.target.value })} />
        </Field>
        <Field label="Slack通知先">
          <select className={inputClass()} value={form.slackDestinationId} onChange={(e) => setForm({ ...form, slackDestinationId: e.target.value })}>
            <option value="">通知しない</option>
            {destinations.map((destination) => (
              <option key={destination.id} value={destination.id}>
                {destination.name} ({destination.channelName})
              </option>
            ))}
          </select>
        </Field>
        <Button disabled={loading}>
          <Check size={18} /> 作成
        </Button>
      </form>
    </Shell>
  );
}

function GroupDetail({ token }: { token: string }) {
  const [group, setGroup] = useState<Group | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const load = () => api<Group>(`/api/groups/${token}`).then(setGroup).catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [token]);
  if (!group) {
    return (
      <Shell>
        <TopBar title="グループ" />
        {error ? <Alert>{error}</Alert> : <Empty text="読み込み中です。" />}
      </Shell>
    );
  }
  return (
    <Shell>
      <TopBar title={group.name} />
      {creating ? (
        <EventWizard group={group} onCreated={(url) => go(url)} onCancel={() => setCreating(false)} />
      ) : (
        <>
          <section className="grid gap-3 rounded-lg border border-line bg-white p-4 shadow-soft">
            <p className="text-sm text-ink/60">支払先</p>
            <p className="font-bold">{group.defaultPayeeName}</p>
            <p className="whitespace-pre-wrap text-sm text-ink/70">{group.defaultPaypayInfo}</p>
            <p className="text-sm text-ink/60">Slack: {group.slackDestination ? `${group.slackDestination.name} (${group.slackDestination.channelName})` : "未設定"}</p>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-bold text-ink/70">メンバー</h2>
            <div className="flex flex-wrap gap-2">
              {group.members.map((member) => (
                <span className="rounded-full border border-line bg-white px-3 py-1 text-sm" key={member.id}>
                  {member.name}
                </span>
              ))}
            </div>
          </section>
          <Button onClick={() => setCreating(true)}>
            <Plus size={18} /> 新規イベント作成
          </Button>
          <section className="grid gap-3">
            <h2 className="text-sm font-bold text-ink/70">イベント</h2>
            {group.events.map((event) => (
              <button key={event.id} onClick={() => go(`/e/${event.publicToken}`)} className="focus-ring flex items-center justify-between rounded-lg border border-line bg-white p-4 text-left shadow-soft">
                <span>
                  <span className="block font-bold">{event.title}</span>
                  <span className="mt-1 block text-sm text-ink/60">
                    {event.paidCount}/{event.payableCount} 支払い済み
                  </span>
                </span>
                <ChevronRight size={20} />
              </button>
            ))}
            {group.events.length === 0 ? <Empty text="イベントはまだありません。" /> : null}
          </section>
        </>
      )}
    </Shell>
  );
}

function EventWizard({
  group,
  onCreated,
  onCancel
}: {
  group: Group;
  onCreated: (url: string) => void;
  onCancel: () => void;
}) {
  const storageKey = `haratta:event-draft:${group.publicToken}`;
  const [draft, setDraft] = useState<Draft>(() => {
    const saved = localStorage.getItem(storageKey);
    return saved ? { ...defaultDraft, ...JSON.parse(saved) } : defaultDraft;
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft, storageKey]);

  const amounts = useMemo(() => {
    return group.members.map((member) => ({
      memberId: member.id,
      name: member.name,
      amount: draft.amountMode === "same" ? Number(draft.sameAmount || 0) : Number(draft.memberAmounts[member.id] || 0)
    }));
  }, [draft, group.members]);
  const positiveAmounts = [...new Set(amounts.filter((item) => item.amount > 0).map((item) => item.amount))].sort((a, b) => a - b);

  async function create() {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ url: string }>(`/api/groups/${group.publicToken}/events`, {
        method: "POST",
        body: JSON.stringify({
          title: draft.title,
          description: draft.description,
          amountMode: draft.amountMode,
          memberAmounts: amounts.map((item) => ({ memberId: item.memberId, amount: item.amount })),
          paypayLinks: positiveAmounts
            .map((amount) => ({ amount, url: draft.paypayLinks[String(amount)]?.trim() ?? "" }))
            .filter((link) => link.url)
        })
      });
      localStorage.removeItem(storageKey);
      onCreated(result.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="grid gap-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-black">イベント作成</h2>
        <Button variant="ghost" onClick={onCancel}>
          閉じる
        </Button>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid grid-cols-3 gap-2">
        {[1, 2, 3].map((step) => (
          <div key={step} className={`h-2 rounded-full ${draft.step >= step ? "bg-leaf" : "bg-line"}`} />
        ))}
      </div>

      {draft.step === 1 ? (
        <div className="grid gap-4">
          <Field label="イベント名">
            <input className={inputClass()} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="説明">
            <textarea className={`${inputClass()} min-h-20`} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-white p-1">
            <Button type="button" variant={draft.amountMode === "same" ? "primary" : "ghost"} onClick={() => setDraft({ ...draft, amountMode: "same" })}>
              全員同額
            </Button>
            <Button type="button" variant={draft.amountMode === "individual" ? "primary" : "ghost"} onClick={() => setDraft({ ...draft, amountMode: "individual" })}>
              個別金額
            </Button>
          </div>
          {draft.amountMode === "same" ? (
            <Field label="全員の金額">
              <input type="number" min={0} className={inputClass()} value={draft.sameAmount || ""} onChange={(e) => setDraft({ ...draft, sameAmount: Number(e.target.value) })} />
            </Field>
          ) : (
            <div className="grid gap-3">
              {group.members.map((member) => (
                <Field label={member.name} key={member.id}>
                  <input
                    type="number"
                    min={0}
                    className={inputClass()}
                    value={draft.memberAmounts[member.id] || ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        memberAmounts: { ...draft.memberAmounts, [member.id]: Number(e.target.value) }
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          )}
          <Button type="button" onClick={() => setDraft({ ...draft, step: 2 })}>
            次へ
          </Button>
        </div>
      ) : null}

      {draft.step === 2 ? (
        <div className="grid gap-4">
          {positiveAmounts.map((amount) => {
            const targets = amounts.filter((item) => item.amount === amount).map((item) => item.name);
            return (
              <div key={amount} className="grid gap-3 rounded-lg border border-line bg-white p-4 shadow-soft">
                <div>
                  <p className="text-lg font-black">{yen.format(amount)}円用リンク</p>
                  <p className="mt-1 text-sm text-ink/60">対象: {targets.join("、")}</p>
                </div>
                <Button type="button" variant="secondary" onClick={() => navigator.clipboard.writeText(String(amount))}>
                  <Clipboard size={18} /> {yen.format(amount)}円をコピー
                </Button>
                <Field label="PayPay支払いリンクを貼る" hint="リンク登録は任意です。登録すると、支払う人がPayPayへ進みやすくなります。">
                  <input
                    className={inputClass()}
                    value={draft.paypayLinks[String(amount)] ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        paypayLinks: { ...draft.paypayLinks, [String(amount)]: e.target.value }
                      })
                    }
                  />
                </Field>
                {draft.paypayLinks[String(amount)] ? (
                  <a className="text-sm font-bold text-leaf underline" href={draft.paypayLinks[String(amount)]} target="_blank" rel="noreferrer">
                    リンクを開いて確認
                  </a>
                ) : null}
              </div>
            );
          })}
          {positiveAmounts.length === 0 ? <Empty text="1円以上の対象者がいません。" /> : null}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" onClick={() => setDraft({ ...draft, step: 1 })}>
              戻る
            </Button>
            <Button type="button" onClick={() => setDraft({ ...draft, step: 3 })}>
              次へ
            </Button>
          </div>
        </div>
      ) : null}

      {draft.step === 3 ? (
        <div className="grid gap-4">
          <div className="rounded-lg border border-line bg-white p-4">
            <p className="font-black">{draft.title || "イベント名未入力"}</p>
            <p className="mt-2 text-sm text-ink/60">{positiveAmounts.length}種類のPayPay支払いリンク</p>
          </div>
          <Button disabled={loading} onClick={create}>
            <Send size={18} /> イベントを作成してSlack通知
          </Button>
          <Button variant="secondary" onClick={() => setDraft({ ...draft, step: 2 })}>
            戻る
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function EventPage({ token }: { token: string }) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState("");
  const load = () => api<EventDetail>(`/api/events/${token}`).then(setEvent).catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [token]);

  async function update(memberId: string, status: "paid" | "unpaid") {
    setError("");
    try {
      const updated = await api<EventDetail>(`/api/events/${token}/members/${memberId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      setEvent(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!event) {
    return (
      <Shell>
        <TopBar title="イベント" />
        {error ? <Alert>{error}</Alert> : <Empty text="読み込み中です。" />}
      </Shell>
    );
  }

  return (
    <Shell>
      <TopBar title={event.title} />
      {error ? <Alert>{error}</Alert> : null}
      <section className="rounded-lg border border-line bg-white p-4 shadow-soft">
        <p className="text-sm font-bold text-leaf">{event.groupName}</p>
        <h1 className="mt-2 text-3xl font-black">{event.title}</h1>
        {event.description ? <p className="mt-3 whitespace-pre-wrap text-ink/70">{event.description}</p> : null}
        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          <Metric label="合計" value={`${yen.format(event.summary.totalAmount)}円`} />
          <Metric label="支払済" value={`${event.summary.paidCount}`} />
          <Metric label="未払い" value={`${event.summary.unpaidCount}`} />
        </div>
      </section>

      <section className="grid gap-3">
        {event.members.map((member) => (
          <div key={member.id} className="grid gap-3 rounded-lg border border-line bg-white p-4 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-black">{member.name}</p>
                <p className="text-sm text-ink/60">{member.amount > 0 ? `${yen.format(member.amount)}円` : "対象外"}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${member.amount <= 0 ? "bg-line text-ink/60" : member.status === "paid" ? "bg-mint text-leaf" : "bg-coral/10 text-coral"}`}>
                {member.amount <= 0 ? "対象外" : member.status === "paid" ? "支払い済み" : "未払い"}
              </span>
            </div>
            {member.amount > 0 && member.status === "unpaid" ? (
              <>
                {member.paypayLink ? (
                  <a href={member.paypayLink} target="_blank" rel="noreferrer" className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-leaf px-4 py-2 text-sm font-bold text-white">
                    <ExternalLink size={18} /> PayPayで支払う
                  </a>
                ) : null}
                {member.paypayLink ? <p className="text-sm font-bold text-ink/70">リンクが使えない場合</p> : null}
                <div className="rounded-lg bg-paper p-3">
                  <p className="text-xs font-bold text-ink/60">PayPay送金先情報</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{`${event.payeeName}\n${event.paypayInfo}`}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => navigator.clipboard.writeText(`${event.payeeName}\n${event.paypayInfo}`)}>
                    <Clipboard size={18} /> コピー
                  </Button>
                  <Button variant="secondary" onClick={() => navigator.clipboard.writeText(String(member.amount))}>
                    <Clipboard size={18} /> {yen.format(member.amount)}円
                  </Button>
                </div>
                <Button onClick={() => update(member.id, "paid")}>
                  <Check size={18} /> 支払いました
                </Button>
              </>
            ) : null}
            {member.amount > 0 && member.status === "paid" ? (
              <Button variant="danger" onClick={() => update(member.id, "unpaid")}>
                <RotateCcw size={18} /> 未払いに戻す
              </Button>
            ) : null}
          </div>
        ))}
      </section>
    </Shell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-paper p-3">
      <p className="text-xs font-bold text-ink/50">{label}</p>
      <p className="mt-1 font-black">{value}</p>
    </div>
  );
}

function TopBar({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3">
      <Button variant="ghost" className="w-11 px-0" onClick={() => (window.history.length > 1 ? window.history.back() : go("/"))} aria-label="戻る">
        <ArrowLeft size={20} />
      </Button>
      <p className="min-w-0 truncate text-xl font-black">{title}</p>
    </div>
  );
}

function Alert({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-coral bg-coral/10 p-3 text-sm font-semibold text-coral">{children}</div>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink/60">{text}</div>;
}

createRoot(document.getElementById("root")!).render(<App />);
