-- 2026-11-12: "Delete for me" in chats. Anyone can remove any message (their own or someone
-- else's) from their own view. The message stays for everyone else; nothing is erased.
-- Each person can only see and add their own hidden-message rows. Safe to re-run.

CREATE TABLE IF NOT EXISTS message_hides (
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  hidden_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);
CREATE INDEX IF NOT EXISTS message_hides_message ON message_hides (message_id);

ALTER TABLE message_hides ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_hides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mh_sel ON message_hides;
DROP POLICY IF EXISTS mh_ins ON message_hides;
CREATE POLICY mh_sel ON message_hides FOR SELECT TO rooroom_app USING (user_id = app_uid());
CREATE POLICY mh_ins ON message_hides FOR INSERT TO rooroom_app
  WITH CHECK (user_id = app_uid()
              AND EXISTS (SELECT 1 FROM messages m WHERE m.id = message_id AND is_thread_member(m.thread_id)));
REVOKE ALL ON message_hides FROM PUBLIC;
REVOKE ALL ON message_hides FROM rooroom_app;
GRANT SELECT, INSERT ON message_hides TO rooroom_app;
