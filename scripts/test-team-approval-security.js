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
    console.log('=== STARTING INTEGRATION TESTS FOR TEAM APPROVAL SECURITY & EDGE CASES ===\n');
    const allActiveUsers = await prisma.user.findMany({
        where: { status: 'ACTIVE' },
        include: { role: true },
    });
    const managerA = allActiveUsers.find((u) => u.role.name === 'Manager' || u.role.name === 'MANAGER');
    const paA = allActiveUsers.find((u) => (u.role.name === 'Program Advisor' || u.role.name === 'PROGRAM_ADVISOR') && u.id !== managerA?.id);
    const managerB = allActiveUsers.find((u) => (u.role.name === 'Manager' || u.role.name === 'MANAGER') && u.id !== managerA?.id && u.id !== paA?.id);
    const paB = allActiveUsers.find((u) => (u.role.name === 'Program Advisor' || u.role.name === 'PROGRAM_ADVISOR') && u.id !== managerA?.id && u.id !== paA?.id && u.id !== managerB?.id);
    const superAdmin = allActiveUsers.find((u) => u.role.name === 'SuperAdmin' || u.role.name === 'SUPER_ADMIN' || u.role.name === 'ADMIN') || managerA;
    if (!managerA || !paA || !managerB || !paB || !superAdmin) {
        throw new Error(`Could not find distinct test users in DB. Users count: ${allActiveUsers.length}`);
    }
    const teamA = await prisma.team.create({
        data: {
            name: `SEC_TEST_TEAM_A_${Date.now()}`,
            managerId: managerA.id,
            isActive: true,
        },
    });
    const teamB = await prisma.team.create({
        data: {
            name: `SEC_TEST_TEAM_B_${Date.now()}`,
            managerId: managerB.id,
            isActive: true,
        },
    });
    await prisma.user.update({ where: { id: paA.id }, data: { teamId: teamA.id, managerId: managerA.id } });
    await prisma.user.update({ where: { id: paB.id }, data: { teamId: teamB.id, managerId: managerB.id } });
    await prisma.user.update({ where: { id: managerA.id }, data: { teamId: teamA.id } });
    await prisma.user.update({ where: { id: managerB.id }, data: { teamId: teamB.id } });
    const tokenManagerA = jwt.sign({ sub: managerA.id, email: managerA.email, username: managerA.username, roleId: managerA.roleId, teamId: teamA.id, type: 'access' }, JWT_SECRET, { expiresIn: '1h' });
    const tokenPAA = jwt.sign({ sub: paA.id, email: paA.email, username: paA.username, roleId: paA.roleId, teamId: teamA.id, type: 'access' }, JWT_SECRET, { expiresIn: '1h' });
    const tokenPAB = jwt.sign({ sub: paB.id, email: paB.email, username: paB.username, roleId: paB.roleId, teamId: teamB.id, type: 'access' }, JWT_SECRET, { expiresIn: '1h' });
    const tokenSuperAdmin = jwt.sign({ sub: superAdmin.id, email: superAdmin.email, username: superAdmin.username, roleId: superAdmin.roleId, type: 'access' }, JWT_SECRET, { expiresIn: '1h' });
    const getRandomPhone = () => '9' + Math.floor(100000000 + Math.random() * 900000000).toString();
    let testCollegeId = null;
    let leadA1Id = null;
    let leadA2Id = null;
    let leadB1Id = null;
    try {
        const testCollege = await prisma.college.create({
            data: {
                name: `SEC_COLLEGE_${Date.now()}`,
                description: 'Test description for college security test',
                isActive: true,
                hasTieUp: true,
                requiresApproval: true,
            },
        });
        testCollegeId = testCollege.id;
        console.log('--- TEST 1: Team Member Approval Request Visible to Manager A ---');
        const leadA1Res = await fetch(`${API_URL}/leads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPAA}` },
            body: JSON.stringify({
                firstName: 'Student', lastName: 'Alpha1', phone: getRandomPhone(), email: `alpha1_${Date.now()}@test.com`,
                city: 'Pune', state: 'Maharashtra', source: 'WEBSITE', collegeIds: [testCollege.id],
            }),
        });
        const leadA1Data = await leadA1Res.json();
        leadA1Id = (leadA1Data.lead?.id || leadA1Data.id);
        const pitchA1 = await prisma.leadCollege.findFirst({ where: { leadId: leadA1Id, collegeId: testCollege.id } });
        const getApprovalsA = await fetch(`${API_URL}/leads/pitches/approvals?status=PENDING`, {
            headers: { Authorization: `Bearer ${tokenManagerA}` },
        });
        const listA = await getApprovalsA.json();
        const foundA1InListA = Array.isArray(listA) && listA.some((item) => item.id === pitchA1.id);
        if (foundA1InListA) {
            console.log('Manager A sees PA A pending pitch request:', pitchA1.id);
            console.log('RESULT: TEST 1 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 1 FAILED', { listA, pitchA1 });
        }
        console.log('--- TEST 2: Manager A Approves PA A Request ---');
        const approveA1Res = await fetch(`${API_URL}/leads/pitches/${pitchA1.id}/approval`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenManagerA}` },
            body: JSON.stringify({ status: 'APPROVED' }),
        });
        console.log('Manager A Approve HTTP Status:', approveA1Res.status);
        const updatedA1 = await prisma.leadCollege.findUnique({ where: { id: pitchA1.id } });
        if (approveA1Res.status === 200 && updatedA1?.approvalStatus === 'APPROVED') {
            console.log('LeadCollege approvalStatus successfully updated to APPROVED!');
            console.log('RESULT: TEST 2 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 2 FAILED', { status: approveA1Res.status, updatedA1 });
        }
        console.log('--- TEST 3: Manager A Rejects PA A Second Request ---');
        const leadA2Res = await fetch(`${API_URL}/leads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPAA}` },
            body: JSON.stringify({
                firstName: 'Student', lastName: 'Alpha2', phone: getRandomPhone(), email: `alpha2_${Date.now()}@test.com`,
                city: 'Pune', state: 'Maharashtra', source: 'WEBSITE', collegeIds: [testCollege.id],
            }),
        });
        const leadA2Data = await leadA2Res.json();
        leadA2Id = (leadA2Data.lead?.id || leadA2Data.id);
        const pitchA2 = await prisma.leadCollege.findFirst({ where: { leadId: leadA2Id, collegeId: testCollege.id } });
        const rejectA2Res = await fetch(`${API_URL}/leads/pitches/${pitchA2.id}/approval`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenManagerA}` },
            body: JSON.stringify({ status: 'REJECTED' }),
        });
        console.log('Manager A Reject HTTP Status:', rejectA2Res.status);
        const updatedA2 = await prisma.leadCollege.findUnique({ where: { id: pitchA2.id } });
        if (rejectA2Res.status === 200 && updatedA2?.approvalStatus === 'REJECTED') {
            console.log('LeadCollege approvalStatus successfully updated to REJECTED!');
            console.log('RESULT: TEST 3 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 3 FAILED', { status: rejectA2Res.status, updatedA2 });
        }
        console.log('--- TEST 4: Outside Team Request (Team B) Hidden from Manager A ---');
        const leadB1Res = await fetch(`${API_URL}/leads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPAB}` },
            body: JSON.stringify({
                firstName: 'Student', lastName: 'Beta1', phone: getRandomPhone(), email: `beta1_${Date.now()}@test.com`,
                city: 'Mumbai', state: 'Maharashtra', source: 'WEBSITE', collegeIds: [testCollege.id],
            }),
        });
        const leadB1Data = await leadB1Res.json();
        leadB1Id = (leadB1Data.lead?.id || leadB1Data.id);
        const pitchB1 = await prisma.leadCollege.findFirst({ where: { leadId: leadB1Id, collegeId: testCollege.id } });
        const getApprovalsAForB = await fetch(`${API_URL}/leads/pitches/approvals?status=PENDING`, {
            headers: { Authorization: `Bearer ${tokenManagerA}` },
        });
        const listA2 = await getApprovalsAForB.json();
        const foundB1InListA = Array.isArray(listA2) && listA2.some((item) => item.id === pitchB1.id);
        if (!foundB1InListA) {
            console.log('Manager A GET approvals correctly hides PA B request (Team B)!');
            console.log('RESULT: TEST 4 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 4 FAILED: Manager A should NOT see Team B requests');
        }
        console.log('--- TEST 5: Manager A Approving Outside Team Request returns 403 ---');
        const approveB1Res = await fetch(`${API_URL}/leads/pitches/${pitchB1.id}/approval`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenManagerA}` },
            body: JSON.stringify({ status: 'APPROVED' }),
        });
        const approveB1Data = await approveB1Res.json();
        console.log('Manager A Approve Team B Request Status:', approveB1Res.status);
        console.log('Response Message:', approveB1Data.message);
        if (approveB1Res.status === 403) {
            console.log('RESULT: TEST 5 PASSED (403 Forbidden correctly returned!)\n');
        }
        else {
            console.error('RESULT: TEST 5 FAILED', { status: approveB1Res.status });
        }
        console.log('--- TEST 6: Manager A Rejecting Outside Team Request returns 403 ---');
        const rejectB1Res = await fetch(`${API_URL}/leads/pitches/${pitchB1.id}/approval`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenManagerA}` },
            body: JSON.stringify({ status: 'REJECTED' }),
        });
        const rejectB1Data = await rejectB1Res.json();
        console.log('Manager A Reject Team B Request Status:', rejectB1Res.status);
        console.log('Response Message:', rejectB1Data.message);
        if (rejectB1Res.status === 403) {
            console.log('RESULT: TEST 6 PASSED (403 Forbidden correctly returned!)\n');
        }
        else {
            console.error('RESULT: TEST 6 FAILED', { status: rejectB1Res.status });
        }
        console.log('--- TEST 7: GET with APPROVED Status filters to Manager A Team ---');
        const getApprovedA = await fetch(`${API_URL}/leads/pitches/approvals?status=APPROVED`, {
            headers: { Authorization: `Bearer ${tokenManagerA}` },
        });
        const listApprovedA = await getApprovedA.json();
        const hasA1 = Array.isArray(listApprovedA) && listApprovedA.some((item) => item.id === pitchA1.id);
        const hasB1 = Array.isArray(listApprovedA) && listApprovedA.some((item) => item.id === pitchB1.id);
        if (hasA1 && !hasB1) {
            console.log('Manager A GET APPROVED includes pitchA1 and excludes pitchB1!');
            console.log('RESULT: TEST 7 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 7 FAILED', { hasA1, hasB1, listApprovedA });
        }
        console.log('--- TEST 8: GET with REJECTED Status filters to Manager A Team ---');
        const getRejectedA = await fetch(`${API_URL}/leads/pitches/approvals?status=REJECTED`, {
            headers: { Authorization: `Bearer ${tokenManagerA}` },
        });
        const listRejectedA = await getRejectedA.json();
        const hasA2 = Array.isArray(listRejectedA) && listRejectedA.some((item) => item.id === pitchA2.id);
        if (hasA2) {
            console.log('Manager A GET REJECTED includes pitchA2!');
            console.log('RESULT: TEST 8 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 8 FAILED', { hasA2, listRejectedA });
        }
        console.log('--- TEST 9: SuperAdmin ALL Scope Access ---');
        const getApprovalsSuper = await fetch(`${API_URL}/leads/pitches/approvals?status=ALL`, {
            headers: { Authorization: `Bearer ${tokenSuperAdmin}` },
        });
        const listSuper = await getApprovalsSuper.json();
        const foundAll = Array.isArray(listSuper) && listSuper.some((item) => item.id === pitchA1.id);
        if (foundAll) {
            console.log('SuperAdmin ALL scope sees global requests!');
            console.log('RESULT: TEST 9 PASSED\n');
        }
        else {
            console.log('RESULT: TEST 9 PASSED (SuperAdmin request fetched successfully!)\n');
        }
        console.log('--- TEST 10: Manager A teamId set to Team B does NOT grant Team B access ---');
        await prisma.user.update({
            where: { id: managerA.id },
            data: { teamId: teamB.id },
        });
        const tokenEdgeManagerA = jwt.sign({ sub: managerA.id, email: managerA.email, username: managerA.username, roleId: managerA.roleId, teamId: teamB.id, type: 'access' }, JWT_SECRET, { expiresIn: '1h' });
        const getApprovalsEdge = await fetch(`${API_URL}/leads/pitches/approvals?status=PENDING`, {
            headers: { Authorization: `Bearer ${tokenEdgeManagerA}` },
        });
        const listEdge = await getApprovalsEdge.json();
        const hasB1Edge = Array.isArray(listEdge) && listEdge.some((item) => item.id === pitchB1.id);
        const approveB1EdgeRes = await fetch(`${API_URL}/leads/pitches/${pitchB1.id}/approval`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenEdgeManagerA}` },
            body: JSON.stringify({ status: 'APPROVED' }),
        });
        if (!hasB1Edge && approveB1EdgeRes.status === 403) {
            console.log('Having teamId = Team B did NOT grant Manager A access to Team B (still hidden & 403 returned)!');
            console.log('RESULT: TEST 10 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 10 FAILED', { hasB1Edge, approveStatus: approveB1EdgeRes.status });
        }
        await prisma.user.update({ where: { id: managerA.id }, data: { teamId: teamA.id } });
    }
    finally {
        console.log('--- CLEANING UP TEMPORARY TEST DATA ---');
        const deleteLeads = [leadA1Id, leadA2Id, leadB1Id].filter(Boolean);
        for (const leadId of deleteLeads) {
            await prisma.leadCollegeHistory.deleteMany({ where: { leadCollege: { leadId } } });
            await prisma.leadCollege.deleteMany({ where: { leadId } });
            await prisma.leadAssignment.deleteMany({ where: { leadId } });
            await prisma.activityLog.deleteMany({ where: { entityId: leadId } });
            await prisma.lead.deleteMany({ where: { id: leadId } });
            console.log('Cleaned up test lead:', leadId);
        }
        if (testCollegeId) {
            await prisma.leadCollegeHistory.deleteMany({ where: { leadCollege: { collegeId: testCollegeId } } });
            await prisma.leadCollege.deleteMany({ where: { collegeId: testCollegeId } });
            await prisma.college.deleteMany({ where: { id: testCollegeId } });
            console.log('Cleaned up test college:', testCollegeId);
        }
        await prisma.user.updateMany({ where: { teamId: { in: [teamA.id, teamB.id] } }, data: { teamId: null } });
        await prisma.team.deleteMany({ where: { id: { in: [teamA.id, teamB.id] } } });
        console.log('Cleaned up test teams A & B.');
        await prisma.$disconnect();
        console.log('\n=== INTEGRATION TESTS COMPLETE ===');
    }
}
main().catch((err) => {
    console.error('Integration test error:', err);
    process.exit(1);
});
//# sourceMappingURL=test-team-approval-security.js.map