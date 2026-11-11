'use client';
// FullCalendar handles the drag, select and resize interactions; loaded client-side only.
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { DateSelectArg, EventChangeArg, EventClickArg, EventInput } from '@fullcalendar/core';

export default function Cal({ events, onSelect, onChange, onClick, onRange }: {
  events: EventInput[];
  onSelect: (a: DateSelectArg) => void;
  onChange: (a: EventChangeArg) => void;
  onClick: (a: EventClickArg) => void;
  onRange: (start: Date, end: Date) => void;
}) {
  return (
    <FullCalendar
      plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
      initialView="timeGridWeek"
      headerToolbar={{ left: 'prev,next today', center: 'title', right: 'timeGridDay,timeGridWeek,dayGridMonth' }}
      buttonText={{ today: 'Today', day: 'Day', week: 'Week', month: 'Month' }}
      height="auto"
      contentHeight={680}
      slotMinTime="07:00:00"
      slotMaxTime="24:00:00"
      scrollTime="08:00:00"
      nowIndicator
      allDaySlot={false}
      selectable
      selectMirror
      editable
      eventResizableFromStart
      dayMaxEvents={4}
      events={events}
      select={onSelect}
      eventChange={onChange}
      eventClick={onClick}
      datesSet={(a) => onRange(a.start, a.end)}
      eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
    />
  );
}
