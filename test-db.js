const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const uploads = await prisma.dataUpload.findMany({
    where: { fileName: { contains: 'test', mode: 'insensitive' } },
    select: { id: true, fileName: true, _count: { select: { studentData: true } } }
  });
  console.log('Test Uploads:', uploads);

  const students = await prisma.studentData.findMany({
    where: { firstName: { contains: 'test', mode: 'insensitive' } },
    take: 5,
    select: { id: true, firstName: true }
  });
  console.log('Test Students:', students);
}

main().catch(console.error).finally(() => prisma.$disconnect());
