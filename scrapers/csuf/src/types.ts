import type { Day } from '@csufsched/types';

// One flat row per meeting pattern, as returned by the PeopleSoft class-search endpoint.
export interface RawClassRow {
  subject: string; // "CPSC"
  catalog_nbr: string; // "121"
  descr: string; // course title
  units: string; // "3" or "1 - 3"
  class_nbr: string; // "12345"
  class_section: string; // "01"
  instructor: string; // "Lee,J" or "" or "Staff"
  meeting_days: string; // "MoWeFr", "TuTh", "" for async
  start_time: string; // "10:00AM", "" for async
  end_time: string; // "10:50AM"
  building: string; // "CS" or ""
  room: string; // "101" or ""
  instruction_mode: string; // "P" in-person, "OL" online, "HY" hybrid
  enrollment_status: string; // "O" open, "C" closed, "W" waitlist
}

export interface ScrapedMeeting {
  days: Day[];
  startMin: number;
  endMin: number;
  building: string | null;
  room: string | null;
}

export interface ScrapedSection {
  classNbr: string;
  sectionCode: string;
  instructorName: string | null;
  mode: 'in-person' | 'online' | 'hybrid';
  enrollmentStatus: 'open' | 'closed' | 'waitlist';
  meetings: ScrapedMeeting[];
}

export interface ScrapedCourse {
  deptCode: string;
  catalogNbr: string;
  title: string;
  units: number;
  sections: ScrapedSection[];
}
