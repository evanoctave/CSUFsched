import type { RawTeacherNode, RmpTeacher } from './types';

export function mapTeacherNode(node: RawTeacherNode): RmpTeacher {
  return {
    rmpId: node.id,
    legacyId: node.legacyId,
    firstName: node.firstName,
    lastName: node.lastName,
    rating: node.avgRating,
    difficulty: node.avgDifficulty,
    wouldTakeAgainPct:
      node.wouldTakeAgainPercent === null || node.wouldTakeAgainPercent < 0
        ? null
        : node.wouldTakeAgainPercent,
    numRatings: node.numRatings,
    rmpUrl: `https://www.ratemyprofessors.com/professor/${node.legacyId}`,
    tags: [...node.teacherRatingTags]
      .sort((a, b) => b.tagCount - a.tagCount)
      .map((t) => ({ tag: t.tagName, count: t.tagCount })),
  };
}
