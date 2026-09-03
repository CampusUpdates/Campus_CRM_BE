import { PrismaClient } from '@prisma/client';
import * as jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const API_URL = 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'myJWTSECRET';

async function main() {
  console.log('=== STARTING INTEGRATION TESTS FOR PIPELINE LOCKING ===\n');

  // 1. Setup Auth Users
  const superAdminUser = await prisma.user.findFirst({
    where: { status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } },
    include: { role: true },
  });

  const paUser = await prisma.user.findFirst({
    where: { status: 'ACTIVE', role: { name: 'Program Advisor' } },
    include: { role: true },
  }) || superAdminUser;

  if (!superAdminUser || !paUser) {
    throw new Error('Required auth users not found in database.');
  }

  const superAdminToken = jwt.sign(
    {
      sub: superAdminUser.id,
      email: superAdminUser.email,
      username: superAdminUser.username,
      firstName: superAdminUser.firstName,
      lastName: superAdminUser.lastName,
      roleId: superAdminUser.roleId,
      teamId: superAdminUser.teamId,
      type: 'access',
    },
    JWT_SECRET,
    { expiresIn: '1h' },
  );

  const paToken = jwt.sign(
    {
      sub: paUser.id,
      email: paUser.email,
      username: paUser.username,
      firstName: paUser.firstName,
      lastName: paUser.lastName,
      roleId: paUser.roleId,
      teamId: paUser.teamId,
      type: 'access',
    },
    JWT_SECRET,
    { expiresIn: '1h' },
  );

  // Fetch status objects
  const defaultStatus = await prisma.leadStatus.findFirst({ where: { name: 'LEAD' } });
  const appStatus = await prisma.leadStatus.findFirst({ where: { name: 'APPLICATION' } });
  const interviewStatus = await prisma.leadStatus.findFirst({ where: { name: 'INTERVIEW_SCHEDULED' } });

  if (!defaultStatus || !appStatus || !interviewStatus) {
    throw new Error('Required LeadStatus records not found in database.');
  }

  const getRandomPhone = () => '9' + Math.floor(100000000 + Math.random() * 900000000).toString();

  const testCollegeIds: string[] = [];
  const testLeadIds: string[] = [];

  try {
    // 2. Setup Test Colleges
    const collegePending = await prisma.college.create({
      data: {
        name: `LOCK_TEST_COLLEGE_PENDING_${Date.now()}`,
        description: 'Test Pending College',
        isActive: true,
        hasTieUp: true,
        requiresApproval: true,
      },
    });
    testCollegeIds.push(collegePending.id);

    const collegeApproved = await prisma.college.create({
      data: {
        name: `LOCK_TEST_COLLEGE_APPROVED_${Date.now()}`,
        description: 'Test Approved College',
        isActive: true,
        hasTieUp: true,
        requiresApproval: false,
      },
    });
    testCollegeIds.push(collegeApproved.id);

    const collegeRejected = await prisma.college.create({
      data: {
        name: `LOCK_TEST_COLLEGE_REJECTED_${Date.now()}`,
        description: 'Test Rejected College',
        isActive: true,
        hasTieUp: true,
        requiresApproval: true,
      },
    });
    testCollegeIds.push(collegeRejected.id);

    // --- TEST 1: PENDING LeadCollege cannot change pipeline ---
    console.log('--- TEST 1: PENDING LeadCollege cannot change pipeline ---');
    const createRes1 = await fetch(`${API_URL}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${paToken}`,
      },
      body: JSON.stringify({
        firstName: 'Test1',
        lastName: 'PendingLock',
        phone: getRandomPhone(),
        email: `test1_pending_${Date.now()}@example.com`,
        city: 'City',
        state: 'State',
        source: 'WEBSITE',
        collegeIds: [collegePending.id],
      }),
    });
    const createData1 = await createRes1.json();
    const lead1Id = createData1.lead?.id || createData1.id;
    testLeadIds.push(lead1Id);

    // Attempt pipeline change on PENDING college pitch
    const patchRes1 = await fetch(`${API_URL}/leads/${lead1Id}/pipeline`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${paToken}`,
      },
      body: JSON.stringify({
        statusId: appStatus.id,
        collegeId: collegePending.id,
        applicationId: `APP_${Date.now()}`,
      }),
    });
    const patchData1 = await patchRes1.json();
    console.log('PATCH Status:', patchRes1.status);
    console.log('Error Message:', patchData1.message);

    const pitch1 = await prisma.leadCollege.findFirst({
      where: { leadId: lead1Id, collegeId: collegePending.id },
    });
    const history1Count = await prisma.leadCollegeHistory.count({
      where: { leadCollegeId: pitch1!.id },
    });

    if (
      patchRes1.status === 400 &&
      pitch1?.statusId === defaultStatus.id &&
      history1Count === 0
    ) {
      console.log('Database Verification: LeadCollege statusId unchanged, 0 history audit records created.');
      console.log('RESULT: TEST 1 PASSED\n');
    } else {
      console.error('RESULT: TEST 1 FAILED', { status: patchRes1.status, pitch1Status: pitch1?.statusId, historyCount1: history1Count });
    }

    // --- TEST 2: REJECTED LeadCollege cannot change pipeline ---
    console.log('--- TEST 2: REJECTED LeadCollege cannot change pipeline ---');
    const createRes2 = await fetch(`${API_URL}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${paToken}`,
      },
      body: JSON.stringify({
        firstName: 'Test2',
        lastName: 'RejectedLock',
        phone: getRandomPhone(),
        email: `test2_rejected_${Date.now()}@example.com`,
        city: 'City',
        state: 'State',
        source: 'WEBSITE',
        collegeIds: [collegeRejected.id],
      }),
    });
    const createData2 = await createRes2.json();
    const lead2Id = createData2.lead?.id || createData2.id;
    testLeadIds.push(lead2Id);

    const pitch2 = await prisma.leadCollege.findFirst({
      where: { leadId: lead2Id, collegeId: collegeRejected.id },
    });

    // Manually set approvalStatus to REJECTED for test setup
    await prisma.leadCollege.update({
      where: { id: pitch2!.id },
      data: { approvalStatus: 'REJECTED' },
    });

    const patchRes2 = await fetch(`${API_URL}/leads/${lead2Id}/pipeline`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${paToken}`,
      },
      body: JSON.stringify({
        statusId: appStatus.id,
        collegeId: collegeRejected.id,
        applicationId: `APP_${Date.now()}`,
      }),
    });
    const patchData2 = await patchRes2.json();
    console.log('PATCH Status:', patchRes2.status);
    console.log('Error Message:', patchData2.message);

    const pitch2Updated = await prisma.leadCollege.findUnique({
      where: { id: pitch2!.id },
    });
    const history2Count = await prisma.leadCollegeHistory.count({
      where: { leadCollegeId: pitch2!.id },
    });

    if (
      patchRes2.status === 400 &&
      pitch2Updated?.statusId === defaultStatus.id &&
      history2Count === 0
    ) {
      console.log('Database Verification: LeadCollege statusId unchanged, 0 history audit records created.');
      console.log('RESULT: TEST 2 PASSED\n');
    } else {
      console.error('RESULT: TEST 2 FAILED', { status: patchRes2.status, pitch2Status: pitch2Updated?.statusId, historyCount2: history2Count });
    }

    // --- TEST 3: APPROVED LeadCollege can make a valid pipeline transition ---
    console.log('--- TEST 3: APPROVED LeadCollege can make a valid pipeline transition ---');
    const createRes3 = await fetch(`${API_URL}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        firstName: 'Test3',
        lastName: 'ApprovedPass',
        phone: getRandomPhone(),
        email: `test3_approved_${Date.now()}@example.com`,
        city: 'City',
        state: 'State',
        source: 'WEBSITE',
        collegeIds: [collegeApproved.id],
      }),
    });
    const createData3 = await createRes3.json();
    const lead3Id = createData3.lead?.id || createData3.id;
    testLeadIds.push(lead3Id);

    const pitch3 = await prisma.leadCollege.findFirst({
      where: { leadId: lead3Id, collegeId: collegeApproved.id },
    });

    const patchRes3 = await fetch(`${API_URL}/leads/${lead3Id}/pipeline`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        statusId: appStatus.id,
        collegeId: collegeApproved.id,
        applicationId: `APP_${Date.now()}`,
      }),
    });
    console.log('PATCH Status:', patchRes3.status);

    const pitch3Updated = await prisma.leadCollege.findUnique({
      where: { id: pitch3!.id },
    });
    const history3Count = await prisma.leadCollegeHistory.count({
      where: { leadCollegeId: pitch3!.id },
    });

    if (
      patchRes3.status === 200 &&
      pitch3Updated?.statusId === appStatus.id &&
      history3Count === 1
    ) {
      console.log('Database Verification: LeadCollege statusId updated to APPLICATION, history record created.');
      console.log('RESULT: TEST 3 PASSED\n');
    } else {
      console.error('RESULT: TEST 3 FAILED', { status: patchRes3.status, pitch3Status: pitch3Updated?.statusId, historyCount3: history3Count });
    }

    // --- TEST 4: PENDING pitch does NOT block APPROVED pitch for same Lead ---
    console.log('--- TEST 4: PENDING pitch (RIIM) does NOT block APPROVED pitch (IMT) for same Lead ---');
    const createRes4 = await fetch(`${API_URL}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${paToken}`,
      },
      body: JSON.stringify({
        firstName: 'Test4',
        lastName: 'MultiCollege',
        phone: getRandomPhone(),
        email: `test4_multi_${Date.now()}@example.com`,
        city: 'City',
        state: 'State',
        source: 'WEBSITE',
        collegeIds: [collegePending.id, collegeApproved.id],
      }),
    });
    const createData4 = await createRes4.json();
    const lead4Id = createData4.lead?.id || createData4.id;
    testLeadIds.push(lead4Id);

    // Attempt pipeline change on Pending RIIM pitch (should fail 400)
    const patchPendingRes = await fetch(`${API_URL}/leads/${lead4Id}/pipeline`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${paToken}`,
      },
      body: JSON.stringify({
        statusId: appStatus.id,
        collegeId: collegePending.id,
        applicationId: `APP_${Date.now()}`,
      }),
    });
    console.log('Pending Pitch (RIIM) PATCH Status:', patchPendingRes.status);

    // Attempt pipeline change on Approved IMT pitch (should succeed 200)
    const patchApprovedRes = await fetch(`${API_URL}/leads/${lead4Id}/pipeline`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${paToken}`,
      },
      body: JSON.stringify({
        statusId: appStatus.id,
        collegeId: collegeApproved.id,
        applicationId: `APP_${Date.now()}`,
      }),
    });
    console.log('Approved Pitch (IMT) PATCH Status:', patchApprovedRes.status);

    if (patchPendingRes.status === 400 && patchApprovedRes.status === 200) {
      console.log('RESULT: TEST 4 PASSED (Pending RIIM pitch blocked, Approved IMT pitch allowed for same lead!)\n');
    } else {
      console.error('RESULT: TEST 4 FAILED', { pendingStatus: patchPendingRes.status, approvedStatus: patchApprovedRes.status });
    }

    // --- TEST 5: Invalid pipeline transition rejected when APPROVED ---
    console.log('--- TEST 5: Invalid pipeline transition rejected when APPROVED ---');
    const patchRes5 = await fetch(`${API_URL}/leads/${lead3Id}/pipeline`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        statusId: 999999, // non-existent status ID
        collegeId: collegeApproved.id,
      }),
    });
    console.log('Invalid Transition PATCH Status:', patchRes5.status);

    if (patchRes5.status === 400 || patchRes5.status === 404) {
      console.log('RESULT: TEST 5 PASSED (Existing transition validation preserved)\n');
    } else {
      console.error('RESULT: TEST 5 FAILED', { status: patchRes5.status });
    }

  } finally {
    // Teardown
    console.log('--- CLEANING UP TEMPORARY TEST DATA ---');
    for (const leadId of testLeadIds) {
      await prisma.leadCollegeHistory.deleteMany({ where: { leadCollege: { leadId } } });
      await prisma.leadCollege.deleteMany({ where: { leadId } });
      await prisma.leadAssignment.deleteMany({ where: { leadId } });
      await prisma.activityLog.deleteMany({ where: { entityId: leadId } });
      await prisma.lead.deleteMany({ where: { id: leadId } });
    }
    console.log(`Cleaned up ${testLeadIds.length} temporary test leads.`);

    for (const collegeId of testCollegeIds) {
      await prisma.leadCollegeHistory.deleteMany({ where: { leadCollege: { collegeId } } });
      await prisma.leadCollege.deleteMany({ where: { collegeId } });
      await prisma.college.deleteMany({ where: { id: collegeId } });
    }
    console.log(`Cleaned up ${testCollegeIds.length} temporary test colleges.`);

    await prisma.$disconnect();
    console.log('=== PIPELINE LOCKING INTEGRATION TESTS COMPLETE ===');
  }
}

main().catch((err) => {
  console.error('Integration test error:', err);
  process.exit(1);
});
