-- 2026-11-11: notifications for students and professors.
--
-- A notification is written by a database trigger when something arrives for someone:
--   professor  <- an anonymous note is delivered to their inbox
--   professor  <- a group of similar student questions becomes a digest
--   student    <- the professor replies to their anonymous note
--   student    <- the professor answers a question group (askers get "your question"), or announces
--   student    <- the professor posts new class material (once it is ready)
--   everyone   <- a new chat message in one of their threads (one unread line per thread)
-- The triggers are SECURITY DEFINER, so they can see who should be told (for example the author of
-- an anonymous note) without the app ever learning it. A notification never names an anonymous
-- author, and encrypted text (notes, chat) is never copied into it.
--
-- Every file from 070 on must be safe to run again: the deploy re-applies them to the live database.

CREATE TABLE IF NOT EXISTS notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  course_id  uuid REFERENCES courses(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  ref_id     uuid,
  title      text NOT NULL,
  body       text,
  link       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS n_sel ON notifications;
DROP POLICY IF EXISTS n_upd ON notifications;
CREATE POLICY n_sel ON notifications FOR SELECT TO rooroom_app USING (user_id = app_uid());
CREATE POLICY n_upd ON notifications FOR UPDATE TO rooroom_app USING (user_id = app_uid()) WITH CHECK (user_id = app_uid());
REVOKE ALL ON notifications FROM rooroom_app;
GRANT SELECT, UPDATE (read_at) ON notifications TO rooroom_app;

-- ---------------------------------------------------------------- helpers
CREATE OR REPLACE FUNCTION notify_user(p_user uuid, p_course uuid, p_kind text, p_ref uuid,
                                       p_title text, p_body text, p_link text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO notifications (user_id, course_id, kind, ref_id, title, body, link)
  SELECT p_user, p_course, p_kind, p_ref, left(p_title, 200), left(p_body, 400), p_link
   WHERE p_user IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION notify_user(uuid, uuid, text, uuid, text, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION course_code(p_course uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT code FROM courses WHERE id = p_course;
$$;

-- ---------------------------------------------------------------- professor: anonymous note delivered
CREATE OR REPLACE FUNCTION trg_note_delivered() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
    PERFORM notify_user(c.professor_id, c.id, 'note', NEW.id,
      'New anonymous feedback in ' || c.code, 'A student sent you an anonymous note.',
      '/c/' || c.id || '/inbox')
      FROM courses c WHERE c.id = NEW.course_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_note_delivered ON anon_notes;
CREATE TRIGGER notify_note_delivered AFTER UPDATE OF status ON anon_notes
  FOR EACH ROW EXECUTE FUNCTION trg_note_delivered();

-- ---------------------------------------------------------------- professor: question group ready
CREATE OR REPLACE FUNCTION trg_cluster_digest() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'digest' AND (TG_OP = 'INSERT' OR OLD.status = 'forming') THEN
    PERFORM notify_user(c.professor_id, c.id, 'digest', NEW.id,
      NEW.question_count || ' students asked a similar question in ' || c.code,
      coalesce(NEW.summary, 'Open Clarifications to see the group and answer it.'),
      '/c/' || c.id || '/dashboard')
      FROM courses c WHERE c.id = NEW.course_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_cluster_digest ON clusters;
CREATE TRIGGER notify_cluster_digest AFTER INSERT OR UPDATE OF status ON clusters
  FOR EACH ROW EXECUTE FUNCTION trg_cluster_digest();

-- ---------------------------------------------------------------- student: reply to their anonymous note
CREATE OR REPLACE FUNCTION trg_note_reply() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_author uuid; v_course uuid;
BEGIN
  SELECT na.author_id, n.course_id INTO v_author, v_course
    FROM anon_notes n JOIN note_authors na ON na.note_id = n.id WHERE n.id = NEW.note_id;
  IF v_author IS NOT NULL AND v_author <> NEW.author_id THEN
    PERFORM notify_user(v_author, v_course, 'note_reply', NEW.note_id,
      'Your professor replied to your anonymous note in ' || course_code(v_course),
      'Only you can see this reply. Your professor still doesn’t know who you are.',
      '/c/' || v_course || '/notes');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_note_reply ON note_replies;
CREATE TRIGGER notify_note_reply AFTER INSERT ON note_replies
  FOR EACH ROW EXECUTE FUNCTION trg_note_reply();

-- ---------------------------------------------------------------- students: answer or announcement
CREATE OR REPLACE FUNCTION trg_clarification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text := course_code(NEW.course_id); v_link text := '/c/' || NEW.course_id;
BEGIN
  IF NEW.cluster_id IS NOT NULL THEN
    -- Students who asked in this group.
    PERFORM notify_user(a.author_id, NEW.course_id, 'answer', NEW.id,
      'Your professor answered your question in ' || v_code, coalesce(NEW.question_summary, left(NEW.answer_english, 200)), v_link)
      FROM (SELECT DISTINCT author_id FROM questions WHERE cluster_id = NEW.cluster_id AND author_id <> NEW.author_id) a;
    -- Everyone else in the class.
    PERFORM notify_user(e.user_id, NEW.course_id, 'answer', NEW.id,
      'New answer from your professor in ' || v_code, coalesce(NEW.question_summary, left(NEW.answer_english, 200)), v_link)
      FROM enrollments e
     WHERE e.course_id = NEW.course_id AND e.role_in_course = 'student' AND e.user_id <> NEW.author_id
       AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.cluster_id = NEW.cluster_id AND q.author_id = e.user_id);
  ELSE
    PERFORM notify_user(e.user_id, NEW.course_id, 'announcement', NEW.id,
      'Announcement in ' || v_code || coalesce(': ' || NEW.question_summary, ''), left(NEW.answer_english, 300), v_link)
      FROM enrollments e
     WHERE e.course_id = NEW.course_id AND e.role_in_course = 'student' AND e.user_id <> NEW.author_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_clarification ON clarifications;
CREATE TRIGGER notify_clarification AFTER INSERT ON clarifications
  FOR EACH ROW EXECUTE FUNCTION trg_clarification();

-- ---------------------------------------------------------------- students: new class material
CREATE OR REPLACE FUNCTION trg_material_ready() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'ready' AND OLD.status IS DISTINCT FROM 'ready'
     AND NEW.author_role = 'professor' AND NEW.visibility = 'class' THEN
    PERFORM notify_user(e.user_id, NEW.course_id, 'material', NEW.id,
      'New material in ' || course_code(NEW.course_id), NEW.title, '/c/' || NEW.course_id || '/materials')
      FROM enrollments e
     WHERE e.course_id = NEW.course_id AND e.role_in_course = 'student';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_material_ready ON documents;
CREATE TRIGGER notify_material_ready AFTER UPDATE OF status ON documents
  FOR EACH ROW EXECUTE FUNCTION trg_material_ready();

-- ---------------------------------------------------------------- chat: one unread line per thread
CREATE OR REPLACE FUNCTION trg_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_course uuid; v_sender text; m record;
BEGIN
  SELECT course_id INTO v_course FROM threads WHERE id = NEW.thread_id;
  SELECT display_name INTO v_sender FROM profiles WHERE id = NEW.sender_id;
  FOR m IN SELECT user_id FROM thread_members WHERE thread_id = NEW.thread_id AND user_id <> NEW.sender_id LOOP
    UPDATE notifications SET created_at = now(), title = 'New message from ' || coalesce(v_sender, 'a classmate')
     WHERE user_id = m.user_id AND kind = 'message' AND ref_id = NEW.thread_id AND read_at IS NULL;
    IF NOT FOUND THEN
      PERFORM notify_user(m.user_id, v_course, 'message', NEW.thread_id,
        'New message from ' || coalesce(v_sender, 'a classmate'), 'In ' || course_code(v_course),
        '/c/' || v_course || '/buddies?thread=' || NEW.thread_id);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_message ON messages;
CREATE TRIGGER notify_message AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION trg_message();
