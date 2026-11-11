import { route } from '@/lib/api';
import { CURRENT_TERM } from '@/lib/config';
import { withUser } from '@/lib/db';

// Course search over the whole UMKC catalogue (every subject and level). Each course comes back
// with its rooms for the current term: one per professor on the public schedule, with that
// professor's sections and times, so a student can pick the professor they actually have.
export const GET = route(async (req, { me }) => {
  const sp = req.nextUrl.searchParams;
  return withUser(me.id, async (db) => {
    if (sp.get('subjects')) {
      const r = await db.query(
        `SELECT subject, max(subject_name) AS name, count(*)::int AS courses,
                count(*) FILTER (WHERE EXISTS (SELECT 1 FROM courses c WHERE c.catalog_code = cc.code AND c.term = $1))::int AS offered
           FROM catalog_courses cc GROUP BY subject ORDER BY subject`, [CURRENT_TERM]);
      return { subjects: r.rows, term: CURRENT_TERM };
    }
    const q = (sp.get('q') ?? '').trim().slice(0, 80);
    const subject = (sp.get('subject') ?? '').trim().slice(0, 20);
    const level = ['graduate', 'undergraduate'].includes(sp.get('level') ?? '') ? sp.get('level')! : '';
    const offeredOnly = sp.get('offered') === '1';
    const page = Math.max(0, Math.min(50, Number(sp.get('page') ?? 0) || 0));
    const compact = q.replace(/[\s\-]/g, '').toLowerCase();

    const r = await db.query(
      `WITH hits AS (
         SELECT cc.code, cc.subject, cc.number, cc.title, cc.credits, cc.description, cc.prerequisites, cc.level, cc.subject_name,
                CASE WHEN $1 = '' THEN 0 ELSE ts_rank(cc.search, websearch_to_tsquery('english', $1)) END AS rank,
                (lower(replace(cc.code, '-', '')) LIKE replace($5, ' ', '') || '%') AS code_hit
           FROM catalog_courses cc
          WHERE ($1 = '' OR cc.search @@ websearch_to_tsquery('english', $1)
                 OR lower(replace(replace(cc.code, '-', ''), ' ', '')) LIKE '%' || $5 || '%'
                 OR cc.title ILIKE '%' || $1 || '%')
            AND ($2 = '' OR cc.subject = $2)
            AND ($3 = '' OR cc.level = $3)
            AND (NOT $6 OR EXISTS (SELECT 1 FROM courses c WHERE c.catalog_code = cc.code AND c.term = $4))
          ORDER BY code_hit DESC, rank DESC, cc.subject, lpad(regexp_replace(cc.number, '\\D', '', 'g'), 5, '0'), cc.number
          LIMIT 21 OFFSET $7)
       SELECT h.*,
              coalesce((SELECT json_agg(json_build_object(
                  'id', c.id, 'professor', coalesce(p.display_name, i.name), 'on_rooroom', c.professor_id IS NOT NULL,
                  'source', c.source, 'class_size', class_size(c.id),
                  'enrolled', EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.user_id = app_uid()),
                  'sections', coalesce((SELECT json_agg(json_build_object('section', s.section, 'component', s.component,
                                         'days_times', s.days_times, 'class_nbr', s.class_nbr) ORDER BY s.component, s.section)
                                        FROM course_sections s WHERE s.course_id = c.id), '[]'::json))
                  ORDER BY c.source = 'demo' DESC, c.instructor_id IS NULL, coalesce(p.display_name, i.name))
                FROM courses c
                LEFT JOIN instructors i ON i.id = c.instructor_id
                LEFT JOIN profiles p ON p.id = c.professor_id
               WHERE c.catalog_code = h.code AND (c.term = $4 OR c.source = 'demo')), '[]'::json) AS rooms
         FROM hits h ORDER BY code_hit DESC, rank DESC, subject, lpad(regexp_replace(number, '\\D', '', 'g'), 5, '0'), number`,
      [q, subject, level, CURRENT_TERM, compact, offeredOnly, page * 20]);
    return { courses: r.rows.slice(0, 20), more: r.rows.length > 20, term: CURRENT_TERM };
  });
});
