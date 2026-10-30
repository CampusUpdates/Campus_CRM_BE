import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const leads = await prisma.lead.findMany();

  let invalidCount = 0;
  let nullCount = 0;
  let lessThan10 = 0;
  let moreThan10 = 0;
  let nonNumeric = 0;

  const phoneCounts = new Map<string, number>();

  for (const lead of leads) {
    let isInvalid = false;
    const phone = lead.phone;

    if (!phone) {
      nullCount++;
      isInvalid = true;
    } else {
      if (phone.length < 10) {
        lessThan10++;
        isInvalid = true;
      } else if (phone.length > 10) {
        moreThan10++;
        isInvalid = true;
      }

      if (!/^\d+$/.test(phone)) {
        nonNumeric++;
        isInvalid = true;
      }

      if (phone.length === 10 && /^\d{10}$/.test(phone)) {
        phoneCounts.set(phone, (phoneCounts.get(phone) || 0) + 1);
      }
    }

    if (isInvalid) {
      invalidCount++;
    }
  }

  let duplicateCount = 0;
  for (const [phone, count] of phoneCounts.entries()) {
    if (count > 1) {
      duplicateCount += count;
    }
  }

  console.log('--- AUDIT RESULTS ---');
  console.log(`Total Leads: ${leads.length}`);
  console.log(`NULL / Empty: ${nullCount}`);
  console.log(`Fewer than 10: ${lessThan10}`);
  console.log(`More than 10: ${moreThan10}`);
  console.log(`Non-numeric: ${nonNumeric}`);
  console.log(`Total Invalid Format: ${invalidCount}`);
  console.log(`Total Leads with Duplicate Valid Phones: ${duplicateCount}`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
