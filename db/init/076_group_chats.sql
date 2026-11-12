-- 2026-11-11: group chats that can grow and that people can leave.
--   create_group()       a named group with 1 to 7 classmates (a 1-to-1 chat stays create_thread()).
--   add_group_members()  any member adds more classmates, up to 8 people in total.
--   leave_group()        a member leaves; an empty group is deleted.
-- Same rule as every chat: only students enrolled in that course who are visible to classmates,
-- and nobody in a block with the person adding them. Safe to re-run.

CREATE OR REPLACE FUNCTION check_group_candidate(p_course uuid, p_user uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user = app_uid() THEN RAISE EXCEPTION 'cannot add yourself'; END IF;
  IF NOT EXISTS (SELECT 1 FROM enrollments e JOIN profiles p ON p.id = e.user_id
                  WHERE e.user_id = p_user AND e.course_id = p_course AND p.role = 'student'
                    AND e.role_in_course = 'student' AND p.visible_to_classmates) THEN
    RAISE EXCEPTION 'member is not a visible classmate in this course';
  END IF;
  IF EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = p_user AND blocked_id = app_uid())
                                     OR (blocker_id = app_uid() AND blocked_id = p_user)) THEN
    RAISE EXCEPTION 'blocked';
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION check_group_candidate(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION create_group(p_course uuid, p_members uuid[], p_title text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tid uuid; m uuid; me uuid := app_uid();
BEGIN
  IF me IS NULL OR NOT is_member(p_course) THEN RAISE EXCEPTION 'not enrolled'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = me AND role = 'student' AND visible_to_classmates) THEN
    RAISE EXCEPTION 'member is not a visible classmate in this course';
  END IF;
  p_members := ARRAY(SELECT DISTINCT unnest(p_members));
  IF coalesce(array_length(p_members, 1), 0) NOT BETWEEN 1 AND 7 THEN RAISE EXCEPTION 'a group has 1 to 7 other members'; END IF;
  FOREACH m IN ARRAY p_members LOOP PERFORM check_group_candidate(p_course, m); END LOOP;
  INSERT INTO threads (course_id, is_group, title, created_by)
       VALUES (p_course, true, nullif(left(trim(p_title), 60), ''), me) RETURNING id INTO tid;
  INSERT INTO thread_members VALUES (tid, me);
  INSERT INTO thread_members SELECT tid, unnest(p_members);
  RETURN tid;
END $$;
REVOKE EXECUTE ON FUNCTION create_group(uuid, uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_group(uuid, uuid[], text) TO rooroom_app;

CREATE OR REPLACE FUNCTION add_group_members(p_thread uuid, p_members uuid[]) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; m uuid; n_now int; added int := 0;
BEGIN
  SELECT id, course_id, is_group INTO t FROM threads WHERE id = p_thread;
  IF t.id IS NULL OR NOT is_thread_member(p_thread) THEN RAISE EXCEPTION 'not a member of this chat'; END IF;
  IF NOT t.is_group THEN RAISE EXCEPTION 'only group chats can add people'; END IF;
  SELECT count(*) INTO n_now FROM thread_members WHERE thread_id = p_thread;
  p_members := ARRAY(SELECT DISTINCT x FROM unnest(p_members) x
                      WHERE NOT EXISTS (SELECT 1 FROM thread_members tm WHERE tm.thread_id = p_thread AND tm.user_id = x));
  IF coalesce(array_length(p_members, 1), 0) = 0 THEN RETURN 0; END IF;
  IF n_now + array_length(p_members, 1) > 8 THEN RAISE EXCEPTION 'a group has at most 8 people'; END IF;
  FOREACH m IN ARRAY p_members LOOP
    PERFORM check_group_candidate(t.course_id, m);
    INSERT INTO thread_members VALUES (p_thread, m);
    added := added + 1;
  END LOOP;
  RETURN added;
END $$;
REVOKE EXECUTE ON FUNCTION add_group_members(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_group_members(uuid, uuid[]) TO rooroom_app;

CREATE OR REPLACE FUNCTION leave_group(p_thread uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; left_n int;
BEGIN
  SELECT id, is_group INTO t FROM threads WHERE id = p_thread;
  IF t.id IS NULL OR NOT is_thread_member(p_thread) THEN RAISE EXCEPTION 'not a member of this chat'; END IF;
  IF NOT t.is_group THEN RAISE EXCEPTION 'only group chats can be left'; END IF;
  DELETE FROM thread_members WHERE thread_id = p_thread AND user_id = app_uid();
  DELETE FROM notifications WHERE user_id = app_uid() AND ref_id = p_thread AND read_at IS NULL;
  SELECT count(*) INTO left_n FROM thread_members WHERE thread_id = p_thread;
  IF left_n = 0 THEN DELETE FROM threads WHERE id = p_thread; END IF;
  RETURN left_n;
END $$;
REVOKE EXECUTE ON FUNCTION leave_group(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION leave_group(uuid) TO rooroom_app;

-- "Diego added you to “Project team”": name the person who added you, not always the creator.
CREATE OR REPLACE FUNCTION trg_thread_member() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; v_by_id uuid; v_by text;
BEGIN
  SELECT id, course_id, created_by, is_group, title INTO t FROM threads WHERE id = NEW.thread_id;
  v_by_id := coalesce(app_uid(), t.created_by);
  IF v_by_id = NEW.user_id THEN RETURN NEW; END IF;
  SELECT display_name INTO v_by FROM profiles WHERE id = v_by_id;
  PERFORM notify_user(NEW.user_id, t.course_id, 'chat_started', t.id,
    CASE WHEN t.is_group THEN coalesce(v_by, 'A classmate') || ' added you to ' || coalesce('“' || t.title || '”', 'a group chat')
         ELSE coalesce(v_by, 'A classmate') || ' started a chat with you' END,
    'Study buddies in ' || course_code(t.course_id), '/c/' || t.course_id || '/buddies?thread=' || t.id);
  RETURN NEW;
END $$;
