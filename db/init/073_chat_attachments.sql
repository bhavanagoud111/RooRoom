-- 2026-11-11: files in study-buddy chats (images, PDFs, Office files, text, zip).
--
-- One row per file. The file itself is encrypted by the app (same key as chat messages) and stored
-- in object storage under chat/<thread>/<id>. Only members of the chat can see or add a file, the
-- same rule as for messages. Safe to re-run.

CREATE TABLE IF NOT EXISTS message_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  thread_id    uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  uploader_id  uuid NOT NULL REFERENCES profiles(id),
  filename     text NOT NULL CHECK (length(filename) BETWEEN 1 AND 200),
  content_type text NOT NULL,
  size_bytes   bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  storage_key  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_attachments_message_idx ON message_attachments (message_id);

ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ma_sel ON message_attachments;
DROP POLICY IF EXISTS ma_ins ON message_attachments;
CREATE POLICY ma_sel ON message_attachments FOR SELECT TO rooroom_app USING (is_thread_member(thread_id));
-- You can attach a file only to your own message, in a chat you are in.
CREATE POLICY ma_ins ON message_attachments FOR INSERT TO rooroom_app
  WITH CHECK (uploader_id = app_uid() AND is_thread_member(thread_id)
              AND EXISTS (SELECT 1 FROM messages m WHERE m.id = message_id AND m.thread_id = message_attachments.thread_id
                                                     AND m.sender_id = app_uid()));
REVOKE ALL ON message_attachments FROM rooroom_app;
GRANT SELECT, INSERT ON message_attachments TO rooroom_app;
