ALTER TABLE slack_destinations ADD COLUMN bot_token TEXT;

ALTER TABLE groups ADD COLUMN default_bank_info TEXT NOT NULL DEFAULT '';

ALTER TABLE group_members ADD COLUMN slack_user_id TEXT;
ALTER TABLE group_members ADD COLUMN slack_display_name TEXT;

PRAGMA foreign_keys=off;

CREATE TABLE event_members_new (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  group_member_id TEXT,
  name TEXT NOT NULL,
  slack_user_id TEXT,
  slack_display_name TEXT,
  member_type TEXT NOT NULL DEFAULT 'group',
  amount INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('unpaid', 'paid')),
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (group_member_id) REFERENCES group_members(id)
);

INSERT INTO event_members_new (
  id,
  event_id,
  group_member_id,
  name,
  slack_user_id,
  slack_display_name,
  member_type,
  amount,
  status,
  paid_at,
  created_at,
  updated_at
)
SELECT
  id,
  event_id,
  group_member_id,
  name,
  NULL,
  NULL,
  'group',
  amount,
  status,
  paid_at,
  created_at,
  updated_at
FROM event_members;

DROP TABLE event_members;
ALTER TABLE event_members_new RENAME TO event_members;

CREATE INDEX IF NOT EXISTS idx_event_members_event_id ON event_members(event_id);

PRAGMA foreign_keys=on;
