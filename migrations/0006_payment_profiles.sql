CREATE TABLE IF NOT EXISTS payment_profiles (
  id TEXT PRIMARY KEY,
  public_token TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  paypay_info TEXT NOT NULL DEFAULT '',
  bank_info TEXT NOT NULL DEFAULT '',
  management_password_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE groups ADD COLUMN default_payment_profile_id TEXT;
ALTER TABLE events ADD COLUMN payment_profile_id TEXT;
ALTER TABLE events ADD COLUMN management_password_hash TEXT;

INSERT INTO payment_profiles (id, public_token, display_name, paypay_info, bank_info, management_password_hash, created_at, updated_at)
SELECT
  id,
  lower(hex(randomblob(18))),
  name,
  paypay_info,
  bank_info,
  NULL,
  created_at,
  updated_at
FROM group_payers
WHERE NOT EXISTS (
  SELECT 1 FROM payment_profiles WHERE payment_profiles.id = group_payers.id
);

UPDATE groups
SET default_payment_profile_id = (
  SELECT id
  FROM group_payers
  WHERE group_payers.group_id = groups.id
  ORDER BY created_at ASC
  LIMIT 1
)
WHERE default_payment_profile_id IS NULL;

UPDATE events
SET payment_profile_id = payer_id
WHERE payment_profile_id IS NULL AND payer_id IS NOT NULL;

UPDATE events
SET payment_profile_id = (
  SELECT default_payment_profile_id
  FROM groups
  WHERE groups.id = events.group_id
)
WHERE payment_profile_id IS NULL;

UPDATE events
SET management_password_hash = (
  SELECT management_password_hash
  FROM groups
  WHERE groups.id = events.group_id
)
WHERE management_password_hash IS NULL;
