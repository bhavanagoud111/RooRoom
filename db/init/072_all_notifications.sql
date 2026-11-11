-- 2026-11-11: notifications for every action, incoming and outgoing.
--
-- "Incoming" = something another person did that concerns you (070/071 plus a few here).
-- "Outgoing" = a confirmation of something you did ("Your anonymous note was sent"). Outgoing
-- notifications are unread like any other, but don't pop up, because you just did the thing.
--
-- Left out on purpose: Study AI questions, flashcards, summaries and translations (they answer on the
-- spot), your own chat messages, profile changes and blocking someone.
-- Anonymity holds: a professor's notification never names a student behind a note or question.
-- Safe to re-run.

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS outgoing boolean NOT NULL DEFAULT false;

-- Safety net: a notification can never fail the action that caused it. A missing title or link
-- falls back to a default, and any other error is logged as a warning and skipped.
CREATE OR REPLACE FUNCTION notify_insert(p_user uuid, p_course uuid, p_kind text, p_ref uuid,
                                         p_title text, p_body text, p_link text, p_outgoing boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  INSERT INTO notifications (user_id, course_id, kind, ref_id, title, body, link, outgoing)
  VALUES (p_user, p_course, p_kind, p_ref, left(coalesce(p_title, 'RooRoom update'), 200), left(p_body, 400),
          coalesce(p_link, '/notifications'), p_outgoing);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notification skipped (%): %', p_kind, SQLERRM;
END $$;
REVOKE EXECUTE ON FUNCTION notify_insert(uuid, uuid, text, uuid, text, text, text, boolean) FROM PUBLIC;

CREATE OR REPLACE FUNCTION notify_user(p_user uuid, p_course uuid, p_kind text, p_ref uuid,
                                       p_title text, p_body text, p_link text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT notify_insert(p_user, p_course, p_kind, p_ref, p_title, p_body, p_link, false);
$$;

-- A confirmation of the user's own action.
CREATE OR REPLACE FUNCTION notify_self(p_user uuid, p_course uuid, p_kind text, p_ref uuid,
                                       p_title text, p_body text, p_link text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT notify_insert(p_user, p_course, p_kind, p_ref, p_title, p_body, p_link, true);
$$;
REVOKE EXECUTE ON FUNCTION notify_self(uuid, uuid, text, uuid, text, text, text) FROM PUBLIC;

-- One unread line that counts up ("3 new students joined") instead of many lines.
CREATE OR REPLACE FUNCTION notify_rollup(p_user uuid, p_course uuid, p_kind text, p_ref uuid,
                                         p_title_one text, p_many_tail text, p_body text, p_link text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  BEGIN
  UPDATE notifications
     SET item_count = item_count + 1, title = left((item_count + 1) || ' ' || p_many_tail, 200),
         body = left(p_body, 400), created_at = now()
   WHERE user_id = p_user AND kind = p_kind AND ref_id IS NOT DISTINCT FROM p_ref AND read_at IS NULL;
  IF NOT FOUND THEN
    PERFORM notify_user(p_user, p_course, p_kind, p_ref, p_title_one, p_body, p_link);
  END IF;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'notification skipped (%): %', p_kind, SQLERRM;
  END;
END $$;
REVOKE EXECUTE ON FUNCTION notify_rollup(uuid, uuid, text, uuid, text, text, text, text) FROM PUBLIC;

-- ---------------------------------------------------------------- welcome
CREATE OR REPLACE FUNCTION trg_welcome() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM notify_user(NEW.id, NULL, 'welcome', NULL, 'Welcome to RooRoom, ' || NEW.display_name || '!',
    CASE WHEN NEW.role = 'professor'
      THEN 'Your Fall 2026 courses are linked to your account. Upload your syllabus to get started.'
      ELSE 'Find your courses and pick your professor to join their course room.' END,
    '/courses');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_welcome ON profiles;
CREATE TRIGGER notify_welcome AFTER INSERT ON profiles FOR EACH ROW EXECUTE FUNCTION trg_welcome();

-- ---------------------------------------------------------------- joining a course
CREATE OR REPLACE FUNCTION trg_enrolled() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_n int;
BEGIN
  IF NEW.role_in_course <> 'student' THEN RETURN NEW; END IF;
  SELECT id, code, title, professor_id INTO c FROM courses WHERE id = NEW.course_id;
  PERFORM notify_self(NEW.user_id, c.id, 'joined', c.id, 'You joined ' || c.code,
    c.title || '. Your Study AI, questions and notes for this course are ready.', '/c/' || c.id);
  SELECT count(*) INTO v_n FROM enrollments WHERE course_id = c.id AND role_in_course = 'student';
  PERFORM notify_rollup(c.professor_id, c.id, 'student_joined', c.id,
    'A new student joined ' || c.code, 'new students joined ' || c.code,
    'Your class now has ' || v_n || ' student' || CASE WHEN v_n = 1 THEN '' ELSE 's' END || ' on RooRoom.', '/c/' || c.id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_enrolled ON enrollments;
CREATE TRIGGER notify_enrolled AFTER INSERT ON enrollments FOR EACH ROW EXECUTE FUNCTION trg_enrolled();

-- ---------------------------------------------------------------- your upload is ready (or failed)
CREATE OR REPLACE FUNCTION trg_upload_done() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text := course_code(NEW.course_id); v_link text := '/c/' || NEW.course_id || '/materials';
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'ready' THEN
    PERFORM notify_self(NEW.uploader_id, NEW.course_id, 'upload_ready', NEW.id, '“' || NEW.title || '” is ready',
      CASE WHEN NEW.visibility = 'class'
        THEN 'Shared with your ' || v_code || ' class. The Study AI can now answer from it.'
        ELSE 'Your private notes for ' || v_code || ' are ready. Only you and your Study AI can see them.' END,
      v_link);
  ELSIF NEW.status IN ('failed', 'no_text') THEN
    PERFORM notify_user(NEW.uploader_id, NEW.course_id, 'upload_failed', NEW.id, 'Couldn’t read “' || NEW.title || '”',
      CASE WHEN NEW.status = 'no_text' THEN 'No text was found in this PDF (is it a scan?). Try another file.'
        ELSE 'Something went wrong while reading it. Try uploading it again.' END, v_link);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_upload_done ON documents;
CREATE TRIGGER notify_upload_done AFTER UPDATE OF status ON documents FOR EACH ROW EXECUTE FUNCTION trg_upload_done();

-- ---------------------------------------------------------------- your question was sent
CREATE OR REPLACE FUNCTION trg_question_sent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM notify_self(NEW.author_id, NEW.course_id, 'question_sent', NEW.id,
    'Your question was sent anonymously in ' || course_code(NEW.course_id), NEW.text_original,
    '/c/' || NEW.course_id || '/ask');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_question_sent ON questions;
CREATE TRIGGER notify_question_sent AFTER INSERT ON questions FOR EACH ROW EXECUTE FUNCTION trg_question_sent();

-- ---------------------------------------------------------------- question group ready: professor + askers
CREATE OR REPLACE FUNCTION trg_cluster_digest() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'digest' AND (TG_OP = 'INSERT' OR OLD.status = 'forming') THEN
    PERFORM notify_user(c.professor_id, c.id, 'digest', NEW.id,
      NEW.question_count || ' students asked a similar question in ' || c.code,
      coalesce(NEW.summary, 'Open Clarifications to see the group and answer it.'),
      '/c/' || c.id || '/dashboard')
      FROM courses c WHERE c.id = NEW.course_id;
    PERFORM notify_user(a.author_id, NEW.course_id, 'digest_formed', NEW.id,
      'Classmates asked the same thing as you in ' || course_code(NEW.course_id),
      'Your question is now in a group of ' || NEW.question_count || '. Your professor has been asked to answer it for the class.',
      '/c/' || NEW.course_id || '/ask')
      FROM (SELECT DISTINCT author_id FROM questions WHERE cluster_id = NEW.id) a;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------- anonymous notes: what happened to yours
CREATE OR REPLACE FUNCTION note_status_message(p_status note_status, p_labels text[], OUT title text, OUT body text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status
           WHEN 'queued' THEN 'Your anonymous note was sent'
           WHEN 'held' THEN 'Your anonymous note is waiting for a check'
           WHEN 'blocked' THEN 'Your anonymous note was not delivered'
           WHEN 'delivered' THEN 'Your anonymous note was delivered' END,
         CASE p_status
           WHEN 'queued' THEN 'It passed screening and reaches your professor in the next daily batch (8:00). Your name is never shown.'
           WHEN 'held' THEN 'Screening is unavailable right now, so it was held, not sent. Try again later from Anonymous Feedback.'
           WHEN 'blocked' THEN 'It broke a rule (' || coalesce(replace(array_to_string(p_labels, ', '), '_', ' '), 'moderation') || '). You can rewrite it.'
           WHEN 'delivered' THEN 'Your professor can read it now. They still don’t know who you are.' END;
$$;

CREATE OR REPLACE FUNCTION trg_note_sent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n record; m record;
BEGIN
  SELECT id, course_id, status, moderation_labels INTO n FROM anon_notes WHERE id = NEW.note_id;
  m := note_status_message(n.status, n.moderation_labels);
  IF m.title IS NOT NULL THEN
    PERFORM notify_self(NEW.author_id, n.course_id, 'note_' || n.status, n.id, m.title || ' (' || course_code(n.course_id) || ')',
      m.body, '/c/' || n.course_id || '/notes');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_note_sent ON note_authors;
CREATE TRIGGER notify_note_sent AFTER INSERT ON note_authors FOR EACH ROW EXECUTE FUNCTION trg_note_sent();

CREATE OR REPLACE FUNCTION trg_note_delivered() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_author uuid; m record;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'delivered' THEN
    PERFORM notify_user(c.professor_id, c.id, 'note', NEW.id,
      'New anonymous feedback in ' || c.code, 'A student sent you an anonymous note.',
      '/c/' || c.id || '/inbox')
      FROM courses c WHERE c.id = NEW.course_id;
  END IF;
  -- Tell the author what happened (delivered, or a held note that was screened again).
  SELECT author_id INTO v_author FROM note_authors WHERE note_id = NEW.id;
  m := note_status_message(NEW.status, NEW.moderation_labels);
  IF v_author IS NOT NULL AND m.title IS NOT NULL THEN
    PERFORM notify_user(v_author, NEW.course_id, 'note_' || NEW.status, NEW.id, m.title || ' (' || course_code(NEW.course_id) || ')',
      m.body, '/c/' || NEW.course_id || '/notes');
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------- professor: confirmations
CREATE OR REPLACE FUNCTION trg_published_self() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM enrollments WHERE course_id = NEW.course_id AND role_in_course = 'student';
  PERFORM notify_self(NEW.author_id, NEW.course_id, 'published', NEW.id,
    CASE WHEN NEW.cluster_id IS NULL THEN 'Your announcement was sent' ELSE 'Your answer was published' END
      || ' in ' || course_code(NEW.course_id),
    'Sent to ' || v_n || ' student' || CASE WHEN v_n = 1 THEN '' ELSE 's' END || ', each in their own language. The Study AI now uses it too.',
    '/c/' || NEW.course_id || '/dashboard');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_published_self ON clarifications;
CREATE TRIGGER notify_published_self AFTER INSERT ON clarifications FOR EACH ROW EXECUTE FUNCTION trg_published_self();

CREATE OR REPLACE FUNCTION trg_reply_self() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_course uuid;
BEGIN
  SELECT course_id INTO v_course FROM anon_notes WHERE id = NEW.note_id;
  PERFORM notify_self(NEW.author_id, v_course, 'reply_sent', NEW.note_id, 'Your reply was sent (' || course_code(v_course) || ')',
    'The student will see it under their note.', '/c/' || v_course || '/inbox');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_reply_self ON note_replies;
CREATE TRIGGER notify_reply_self AFTER INSERT ON note_replies FOR EACH ROW EXECUTE FUNCTION trg_reply_self();

-- ---------------------------------------------------------------- course settings that students should know about
CREATE OR REPLACE FUNCTION trg_course_settings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_title text; v_body text;
BEGIN
  IF NEW.notes_enabled IS DISTINCT FROM OLD.notes_enabled THEN
    v_title := CASE WHEN NEW.notes_enabled THEN 'Anonymous feedback is open again in ' ELSE 'Anonymous feedback was turned off in ' END || NEW.code;
    v_body := CASE WHEN NEW.notes_enabled THEN 'You can send your professor anonymous notes again.'
                   ELSE 'You can still ask questions with Ask Professor.' END;
  ELSIF NEW.notes_muted_until IS DISTINCT FROM OLD.notes_muted_until THEN
    IF NEW.notes_muted_until IS NOT NULL AND NEW.notes_muted_until > now() THEN
      v_title := 'Anonymous feedback is paused in ' || NEW.code;
      v_body := 'Your professor paused notes until ' || to_char(NEW.notes_muted_until AT TIME ZONE 'America/Chicago', 'Mon DD') || '. Ask Professor still works.';
    ELSE
      v_title := 'Anonymous feedback is open again in ' || NEW.code;
      v_body := 'You can send your professor anonymous notes again.';
    END IF;
  END IF;
  IF v_title IS NOT NULL THEN
    PERFORM notify_user(e.user_id, NEW.id, 'course_settings', NEW.id, v_title, v_body, '/c/' || NEW.id || '/notes')
      FROM enrollments e WHERE e.course_id = NEW.id AND e.role_in_course = 'student';
    PERFORM notify_self(NEW.professor_id, NEW.id, 'course_settings', NEW.id, 'Course settings saved for ' || NEW.code,
      'Your students were told: ' || lower(left(v_title, 1)) || substr(v_title, 2) || '.', '/c/' || NEW.id || '/inbox');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_course_settings ON courses;
CREATE TRIGGER notify_course_settings AFTER UPDATE OF notes_enabled, notes_muted_until ON courses
  FOR EACH ROW EXECUTE FUNCTION trg_course_settings();

-- ---------------------------------------------------------------- notes suspended after strikes
CREATE OR REPLACE FUNCTION trg_suspended() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.suspended_until IS NOT NULL AND NEW.suspended_until > now()
     AND (TG_OP = 'INSERT' OR OLD.suspended_until IS DISTINCT FROM NEW.suspended_until) THEN
    PERFORM notify_user(NEW.user_id, NEW.course_id, 'suspended', NEW.course_id,
      'Anonymous notes are suspended for you in ' || course_code(NEW.course_id),
      'Three of your notes broke the rules, so notes are off for you until the end of term. Ask Professor still works.',
      '/c/' || NEW.course_id || '/notes');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_suspended ON strikes;
CREATE TRIGGER notify_suspended AFTER INSERT OR UPDATE OF suspended_until ON strikes
  FOR EACH ROW EXECUTE FUNCTION trg_suspended();

-- ---------------------------------------------------------------- chats: someone started one with you
CREATE OR REPLACE FUNCTION trg_thread_member() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; v_by text;
BEGIN
  SELECT id, course_id, created_by, is_group, title INTO t FROM threads WHERE id = NEW.thread_id;
  IF t.created_by = NEW.user_id THEN RETURN NEW; END IF;
  SELECT display_name INTO v_by FROM profiles WHERE id = t.created_by;
  PERFORM notify_user(NEW.user_id, t.course_id, 'chat_started', t.id,
    CASE WHEN t.is_group THEN coalesce(v_by, 'A classmate') || ' added you to ' || coalesce('“' || t.title || '”', 'a group chat')
         ELSE coalesce(v_by, 'A classmate') || ' started a chat with you' END,
    'Study buddies in ' || course_code(t.course_id), '/c/' || t.course_id || '/buddies?thread=' || t.id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_thread_member ON thread_members;
CREATE TRIGGER notify_thread_member AFTER INSERT ON thread_members FOR EACH ROW EXECUTE FUNCTION trg_thread_member();

-- ---------------------------------------------------------------- calendar
CREATE OR REPLACE FUNCTION trg_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.source = 'syllabus' AND NEW.status = 'suggested' THEN
    PERFORM notify_rollup(NEW.user_id, NEW.course_id, 'calendar_suggested', NEW.course_id,
      'A date from the ' || course_code(NEW.course_id) || ' syllabus was suggested for your calendar',
      'dates from the ' || course_code(NEW.course_id) || ' syllabus were suggested for your calendar',
      'Latest: ' || NEW.title || ', ' || to_char(NEW.starts_at AT TIME ZONE 'America/Chicago', 'Mon DD') || '. Accept or dismiss them in Calendar.',
      '/calendar');
  ELSIF NEW.source IN ('voice', 'manual') THEN
    PERFORM notify_self(NEW.user_id, NEW.course_id, 'calendar_added', NEW.id, 'Added to your calendar: ' || NEW.title,
      to_char(NEW.starts_at AT TIME ZONE 'America/Chicago', 'Dy Mon DD, HH12:MI AM')
        || CASE WHEN NEW.source = 'voice' THEN ' (from your voice request)' ELSE '' END, '/calendar');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_event ON events;
CREATE TRIGGER notify_event AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION trg_event();

-- ---------------------------------------------------------------- reports
CREATE OR REPLACE FUNCTION trg_report() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM notify_self(NEW.reporter_id, NEW.course_id, 'report_received', NEW.id, 'Your report was received',
    'Thank you. It will be reviewed; the person you reported is not told who reported them.',
    CASE WHEN NEW.note_id IS NOT NULL THEN '/c/' || NEW.course_id || '/inbox' ELSE '/messages' END);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_report ON reports;
CREATE TRIGGER notify_report AFTER INSERT ON reports FOR EACH ROW EXECUTE FUNCTION trg_report();

-- ---------------------------------------------------------------- new material: one line that counts up
CREATE OR REPLACE FUNCTION trg_material_ready() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'ready' AND OLD.status IS DISTINCT FROM 'ready'
     AND NEW.author_role = 'professor' AND NEW.visibility = 'class' THEN
    PERFORM notify_rollup(e.user_id, NEW.course_id, 'material', NEW.course_id,
      'New material in ' || course_code(NEW.course_id), 'new materials in ' || course_code(NEW.course_id),
      'Latest: ' || NEW.title, '/c/' || NEW.course_id || '/materials')
      FROM enrollments e
     WHERE e.course_id = NEW.course_id AND e.role_in_course = 'student';
  END IF;
  RETURN NEW;
END $$;
