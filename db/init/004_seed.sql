-- Seed data: UMKC-style course catalogue and fictional demo accounts.
-- All demo passwords are "rooroom-demo". Every person here is made up.

CREATE TEMP TABLE seed_people (email text, name text, role user_role, lang text, visible boolean);
INSERT INTO seed_people VALUES
  ('okafor@umkc.edu',     'Dr. Maya Okafor',     'professor', 'en', false),
  ('lindqvist@umkc.edu',  'Dr. Erik Lindqvist',  'professor', 'en', false),
  ('bauer@umkc.edu',      'Dr. Helen Bauer',     'professor', 'en', false),
  ('priya@umkc.edu',      'Priya Raman',         'student',   'en', true),
  ('diego@umkc.edu',      'Diego Fernández',     'student',   'en', true),
  ('wei@umkc.edu',        'Wei Zhang',           'student',   'en', true),
  ('amara@umkc.edu',      'Amara Okeke',         'student',   'en', true),
  ('omar@umkc.edu',       'Omar Haddad',         'student',   'en', true),
  ('sofia@umkc.edu',      'Sofia Rossi',         'student',   'en', true),
  ('jonah@umkc.edu',      'Jonah Miller',        'student',   'en', false),
  ('lena@umkc.edu',       'Lena Fischer',        'student',   'en', true),
  ('kenji@umkc.edu',      'Kenji Sato',          'student',   'en', true),
  ('fatima@umkc.edu',     'Fatima Noor',         'student',   'en', false),
  ('lucas@umkc.edu',      'Lucas Silva',         'student',   'en', true),
  ('hana@umkc.edu',       'Hana Kim',            'student',   'en', true);

INSERT INTO users (email, password_hash, email_verified_at)
SELECT email, crypt('rooroom-demo', gen_salt('bf', 10)), now() FROM seed_people;

INSERT INTO profiles (id, display_name, role, preferred_language, visible_to_classmates)
SELECT u.id, s.name, s.role, s.lang, s.visible FROM seed_people s JOIN users u ON u.email = s.email;

INSERT INTO courses (code, title, term, professor_id, description, color) VALUES
  ('COMP-SCI 5520', 'Network Architecture I', 'Fall 2026',
     (SELECT id FROM users WHERE email = 'okafor@umkc.edu'),
     'Layered network design, routing, transport protocols and a semester networks project.', '#2F6FED'),
  ('COMP-SCI 5565', 'Introduction to Statistical Learning', 'Fall 2026',
     (SELECT id FROM users WHERE email = 'lindqvist@umkc.edu'),
     'Regression, classification, resampling, tree methods and model selection.', '#0F9D7A'),
  ('COMP-SCI 5551', 'Advanced Software Engineering', 'Fall 2026',
     (SELECT id FROM users WHERE email = 'bauer@umkc.edu'),
     'Requirements, architecture, testing and team delivery of a semester project.', '#C2410C'),
  ('COMP-SCI 5530', 'Principles of Data Science', 'Fall 2026', NULL,
     'Data wrangling, visualisation, inference and communicating results.', '#7C3AED'),
  ('COMP-SCI 5542', 'Big Data Analytics and Applications', 'Fall 2026', NULL,
     'Distributed storage and processing, streaming and large-scale machine learning.', '#DB2777'),
  ('COMP-SCI 5525', 'Cloud Computing', 'Fall 2026', NULL,
     'Virtualisation, containers, orchestration and cloud service models.', '#0891B2'),
  ('COMP-SCI 5590', 'Special Topics: AI Security', 'Fall 2026', NULL,
     'Prompt injection, agent permissions, data egress and red-teaming AI systems.', '#B91C1C'),
  ('COMP-SCI 5592', 'Design and Analysis of Algorithms', 'Fall 2026', NULL,
     'Divide and conquer, dynamic programming, graph algorithms and complexity.', '#4D7C0F'),
  ('COMP-SCI 5560', 'Knowledge Discovery and Management', 'Fall 2026', NULL,
     'Knowledge graphs, ontologies, information extraction and retrieval.', '#A16207'),
  ('MATH 5525',     'Linear Algebra for Data Science', 'Fall 2026', NULL,
     'Vector spaces, decompositions and their use in machine learning.', '#475569'),
  ('STAT 5501',     'Statistical Design of Experiments', 'Fall 2026', NULL,
     'Randomisation, blocking, factorial designs and analysis of variance.', '#9333EA'),
  ('ECE 5577',      'Wireless Networks', 'Fall 2026', NULL,
     'Wireless channels, medium access, cellular and Wi-Fi systems.', '#0E7490');

-- Professors are enrolled in the courses they teach.
INSERT INTO enrollments (user_id, course_id, role_in_course)
SELECT professor_id, id, 'professor' FROM courses WHERE professor_id IS NOT NULL;

-- Every demo student takes Network Architecture I (12 students, so the class is large enough
-- for the anonymity warning not to fire). Some also take Statistical Learning.
INSERT INTO enrollments (user_id, course_id, role_in_course)
SELECT p.id, c.id, 'student' FROM profiles p, courses c
 WHERE p.role = 'student' AND c.code = 'COMP-SCI 5520';

INSERT INTO enrollments (user_id, course_id, role_in_course)
SELECT u.id, c.id, 'student' FROM users u, courses c
 WHERE c.code = 'COMP-SCI 5565'
   AND u.email IN ('priya@umkc.edu', 'diego@umkc.edu', 'wei@umkc.edu', 'amara@umkc.edu', 'kenji@umkc.edu');

DROP TABLE seed_people;
