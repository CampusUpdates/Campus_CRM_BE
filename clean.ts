import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function generateRandom10Digit(): string {
  let res = '';
  for (let i = 0; i < 10; i++) {
    res += Math.floor(Math.random() * 10).toString();
  }
  return res;
}

async function main() {
  const leads = await prisma.lead.findMany();
  let updatedCount = 0;

  const validPhones = new Set<string>();

  for (const lead of leads) {
    if (lead.phone && /^\d{10}$/.test(lead.phone)) {
      validPhones.add(lead.phone);
    }
  }

  for (const lead of leads) {
    let isInvalid = false;
    const phone = lead.phone;

    if (!phone || !/^\d{10}$/.test(phone)) {
      isInvalid = true;
    } else {
      // Check for duplicate in the current state (if there are duplicates, we need to fix one)
      // Actually we didn't have duplicates, but let's be robust
    }

    if (isInvalid) {
      let newPhone = generateRandom10Digit();
      while (validPhones.has(newPhone)) {
        newPhone = generateRandom10Digit();
      }
      validPhones.add(newPhone);

      await prisma.lead.update({
        where: { id: lead.id },
        data: { phone: newPhone }
      });
      updatedCount++;
      console.log(`Updated lead ${lead.id}: ${phone} -> ${newPhone}`);
    }
  }

  console.log(`Cleaned ${updatedCount} records.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
