CREATE TABLE IF NOT EXISTS group_payers (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  paypay_info TEXT NOT NULL DEFAULT '',
  bank_info TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

ALTER TABLE events ADD COLUMN payer_id TEXT;

INSERT INTO group_payers (id, group_id, name, paypay_info, bank_info, created_at, updated_at)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),
  id,
  default_payee_name,
  default_paypay_info,
  default_bank_info,
  created_at,
  updated_at
FROM groups
WHERE NOT EXISTS (
  SELECT 1 FROM group_payers WHERE group_payers.group_id = groups.id
);

UPDATE events
SET payer_id = (
  SELECT id
  FROM group_payers
  WHERE group_payers.group_id = events.group_id
  ORDER BY created_at ASC
  LIMIT 1
)
WHERE payer_id IS NULL;
