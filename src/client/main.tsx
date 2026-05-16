import {
  ArrowLeft,
  Bell,
  Building2,
  Check,
  ChevronRight,
  Clipboard,
  CreditCard,
  ExternalLink,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  UserPlus,
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

type SlackUser = {
  id: string;
  name: string;
  handle: string;
  email: string;
};

type MemberInput = {
  key: string;
  name: string;
  slackUserId: string;
  slackDisplayName: string;
};

type Group = {
  id: string;
  publicToken: string;
  name: string;
  defaultPayeeName: string;
  defaultPaypayInfo: string;
  defaultBankInfo: string;
  managementPasswordSet: boolean;
  slackDestination: SlackDestination | null;
  members: { id: string; name: string; slackUserId: string | null; slackDisplayName: string | null }[];
  events: {
    id: string;
    publicToken: string;
    title: string;
    description: string;
    payableCount: number;
    paidCount: number;
  }[];
};

type GroupListItem = {
  publicToken: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  eventCount: number;
};

type RecentGroup = {
  token: string;
  name: string;
  savedAt: string;
};

type EventDetail = {
  publicToken: string;
  title: string;
  description: string;
  groupName: string;
  payeeName: string;
  paypayInfo: string;
  bankInfo: string;
  summary: {
    totalAmount: number;
    payableCount: number;
    paidCount: number;
    unpaidCount: number;
  };
  members: {
    id: string;
    groupMemberId: string | null;
    name: string;
    slackUserId: string | null;
    slackDisplayName: string | null;
    memberType: "group" | "guest";
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
  selectedMemberIds: Record<string, boolean>;
  extraMembers: MemberInput[];
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
  selectedMemberIds: {},
  extraMembers: [],
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

function recentGroups() {
  try {
    return JSON.parse(localStorage.getItem("haratta:recent-groups") ?? "[]") as RecentGroup[];
  } catch {
    return [];
  }
}

function saveRecentGroup(group: Pick<Group, "publicToken" | "name">) {
  const next = [
    { token: group.publicToken, name: group.name, savedAt: new Date().toISOString() },
    ...recentGroups().filter((item) => item.token !== group.publicToken)
  ].slice(0, 8);
  localStorage.setItem("haratta:recent-groups", JSON.stringify(next));
}

function groupTokenFromInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[0] === "g" ? parts[1] ?? "" : "";
  } catch {
    return trimmed.replace(/^\/?g\//, "");
  }
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
  if (route === "/groups") return <GroupsList />;
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
  const [groupInput, setGroupInput] = useState("");
  const [recent, setRecent] = useState<RecentGroup[]>(() => recentGroups());
  function openGroup(event: FormEvent) {
    event.preventDefault();
    const token = groupTokenFromInput(groupInput);
    if (token) go(`/g/${token}`);
  }
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
          <Button variant="secondary" onClick={() => go("/groups")} className="sm:col-span-2">
            <Users size={18} /> グループ一覧を見る
          </Button>
        </div>
        <form className="grid gap-2 rounded-lg border border-line bg-white p-4 shadow-soft" onSubmit={openGroup}>
          <Field label="作成済みグループを開く" hint="グループURL、または /g/ の後ろのトークンを貼り付けます。">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input className={inputClass()} value={groupInput} onChange={(e) => setGroupInput(e.target.value)} placeholder="https://haratta.andex.tokyo/g/..." />
              <Button type="submit" variant="secondary">開く</Button>
            </div>
          </Field>
          {recent.length ? (
            <div className="mt-2 grid gap-2">
              <p className="text-xs font-bold text-ink/50">最近開いたグループ</p>
              {recent.map((item) => (
                <button key={item.token} type="button" className="focus-ring flex items-center justify-between rounded-lg bg-paper px-3 py-2 text-left text-sm" onClick={() => go(`/g/${item.token}`)}>
                  <span className="truncate font-bold">{item.name}</span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          ) : null}
        </form>
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

function GroupsList() {
  const [items, setItems] = useState<GroupListItem[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api<GroupListItem[]>("/api/groups").then(setItems).catch((e) => setError(e.message));
  }, []);

  return (
    <Shell>
      <TopBar title="グループ一覧" />
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-3">
        {items.map((item) => (
          <button
            key={item.publicToken}
            onClick={() => go(`/g/${item.publicToken}`)}
            className="focus-ring flex items-center justify-between gap-3 rounded-lg border border-line bg-white p-4 text-left shadow-soft"
          >
            <span className="min-w-0">
              <span className="block truncate text-lg font-black">{item.name}</span>
              <span className="mt-1 block text-sm text-ink/60">
                メンバー {item.memberCount}人 / イベント {item.eventCount}件
              </span>
              <span className="mt-1 block text-xs text-ink/40">
                更新: {new Date(item.updatedAt).toLocaleString("ja-JP")}
              </span>
            </span>
            <ChevronRight size={20} />
          </button>
        ))}
        {items.length === 0 ? <Empty text="グループはまだありません。" /> : null}
      </div>
      <Button onClick={() => go("/groups/new")}>
        <Plus size={18} /> グループを作成
      </Button>
    </Shell>
  );
}

function NewSlackDestination() {
  const [form, setForm] = useState({ name: "", channelName: "", webhookUrl: "", botToken: "" });
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
        <Field label="Bot User OAuth Token（任意）" hint="Slackユーザー選択とメンションに使います。users:read 権限の xoxb- トークンを入れてください。">
          <input className={inputClass()} placeholder="xoxb-..." value={form.botToken} onChange={(e) => setForm({ ...form, botToken: e.target.value })} />
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
  const [slackUsers, setSlackUsers] = useState<SlackUser[]>([]);
  const [manualName, setManualName] = useState("");
  const [form, setForm] = useState({
    name: "",
    defaultPayeeName: "",
    defaultPaypayInfo: "",
    defaultBankInfo: "",
    managementPassword: "",
    slackDestinationId: ""
  });
  const [members, setMembers] = useState<MemberInput[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    api<SlackDestination[]>("/api/slack-destinations").then(setDestinations).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!form.slackDestinationId) {
      setSlackUsers([]);
      return;
    }
    api<SlackUser[]>(`/api/slack-destinations/${form.slackDestinationId}/users`)
      .then(setSlackUsers)
      .catch(() => setSlackUsers([]));
  }, [form.slackDestinationId]);

  function addMember(member: MemberInput) {
    setMembers((current) => {
      if (member.slackUserId && current.some((item) => item.slackUserId === member.slackUserId)) return current;
      if (!member.slackUserId && current.some((item) => item.name === member.name)) return current;
      return [...current, member];
    });
  }

  function addManualMember() {
    const name = manualName.trim();
    if (!name) return;
    addMember({ key: crypto.randomUUID(), name, slackUserId: "", slackDisplayName: "" });
    setManualName("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await api<{ url: string }>("/api/groups", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          members: members.map((member) => ({
            name: member.name,
            slackUserId: member.slackUserId || null,
            slackDisplayName: member.slackDisplayName || null
          }))
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
        <Field label="管理パスワード" hint="グループ編集・削除に使います。6文字以上。参加者の支払い操作には不要です。">
          <input type="password" className={inputClass()} value={form.managementPassword} onChange={(e) => setForm({ ...form, managementPassword: e.target.value })} />
        </Field>
        <Field label="Slack通知先">
          <select className={inputClass()} value={form.slackDestinationId} onChange={(e) => setForm({ ...form, slackDestinationId: e.target.value })}>
            <option value="">通知しない / Slackユーザー選択なし</option>
            {destinations.map((destination) => (
              <option key={destination.id} value={destination.id}>
                {destination.name} ({destination.channelName})
              </option>
            ))}
          </select>
        </Field>

        <section className="grid gap-3 rounded-lg border border-line bg-white p-4 shadow-soft">
          <div>
            <h2 className="font-black">メンバー</h2>
            <p className="mt-1 text-sm text-ink/60">Slackユーザーを選ぶか、Slackにいない人は名前で追加します。</p>
          </div>
          {slackUsers.length ? (
            <div className="grid max-h-64 gap-2 overflow-auto rounded-lg bg-paper p-2">
              {slackUsers.map((user) => (
                <button
                  type="button"
                  key={user.id}
                  className="focus-ring flex items-center justify-between rounded-lg bg-white px-3 py-2 text-left text-sm"
                  onClick={() =>
                    addMember({
                      key: user.id,
                      name: user.name,
                      slackUserId: user.id,
                      slackDisplayName: user.name
                    })
                  }
                >
                  <span>
                    <span className="block font-bold">{user.name}</span>
                    <span className="text-xs text-ink/50">{user.handle ? `@${user.handle}` : user.email}</span>
                  </span>
                  <UserPlus size={18} />
                </button>
              ))}
            </div>
          ) : form.slackDestinationId ? (
            <p className="rounded-lg bg-paper p-3 text-sm text-ink/60">Bot token未設定、またはSlackユーザーを取得できません。手入力で追加できます。</p>
          ) : null}
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input className={inputClass()} placeholder="Slackにいない人の名前" value={manualName} onChange={(e) => setManualName(e.target.value)} />
            <Button type="button" variant="secondary" onClick={addManualMember}>
              <Plus size={18} />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {members.map((member) => (
              <span key={member.key} className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-sm">
                {member.name}
                {member.slackUserId ? <span className="text-xs text-leaf">Slack</span> : null}
                <button type="button" onClick={() => setMembers((current) => current.filter((item) => item.key !== member.key))} aria-label={`${member.name}を削除`}>
                  <Trash2 size={14} />
                </button>
              </span>
            ))}
          </div>
        </section>

        <Field label="受取人名">
          <input className={inputClass()} value={form.defaultPayeeName} onChange={(e) => setForm({ ...form, defaultPayeeName: e.target.value })} />
        </Field>
        <Field label="PayPay送金先情報" hint="PayPay ID、電話番号、PayPayプロフィールURLなど、リンクが使えない時に送金先を特定できる情報を入れます。">
          <textarea className={`${inputClass()} min-h-24`} value={form.defaultPaypayInfo} onChange={(e) => setForm({ ...form, defaultPaypayInfo: e.target.value })} />
        </Field>
        <Field label="振込先情報（任意）" hint="銀行振込も受け付ける場合だけ入力します。銀行名、支店、種別、口座番号、名義など。">
          <textarea className={`${inputClass()} min-h-24`} value={form.defaultBankInfo} onChange={(e) => setForm({ ...form, defaultBankInfo: e.target.value })} />
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
  const [managing, setManaging] = useState(false);
  const load = () =>
    api<Group>(`/api/groups/${token}`)
      .then((loaded) => {
        setGroup(loaded);
        saveRecentGroup(loaded);
      })
      .catch((e) => setError(e.message));
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
      ) : managing ? (
        <GroupManage group={group} onSaved={() => void load()} onDeleted={() => go("/")} onCancel={() => setManaging(false)} />
      ) : (
        <>
          <section className="grid gap-3 rounded-lg border border-line bg-white p-4 shadow-soft">
            <p className="text-sm text-ink/60">受取人</p>
            <p className="font-bold">{group.defaultPayeeName}</p>
            {group.defaultPaypayInfo ? (
              <div className="rounded-lg bg-paper p-3">
                <p className="mb-1 flex items-center gap-2 text-xs font-bold text-ink/60">
                  <CreditCard size={14} /> PayPay送金先情報
                </p>
                <p className="whitespace-pre-wrap text-sm text-ink/70">{group.defaultPaypayInfo}</p>
              </div>
            ) : null}
            {group.defaultBankInfo ? (
              <div className="rounded-lg bg-paper p-3">
                <p className="mb-1 flex items-center gap-2 text-xs font-bold text-ink/60">
                  <Building2 size={14} /> 振込先情報
                </p>
                <p className="whitespace-pre-wrap text-sm text-ink/70">{group.defaultBankInfo}</p>
              </div>
            ) : null}
            <p className="text-sm text-ink/60">Slack: {group.slackDestination ? `${group.slackDestination.name} (${group.slackDestination.channelName})` : "未設定"}</p>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-bold text-ink/70">メンバー</h2>
            <div className="flex flex-wrap gap-2">
              {group.members.map((member) => (
                <span className="rounded-full border border-line bg-white px-3 py-1 text-sm" key={member.id}>
                  {member.name}
                  {member.slackUserId ? <span className="ml-2 text-xs text-leaf">Slack</span> : null}
                </span>
              ))}
            </div>
          </section>
          <Button onClick={() => setCreating(true)}>
            <Plus size={18} /> 新規イベント作成
          </Button>
          <Button variant="secondary" onClick={() => setManaging(true)}>
            グループを編集・削除
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
  const [slackUsers, setSlackUsers] = useState<SlackUser[]>([]);
  const [extraName, setExtraName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft, storageKey]);
  useEffect(() => {
    if (Object.keys(draft.selectedMemberIds).length) return;
    setDraft((current) => ({
      ...current,
      selectedMemberIds: Object.fromEntries(group.members.map((member) => [member.id, true]))
    }));
  }, [draft.selectedMemberIds, group.members]);
  useEffect(() => {
    if (!group.slackDestination?.id) return;
    api<SlackUser[]>(`/api/slack-destinations/${group.slackDestination.id}/users`)
      .then(setSlackUsers)
      .catch(() => setSlackUsers([]));
  }, [group.slackDestination?.id]);

  const amounts = useMemo(() => {
    const groupRows = group.members
      .filter((member) => draft.selectedMemberIds[member.id])
      .map((member) => ({
        key: member.id,
        memberId: member.id,
        name: member.name,
        slackUserId: member.slackUserId,
        slackDisplayName: member.slackDisplayName,
        amount:
          draft.amountMode === "same"
            ? Number(draft.sameAmount || 0)
            : Number(draft.memberAmounts[member.id] || 0)
      }));
    const guestRows = draft.extraMembers.map((member) => ({
      key: member.key,
      memberId: null,
      name: member.name,
      slackUserId: member.slackUserId || null,
      slackDisplayName: member.slackDisplayName || null,
      amount:
        draft.amountMode === "same"
          ? Number(draft.sameAmount || 0)
          : Number(draft.memberAmounts[member.key] || 0)
    }));
    return [...groupRows, ...guestRows];
  }, [draft, group.members]);
  const positiveAmounts = [...new Set(amounts.filter((item) => item.amount > 0).map((item) => item.amount))].sort((a, b) => a - b);

  function addExtra(member: MemberInput) {
    setDraft((current) => {
      if (member.slackUserId && current.extraMembers.some((item) => item.slackUserId === member.slackUserId)) return current;
      if (!member.slackUserId && current.extraMembers.some((item) => item.name === member.name)) return current;
      return { ...current, extraMembers: [...current.extraMembers, member] };
    });
  }

  function addManualExtra() {
    const name = extraName.trim();
    if (!name) return;
    addExtra({ key: crypto.randomUUID(), name, slackUserId: "", slackDisplayName: "" });
    setExtraName("");
  }

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
          memberAmounts: amounts
            .filter((item) => item.memberId)
            .map((item) => ({ memberId: item.memberId, amount: item.amount })),
          extraMembers: amounts
            .filter((item) => !item.memberId)
            .map((item) => ({
              name: item.name,
              slackUserId: item.slackUserId,
              slackDisplayName: item.slackDisplayName,
              amount: item.amount
            })),
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
          <section className="grid gap-3 rounded-lg border border-line bg-white p-4">
            <div>
              <h3 className="font-black">参加メンバー</h3>
              <p className="mt-1 text-sm text-ink/60">グループから今回の対象者を選び、必要なら今回だけのメンバーを追加します。</p>
            </div>
            <div className="grid gap-2">
              {group.members.map((member) => (
                <label key={member.id} className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-paper px-3 py-2 text-sm font-bold">
                  <span>
                    {member.name}
                    {member.slackUserId ? <span className="ml-2 text-xs text-leaf">Slack</span> : null}
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(draft.selectedMemberIds[member.id])}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        selectedMemberIds: { ...draft.selectedMemberIds, [member.id]: e.target.checked }
                      })
                    }
                  />
                </label>
              ))}
            </div>
            {group.slackDestination && slackUsers.length ? (
              <details className="rounded-lg bg-paper p-3">
                <summary className="cursor-pointer text-sm font-bold">Slackから今回だけ追加</summary>
                <div className="mt-3 grid max-h-52 gap-2 overflow-auto">
                  {slackUsers.map((user) => (
                    <button
                      type="button"
                      key={user.id}
                      className="focus-ring flex items-center justify-between rounded-lg bg-white px-3 py-2 text-left text-sm"
                      onClick={() =>
                        addExtra({
                          key: `slack-${user.id}`,
                          name: user.name,
                          slackUserId: user.id,
                          slackDisplayName: user.name
                        })
                      }
                    >
                      <span>{user.name}</span>
                      <UserPlus size={18} />
                    </button>
                  ))}
                </div>
              </details>
            ) : null}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input className={inputClass()} placeholder="今回だけ追加する人" value={extraName} onChange={(e) => setExtraName(e.target.value)} />
              <Button type="button" variant="secondary" onClick={addManualExtra}>
                <Plus size={18} />
              </Button>
            </div>
            {draft.extraMembers.length ? (
              <div className="flex flex-wrap gap-2">
                {draft.extraMembers.map((member) => (
                  <span key={member.key} className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-sm">
                    {member.name}
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          extraMembers: draft.extraMembers.filter((item) => item.key !== member.key)
                        })
                      }
                      aria-label={`${member.name}を削除`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </section>
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
              {amounts.map((member) => (
                <Field label={member.name} key={member.key}>
                  <input
                    type="number"
                    min={0}
                    className={inputClass()}
                    value={draft.memberAmounts[member.key] || ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        memberAmounts: { ...draft.memberAmounts, [member.key]: Number(e.target.value) }
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

function GroupManage({
  group,
  onSaved,
  onDeleted,
  onCancel
}: {
  group: Group;
  onSaved: () => void;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const [destinations, setDestinations] = useState<SlackDestination[]>([]);
  const [slackUsers, setSlackUsers] = useState<SlackUser[]>([]);
  const [manualName, setManualName] = useState("");
  const [form, setForm] = useState({
    name: group.name,
    defaultPayeeName: group.defaultPayeeName,
    defaultPaypayInfo: group.defaultPaypayInfo,
    defaultBankInfo: group.defaultBankInfo,
    slackDestinationId: group.slackDestination?.id ?? "",
    managementPassword: "",
    newManagementPassword: ""
  });
  const [members, setMembers] = useState<MemberInput[]>(
    group.members.map((member) => ({
      key: member.id,
      name: member.name,
      slackUserId: member.slackUserId ?? "",
      slackDisplayName: member.slackDisplayName ?? ""
    }))
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<SlackDestination[]>("/api/slack-destinations").then(setDestinations).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!form.slackDestinationId) {
      setSlackUsers([]);
      return;
    }
    api<SlackUser[]>(`/api/slack-destinations/${form.slackDestinationId}/users`)
      .then(setSlackUsers)
      .catch(() => setSlackUsers([]));
  }, [form.slackDestinationId]);

  function addMember(member: MemberInput) {
    setMembers((current) => {
      if (member.slackUserId && current.some((item) => item.slackUserId === member.slackUserId)) return current;
      if (!member.slackUserId && current.some((item) => item.name === member.name)) return current;
      return [...current, member];
    });
  }

  function addManualMember() {
    const name = manualName.trim();
    if (!name) return;
    addMember({ key: crypto.randomUUID(), name, slackUserId: "", slackDisplayName: "" });
    setManualName("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api(`/api/groups/${group.publicToken}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...form,
          members: members.map((member) => ({
            id: group.members.some((existing) => existing.id === member.key) ? member.key : null,
            name: member.name,
            slackUserId: member.slackUserId || null,
            slackDisplayName: member.slackDisplayName || null
          }))
        })
      });
      onSaved();
      onCancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function removeGroup() {
    if (!window.confirm("このグループとイベントを削除します。元に戻せません。")) return;
    setLoading(true);
    setError("");
    try {
      await api(`/api/groups/${group.publicToken}`, {
        method: "DELETE",
        body: JSON.stringify({ managementPassword: form.managementPassword })
      });
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={save}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-black">グループ編集</h2>
        <Button type="button" variant="ghost" onClick={onCancel}>閉じる</Button>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <Field label={group.managementPasswordSet ? "管理パスワード" : "新しい管理パスワード"} hint={group.managementPasswordSet ? "保存・削除に必要です。" : "既存グループに初回設定します。6文字以上。"}>
        <input type="password" className={inputClass()} value={group.managementPasswordSet ? form.managementPassword : form.newManagementPassword} onChange={(e) => setForm(group.managementPasswordSet ? { ...form, managementPassword: e.target.value } : { ...form, newManagementPassword: e.target.value })} />
      </Field>
      {group.managementPasswordSet ? (
        <Field label="管理パスワード変更（任意）">
          <input type="password" className={inputClass()} value={form.newManagementPassword} onChange={(e) => setForm({ ...form, newManagementPassword: e.target.value })} />
        </Field>
      ) : null}
      <Field label="グループ名">
        <input className={inputClass()} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Slack通知先">
        <select className={inputClass()} value={form.slackDestinationId} onChange={(e) => setForm({ ...form, slackDestinationId: e.target.value })}>
          <option value="">通知しない / Slackユーザー選択なし</option>
          {destinations.map((destination) => (
            <option key={destination.id} value={destination.id}>{destination.name} ({destination.channelName})</option>
          ))}
        </select>
      </Field>
      <section className="grid gap-3 rounded-lg border border-line bg-white p-4 shadow-soft">
        <h3 className="font-black">メンバー</h3>
        {slackUsers.length ? (
          <details className="rounded-lg bg-paper p-3">
            <summary className="cursor-pointer text-sm font-bold">Slackユーザーを追加</summary>
            <div className="mt-3 grid max-h-52 gap-2 overflow-auto">
              {slackUsers.map((user) => (
                <button type="button" key={user.id} className="focus-ring flex items-center justify-between rounded-lg bg-white px-3 py-2 text-left text-sm" onClick={() => addMember({ key: `slack-${user.id}`, name: user.name, slackUserId: user.id, slackDisplayName: user.name })}>
                  <span>{user.name}</span>
                  <UserPlus size={18} />
                </button>
              ))}
            </div>
          </details>
        ) : null}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input className={inputClass()} placeholder="Slackにいない人の名前" value={manualName} onChange={(e) => setManualName(e.target.value)} />
          <Button type="button" variant="secondary" onClick={addManualMember}><Plus size={18} /></Button>
        </div>
        <div className="grid gap-2">
          {members.map((member) => (
            <div key={member.key} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg bg-paper p-2">
              <input className={inputClass()} value={member.name} onChange={(e) => setMembers((current) => current.map((item) => item.key === member.key ? { ...item, name: e.target.value } : item))} />
              <Button type="button" variant="danger" onClick={() => setMembers((current) => current.filter((item) => item.key !== member.key))}><Trash2 size={18} /></Button>
            </div>
          ))}
        </div>
      </section>
      <Field label="受取人名">
        <input className={inputClass()} value={form.defaultPayeeName} onChange={(e) => setForm({ ...form, defaultPayeeName: e.target.value })} />
      </Field>
      <Field label="PayPay送金先情報">
        <textarea className={`${inputClass()} min-h-24`} value={form.defaultPaypayInfo} onChange={(e) => setForm({ ...form, defaultPaypayInfo: e.target.value })} />
      </Field>
      <Field label="振込先情報（任意）">
        <textarea className={`${inputClass()} min-h-24`} value={form.defaultBankInfo} onChange={(e) => setForm({ ...form, defaultBankInfo: e.target.value })} />
      </Field>
      <Button disabled={loading}><Check size={18} /> 保存</Button>
      <Button type="button" variant="danger" disabled={loading || !group.managementPasswordSet} onClick={removeGroup}>
        <Trash2 size={18} /> グループを削除
      </Button>
    </form>
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
                <p className="text-lg font-black">
                  {member.name}
                  {member.memberType === "guest" ? <span className="ml-2 text-xs text-ink/50">今回のみ</span> : null}
                </p>
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
                {event.paypayInfo ? (
                  <div className="rounded-lg bg-paper p-3">
                    <p className="flex items-center gap-2 text-xs font-bold text-ink/60">
                      <CreditCard size={14} /> PayPay送金先情報
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{`${event.payeeName}\n${event.paypayInfo}`}</p>
                  </div>
                ) : null}
                {event.bankInfo ? (
                  <div className="rounded-lg bg-paper p-3">
                    <p className="flex items-center gap-2 text-xs font-bold text-ink/60">
                      <Building2 size={14} /> 振込先情報
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{`${event.payeeName}\n${event.bankInfo}`}</p>
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  {event.paypayInfo ? (
                    <Button variant="secondary" onClick={() => navigator.clipboard.writeText(`${event.payeeName}\n${event.paypayInfo}`)}>
                      <Clipboard size={18} /> PayPay情報
                    </Button>
                  ) : null}
                  {event.bankInfo ? (
                    <Button variant="secondary" onClick={() => navigator.clipboard.writeText(`${event.payeeName}\n${event.bankInfo}`)}>
                      <Clipboard size={18} /> 振込先
                    </Button>
                  ) : null}
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
