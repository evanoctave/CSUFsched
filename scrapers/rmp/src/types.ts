// Node shape from RMP GraphQL newSearch.teachers.edges[].node
export interface RawTeacherNode {
  id: string; // base64 graphql id, e.g. "VGVhY2hlci0xMjM0"
  legacyId: number; // numeric id used in profile URLs
  firstName: string;
  lastName: string;
  avgRating: number | null;
  avgDifficulty: number | null;
  wouldTakeAgainPercent: number | null; // -1 when unknown
  numRatings: number;
  teacherRatingTags: Array<{ tagName: string; tagCount: number }>;
}

export interface RmpTeacher {
  rmpId: string;
  legacyId: number;
  firstName: string;
  lastName: string;
  rating: number | null;
  difficulty: number | null;
  wouldTakeAgainPct: number | null;
  numRatings: number;
  rmpUrl: string;
  tags: Array<{ tag: string; count: number }>;
}
