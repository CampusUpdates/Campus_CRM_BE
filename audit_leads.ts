import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const allLeads = await prisma.lead.findMany({
    select: { id: true, phone: true }
  });

  console.log(`Total Leads: ${allLeads.length}`);

  const invalidLeads = allLeads.filter(l => {
    if (!l.phone) return true;
    if (!/^[0-9]{10}$/.test(l.phone)) return true;
    return false;
  });

  console.log(`Invalid Leads: ${invalidLeads.length}`);

  // Find duplicates
  const phoneCounts = new Map<string, number>();
  for (const l of allLeads) {
    if (l.phone) {
      phoneCounts.set(l.phone, (phoneCounts.get(l.phone) || 0) + 1);
    }
  }

  let duplicates = 0;
  for (const [phone, count] of phoneCounts.entries()) {
    if (count > 1) {
      console.log(`Duplicate phone: ${phone} (count: ${count})`);
      duplicates += (count - 1);
    }
  }

  console.log(`Duplicate Lead Phones: ${duplicates}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
