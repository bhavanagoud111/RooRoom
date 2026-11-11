-- 2026-11-11: the professor is also told about every single anonymous question, not only when 3
-- similar ones form a group. One unread line per course ("3 new anonymous questions"), so a busy
-- class doesn't flood the bell. The text shown is the redacted one (names and IDs removed); the
-- author is never included. Safe to re-run.

-- How many items one combined notification stands for.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS item_count int NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION trg_question() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prof uuid; v_code text;
BEGIN
  SELECT professor_id, code INTO v_prof, v_code FROM courses WHERE id = NEW.course_id;
  IF v_prof IS NULL OR v_prof = NEW.author_id OR NEW.text_redacted IS NULL THEN RETURN NEW; END IF;

  UPDATE notifications
     SET item_count = item_count + 1, title = (item_count + 1) || ' new anonymous questions in ' || v_code,
         body = left(NEW.text_redacted, 400), created_at = now()
   WHERE user_id = v_prof AND kind = 'question' AND ref_id = NEW.course_id AND read_at IS NULL;
  IF NOT FOUND THEN
    PERFORM notify_user(v_prof, NEW.course_id, 'question', NEW.course_id,
      'New anonymous question in ' || v_code, NEW.text_redacted, '/c/' || NEW.course_id || '/dashboard#all-q');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_question ON questions;
CREATE TRIGGER notify_question AFTER INSERT ON questions
  FOR EACH ROW EXECUTE FUNCTION trg_question();
