CREATE TABLE IF NOT EXISTS slack_destinations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  public_token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  default_payee_name TEXT NOT NULL,
  default_paypay_info TEXT NOT NULL,
  slack_destination_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (slack_destination_id) REFERENCES slack_destinations(id)
);

CREATE TABLE IF NOT EXISTS group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  public_token TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_group_id ON events(group_id);

CREATE TABLE IF NOT EXISTS event_members (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  group_member_id TEXT NOT NULL,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('unpaid', 'paid')),
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (group_member_id) REFERENCES group_members(id)
);

CREATE INDEX IF NOT EXISTS idx_event_members_event_id ON event_members(event_id);

CREATE TABLE IF NOT EXISTS event_paypay_links (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  UNIQUE (event_id, amount)
);

CREATE TABLE IF NOT EXISTS slack_notification_logs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  success INTEGER NOT NULL,
  error_message TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_logs_completion_success
ON slack_notification_logs(event_id, notification_type)
WHERE notification_type = 'completion' AND success = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_logs_daily_success
ON slack_notification_logs(event_id, notification_type, sent_at)
WHERE notification_type = 'daily_reminder' AND success = 1;
