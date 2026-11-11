// The course's sections, per role. One list feeds the Course Home tiles and the tab row,
// so they can never disagree. Plain module (no 'use client') so server pages can call it.
import {
  BookOpenText, CalendarDays, Home, Inbox, Layers, MessageCircleQuestion, MessageSquareHeart, Settings2, Sparkles, Users,
} from 'lucide-react';
import { TAGS } from './tags';

export function courseNav(courseId: string, isProf: boolean) {
  const base = `/c/${courseId}`;
  return isProf
    ? [
        { href: base, label: 'Course Home', tag: TAGS.home, icon: Home, exact: true },
        { href: `${base}/dashboard`, label: 'Clarifications', tag: TAGS.clarifications, icon: Layers },
        { href: `${base}/inbox`, label: 'Anonymous Feedback', tag: TAGS.inbox, icon: Inbox },
        { href: `${base}/materials`, label: 'Materials & Syllabus', tag: TAGS.materials, icon: BookOpenText },
        { href: `${base}/settings`, label: 'Course Settings', tag: TAGS.settings, icon: Settings2 },
      ]
    : [
        { href: base, label: 'Course Home', tag: TAGS.home, icon: Home, exact: true },
        { href: `${base}/materials`, label: 'Materials & Syllabus', tag: TAGS.materials, icon: BookOpenText },
        { href: `${base}/study`, label: 'Study AI', tag: TAGS.study, icon: Sparkles },
        { href: `${base}/ask`, label: 'Ask Professor', tag: TAGS.ask, icon: MessageCircleQuestion },
        { href: `${base}/notes`, label: 'Anonymous Feedback', tag: TAGS.notes, icon: MessageSquareHeart },
        { href: `${base}/buddies`, label: 'Study Buddies', tag: TAGS.buddies, icon: Users },
        { href: '/calendar', label: 'Calendar', tag: TAGS.calendar, icon: CalendarDays },
      ];
}
