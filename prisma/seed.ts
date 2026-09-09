import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const subjects = [
    ['Anatomy', 'anatomy'],
    ['Physiology', 'physiology'],
    ['Biochemistry', 'biochemistry'],
    ['Pathology', 'pathology'],
    ['Pharmacology', 'pharmacology'],
    ['Microbiology', 'microbiology'],
    ['Community Medicine', 'community-medicine'],
    ['Medicine', 'medicine'],
    ['Surgery', 'surgery'],
    ['Pediatrics', 'pediatrics'],
    ['Obstetrics & Gynecology', 'obgyn'],
  ] as const;

  for (let i = 0; i < subjects.length; i++) {
    await db.subject.upsert({
      where: { code: subjects[i][1] },
      create: { name: subjects[i][0], code: subjects[i][1], order: i + 1 },
      update: { name: subjects[i][0], order: i + 1 },
    });
  }

  console.log(`Seeded ${subjects.length} core medical subjects.`);
}

main().finally(() => db.$disconnect());
