import { assertUuid, route } from '@/lib/api';
import { studyScopes } from '@/lib/features/study';

type P = { courseId: string };

/** Documents and modules the student may study from (Row Level Security decides). */
export const GET = route<P>(async (_req, { me, params }) => studyScopes(me, assertUuid(params.courseId)));
