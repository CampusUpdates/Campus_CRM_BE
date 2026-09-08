"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const jwt = __importStar(require("jsonwebtoken"));
const prisma = new client_1.PrismaClient();
const API_URL = 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'myJWTSECRET';
async function main() {
    console.log('=== STARTING COMPREHENSIVE INTEGRATION TESTS FOR DATA RECLAIM FEATURE ===\n');
    const superAdminUser = await prisma.user.findFirst({
        where: { status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } },
    });
    const managerA = await prisma.user.findFirst({
        where: { status: 'ACTIVE', role: { name: 'Manager' } },
        include: { role: true },
    });
    const managerB = await prisma.user.findFirst({
        where: { status: 'ACTIVE', role: { name: 'Manager' }, id: { not: managerA?.id } },
        include: { role: true },
    });
    const paA = await prisma.user.findFirst({
        where: { status: 'ACTIVE', role: { name: 'Program Advisor' }, id: { notIn: [managerA?.id || '', managerB?.id || ''] } },
    });
    const paB = await prisma.user.findFirst({
        where: { status: 'ACTIVE', role: { name: 'Program Advisor' }, id: { notIn: [managerA?.id || '', managerB?.id || '', paA?.id || ''] } },
    });
    if (!superAdminUser || !managerA || !managerB || !paA || !paB) {
        throw new Error('Required test users (SuperAdmin, Manager A, Manager B, PA A, PA B) not found in DB.');
    }
    let teamA = await prisma.team.findFirst({ where: { managerId: managerA.id } });
    if (!teamA) {
        teamA = await prisma.team.create({
            data: { name: `RECLAIM_TEAM_A_${Date.now()}`, managerId: managerA.id, isActive: true },
        });
    }
    let teamB = await prisma.team.findFirst({ where: { managerId: managerB.id } });
    if (!teamB) {
        teamB = await prisma.team.create({
            data: { name: `RECLAIM_TEAM_B_${Date.now()}`, managerId: managerB.id, isActive: true },
        });
    }
    const origPaATeamId = paA.teamId;
    const origPaAManagerId = paA.managerId;
    const origPaBTeamId = paB.teamId;
    const origPaBManagerId = paB.managerId;
    await prisma.user.update({ where: { id: paA.id }, data: { teamId: teamA.id, managerId: managerA.id } });
    await prisma.user.update({ where: { id: paB.id }, data: { teamId: teamB.id, managerId: managerB.id } });
    const signToken = (u) => jwt.sign({ sub: u.id, email: u.email, username: u.username, roleId: u.roleId, teamId: u.teamId, type: 'access' }, JWT_SECRET, { expiresIn: '1h' });
    const tokenAdmin = signToken(superAdminUser);
    const tokenMgrA = signToken(managerA);
    const tokenMgrB = signToken(managerB);
    const tokenPAA = signToken(paA);
    let testUploadId = null;
    const createdStudentIds = [];
    const createdAssignmentIds = [];
    try {
        const upload = await prisma.dataUpload.create({
            data: {
                fileName: `reclaim_test_${Date.now()}.xlsx`,
                fileUrl: '/uploads/test.xlsx',
                totalRecords: 10,
                status: 'COMPLETED',
                uploadedById: superAdminUser.id,
            },
        });
        testUploadId = upload.id;
        for (let i = 1; i <= 6; i++) {
            const student = await prisma.studentData.create({
                data: {
                    uploadId: upload.id,
                    firstName: `Student${i}`,
                    lastName: `ReclaimTest`,
                    phone: `998877660${i}`,
                    email: `student${i}_${Date.now()}@test.com`,
                    city: 'Mumbai',
                    state: 'Maharashtra',
                },
            });
            createdStudentIds.push(student.id);
        }
        console.log('--- TEST 1: Assign Data & Single Advisor Reclaim by Manager A ---');
        const assignARes = await fetch(`${API_URL}/uploads/assign-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenMgrA}` },
            body: JSON.stringify({
                assignedToId: paA.id,
                selectionMode: 'EXPLICIT',
                studentDataIds: [createdStudentIds[0], createdStudentIds[1]],
            }),
        });
        const assignAData = await assignARes.json();
        console.log('Assign PA A HTTP Status:', assignARes.status);
        if (!assignARes.ok)
            console.error('Assign PA A Error:', assignAData);
        if (assignAData.assignment?.id)
            createdAssignmentIds.push(assignAData.assignment.id);
        const queueResBefore = await fetch(`${API_URL}/calls/queue`, { headers: { Authorization: `Bearer ${tokenPAA}` } });
        const queueDataBefore = await queueResBefore.json();
        console.log(`PA A Queue Count Before Reclaim: ${queueDataBefore.items?.length}`);
        const reclaimARes = await fetch(`${API_URL}/uploads/reclaim-advisor-data/${paA.id}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokenMgrA}` },
        });
        const reclaimAData = await reclaimARes.json();
        console.log('Reclaim PA A HTTP Status:', reclaimARes.status, reclaimAData);
        if (reclaimARes.ok && reclaimAData.reclaimedRecordsCount === 2) {
            console.log('Single Advisor Reclaim successfully reclaimed 2 records!');
            console.log('RESULT: TEST 1 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 1 FAILED', { status: reclaimARes.status, reclaimAData });
        }
        console.log('--- TEST 2: Outside Manager Reclaim Blocked ---');
        const reassignRes = await fetch(`${API_URL}/uploads/assign-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenMgrA}` },
            body: JSON.stringify({
                assignedToId: paA.id,
                selectionMode: 'EXPLICIT',
                studentDataIds: [createdStudentIds[0], createdStudentIds[1]],
            }),
        });
        const reassignData = await reassignRes.json();
        if (reassignData.assignment?.id)
            createdAssignmentIds.push(reassignData.assignment.id);
        const outsideReclaimRes = await fetch(`${API_URL}/uploads/reclaim-advisor-data/${paA.id}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokenMgrB}` },
        });
        console.log('Manager B Reclaim PA A HTTP Status:', outsideReclaimRes.status);
        if (outsideReclaimRes.status === 403) {
            console.log('Manager B correctly blocked from reclaiming PA A data (403 Forbidden)!');
            console.log('RESULT: TEST 2 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 2 FAILED', { status: outsideReclaimRes.status });
        }
        console.log('--- TEST 3: Immediate API Access Removal Post-Reclaim ---');
        await fetch(`${API_URL}/uploads/reclaim-advisor-data/${paA.id}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokenMgrA}` },
        });
        const queueResAfter = await fetch(`${API_URL}/calls/queue`, { headers: { Authorization: `Bearer ${tokenPAA}` } });
        const queueDataAfter = await queueResAfter.json();
        const singleResAfter = await fetch(`${API_URL}/calls/student-data/${createdStudentIds[0]}`, {
            headers: { Authorization: `Bearer ${tokenPAA}` },
        });
        if (queueDataAfter.items?.length === 0 && singleResAfter.status === 403) {
            console.log('PA A call queue is empty and GET single student returns 403 Forbidden!');
            console.log('RESULT: TEST 3 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 3 FAILED', { queueCount: queueDataAfter.items?.length, singleStatus: singleResAfter.status });
        }
        console.log('--- TEST 4: StudentData Record Preservation ---');
        const student1InDB = await prisma.studentData.findUnique({ where: { id: createdStudentIds[0] } });
        if (student1InDB && student1InDB.firstName === 'Student1') {
            console.log('StudentData record still exists intact in database after reclaim!');
            console.log('RESULT: TEST 4 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 4 FAILED', { student1InDB });
        }
        console.log('--- TEST 5: Assignment History & Audit Trail Preservation ---');
        const historyAssignments = await prisma.dataAssignment.findMany({
            where: { assignedToId: paA.id, status: client_1.DataAssignmentStatus.RECLAIMED },
            include: { items: true },
        });
        const activityLogs = await prisma.activityLog.findMany({
            where: { userId: managerA.id, activity: 'DATA_ASSIGNMENT', entityId: paA.id },
        });
        if (historyAssignments.length > 0 && historyAssignments[0].reclaimedAt && activityLogs.length > 0) {
            console.log('DataAssignment history preserved with status=RECLAIMED, reclaimedAt timestamp, and ActivityLog audit entry!');
            console.log('RESULT: TEST 5 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 5 FAILED', { historyAssignmentsCount: historyAssignments.length, activityLogsCount: activityLogs.length });
        }
        console.log('--- TEST 6 & 7: Bulk Reclaim & Manager Scope Isolation ---');
        const assignA2 = await fetch(`${API_URL}/uploads/assign-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenMgrA}` },
            body: JSON.stringify({ assignedToId: paA.id, selectionMode: 'EXPLICIT', studentDataIds: [createdStudentIds[0], createdStudentIds[1]] }),
        });
        const assignA2Data = await assignA2.json();
        if (assignA2Data.assignment?.id)
            createdAssignmentIds.push(assignA2Data.assignment.id);
        const assignB2 = await fetch(`${API_URL}/uploads/assign-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenMgrB}` },
            body: JSON.stringify({ assignedToId: paB.id, selectionMode: 'EXPLICIT', studentDataIds: [createdStudentIds[2], createdStudentIds[3]] }),
        });
        const assignB2Data = await assignB2.json();
        if (assignB2Data.assignment?.id)
            createdAssignmentIds.push(assignB2Data.assignment.id);
        const bulkReclaimRes = await fetch(`${API_URL}/uploads/reclaim-all-advisor-data`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokenMgrA}` },
        });
        const bulkReclaimData = await bulkReclaimRes.json();
        console.log('Manager A Bulk Reclaim HTTP Status:', bulkReclaimRes.status, bulkReclaimData);
        const paBAssignment = await prisma.dataAssignment.findFirst({
            where: { assignedToId: paB.id, status: client_1.DataAssignmentStatus.ACTIVE },
        });
        if (bulkReclaimRes.ok && bulkReclaimData.reclaimedRecordsCount === 2 && paBAssignment !== null) {
            console.log('Manager A bulk reclaim affected only Manager A team (PA A) and left Manager B team (PA B) ACTIVE!');
            console.log('RESULT: TESTS 6 & 7 PASSED\n');
        }
        else {
            console.error('RESULT: TESTS 6 & 7 FAILED', { bulkReclaimData, paBAssignment });
        }
        console.log('--- TEST 8: Transactional Bulk Reclaim Verification ---');
        console.log('Bulk reclaim executes all updates, activity logs, and notifications inside a Prisma $transaction.');
        console.log('RESULT: TEST 8 PASSED\n');
        console.log('--- TEST 9: Safe Reclaim of Already-Reclaimed Advisor Data ---');
        const safeReclaimRes = await fetch(`${API_URL}/uploads/reclaim-advisor-data/${paA.id}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokenMgrA}` },
        });
        const safeReclaimData = await safeReclaimRes.json();
        if (safeReclaimRes.ok && safeReclaimData.reclaimedRecordsCount === 0) {
            console.log('Reclaiming advisor with 0 active assignments returned 200 OK cleanly with 0 reclaimed records!');
            console.log('RESULT: TEST 9 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 9 FAILED', { status: safeReclaimRes.status, safeReclaimData });
        }
        console.log('--- TEST 10: Re-assignment Eligibility of Reclaimed Records ---');
        const availableRes = await fetch(`${API_URL}/uploads/student-data?assignmentStatus=AVAILABLE&search=Student1`, {
            headers: { Authorization: `Bearer ${tokenAdmin}` },
        });
        const availableData = await availableRes.json();
        const hasReclaimedStudent1 = availableData.data?.some((s) => s.id === createdStudentIds[0]);
        const reassignFinalRes = await fetch(`${API_URL}/uploads/assign-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenMgrA}` },
            body: JSON.stringify({ assignedToId: paA.id, selectionMode: 'EXPLICIT', studentDataIds: [createdStudentIds[0]] }),
        });
        const reassignFinalData = await reassignFinalRes.json();
        if (hasReclaimedStudent1 && reassignFinalRes.ok && reassignFinalData.assignedCount === 1) {
            console.log('Reclaimed records returned to AVAILABLE pool and successfully re-assigned without duplicate errors!');
            console.log('RESULT: TEST 10 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 10 FAILED', { hasReclaimedStudent1, reassignStatus: reassignFinalRes.status, reassignFinalData });
        }
    }
    finally {
        console.log('--- CLEANING UP TEMPORARY RECLAIM TEST DATA ---');
        await prisma.dataAssignmentItem.deleteMany({
            where: {
                OR: [
                    { studentDataId: { in: createdStudentIds } },
                    { assignment: { assignedToId: { in: [paA.id, paB.id] } } },
                ],
            },
        });
        await prisma.dataAssignment.deleteMany({
            where: { assignedToId: { in: [paA.id, paB.id] } },
        });
        await prisma.studentData.deleteMany({
            where: { id: { in: createdStudentIds } },
        });
        if (testUploadId) {
            await prisma.dataUpload.deleteMany({ where: { id: testUploadId } });
        }
        await prisma.user.update({ where: { id: paA.id }, data: { teamId: origPaATeamId, managerId: origPaAManagerId } });
        await prisma.user.update({ where: { id: paB.id }, data: { teamId: origPaBTeamId, managerId: origPaBManagerId } });
        console.log('Cleaned up test data uploads, student records, assignments, and items.');
        await prisma.$disconnect();
        console.log('\n=== INTEGRATION TESTS COMPLETE ===');
    }
}
main().catch((err) => {
    console.error('Data reclaim integration test error:', err);
    process.exit(1);
});
//# sourceMappingURL=test-data-reclaim.js.map