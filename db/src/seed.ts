import { createPool } from './pool.ts';
import {
  upsertTerm,
  upsertDepartment,
  upsertCourse,
  upsertSection,
  replaceMeetings,
  upsertProfessor,
  replaceProfTags,
} from './upserts.ts';

async function seed(databaseUrl: string): Promise<void> {
  const pool = createPool(databaseUrl);
  try {
    const termId = await upsertTerm(pool, { code: '2268', name: 'Fall 2026' });
    const cpscId = await upsertDepartment(pool, { code: 'CPSC', name: 'Computer Science' });
    const mathId = await upsertDepartment(pool, { code: 'MATH', name: 'Mathematics' });

    const lee = await upsertProfessor(pool, {
      fullName: 'Lee,J',
      rmpId: 'VGVhY2hlci0x',
      rating: 4.2,
      difficulty: 2.1,
      wouldTakeAgainPct: 78,
      numRatings: 55,
      rmpUrl: 'https://www.ratemyprofessors.com/professor/1',
    });
    await replaceProfTags(pool, lee, [
      { tag: 'clear lectures', count: 12 },
      { tag: 'low homework', count: 9 },
    ]);
    const ito = await upsertProfessor(pool, { fullName: 'Ito,K' });

    const cpsc121 = await upsertCourse(pool, {
      termId,
      deptId: cpscId,
      catalogNbr: '121',
      title: 'Object-Oriented Programming',
      units: 3,
      description: 'Programming in an object-oriented language.',
    });
    const s1 = await upsertSection(pool, {
      courseId: cpsc121,
      classNbr: '12345',
      sectionCode: '01',
      instructorId: lee,
      mode: 'in-person',
      enrollmentStatus: 'open',
    });
    await replaceMeetings(pool, s1, [
      { days: ['M', 'W', 'F'], startMin: 600, endMin: 650, building: 'CS', room: '101' },
    ]);
    const s2 = await upsertSection(pool, {
      courseId: cpsc121,
      classNbr: '12346',
      sectionCode: '02',
      instructorId: ito,
      mode: 'in-person',
      enrollmentStatus: 'waitlist',
    });
    await replaceMeetings(pool, s2, [
      { days: ['Tu', 'Th'], startMin: 780, endMin: 855, building: 'CS', room: '102' },
    ]);

    const math150b = await upsertCourse(pool, {
      termId,
      deptId: mathId,
      catalogNbr: '150B',
      title: 'Calculus II',
      units: 4,
      description: null,
    });
    const s3 = await upsertSection(pool, {
      courseId: math150b,
      classNbr: '20001',
      sectionCode: '01',
      instructorId: null,
      mode: 'in-person',
      enrollmentStatus: 'open',
    });
    await replaceMeetings(pool, s3, [
      { days: ['M', 'W'], startMin: 720, endMin: 835, building: 'MH', room: '390' },
    ]);

    console.log('Seed complete');
  } finally {
    await pool.end();
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
seed(url).catch((err) => {
  console.error(err);
  process.exit(1);
});
