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
    console.log('=== STARTING COMPREHENSIVE INTEGRATION TESTS FOR LEAD & TEAM REGRESSION FIX ===\n');
    const superAdminUser = await prisma.user.findFirst({
        where: { status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } },
        include: { role: true },
    });
    const hrUser = await prisma.user.findFirst({
        where: { status: 'ACTIVE', role: { name: 'HR' } },
        include: { role: true },
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
        include: { role: true },
    });
    if (!superAdminUser || !hrUser || !managerA || !managerB || !paA) {
        throw new Error('Required test users (SuperAdmin, HR, Manager A, Manager B, PA A) not found in DB.');
    }
    let teamA = await prisma.team.findFirst({ where: { managerId: managerA.id } });
    if (!teamA) {
        teamA = await prisma.team.create({
            data: { name: `REGRESSION_TEAM_A_${Date.now()}`, managerId: managerA.id, isActive: true },
        });
    }
    let teamB = await prisma.team.findFirst({ where: { managerId: managerB.id } });
    if (!teamB) {
        teamB = await prisma.team.create({
            data: { name: `REGRESSION_TEAM_B_${Date.now()}`, managerId: managerB.id, isActive: true },
        });
    }
    const origPaATeamId = paA.teamId;
    const origPaAManagerId = paA.managerId;
    await prisma.user.update({
        where: { id: paA.id },
        data: { teamId: teamA.id, managerId: managerA.id },
    });
    const signToken = (u) => jwt.sign({ sub: u.id, email: u.email, username: u.username, roleId: u.roleId, teamId: u.teamId, type: 'access' }, JWT_SECRET, { expiresIn: '1h' });
    const tokenAdmin = signToken(superAdminUser);
    const tokenHR = signToken(hrUser);
    const tokenMgrA = signToken(managerA);
    const tokenMgrB = signToken(managerB);
    const tokenPAA = signToken(paA);
    const getRandomPhone = () => '9' + Math.floor(100000000 + Math.random() * 900000000).toString();
    let testCollegeReqAppId = null;
    const createdLeadIds = [];
    const createdNotifIds = [];
    try {
        const testCollege = await prisma.college.create({
            data: {
                name: `REGRESSION_COLLEGE_${Date.now()}`,
                description: 'Test college',
                isActive: true,
                hasTieUp: true,
                requiresApproval: true,
            },
        });
        testCollegeReqAppId = testCollege.id;
        console.log('--- TEST 1: PA Leads Visibility ---');
        const leadPARes = await fetch(`${API_URL}/leads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPAA}` },
            body: JSON.stringify({
                firstName: 'PALead', lastName: 'RegTest1', phone: getRandomPhone(), email: `pareg1_${Date.now()}@test.com`,
                city: 'Mumbai', state: 'Maharashtra', source: 'WEBSITE', collegeIds: [testCollege.id],
            }),
        });
        const leadPAData = await leadPARes.json();
        const leadPAId = (leadPAData.lead?.id || leadPAData.id);
        if (!leadPAId) {
            console.error('Failed to create leadPA:', leadPARes.status, leadPAData);
            throw new Error('Lead PA creation failed.');
        }
        createdLeadIds.push(leadPAId);
        const getPALeadsRes = await fetch(`${API_URL}/leads`, { headers: { Authorization: `Bearer ${tokenPAA}` } });
        const paLeads = await getPALeadsRes.json();
        const hasPALead = Array.isArray(paLeads) && paLeads.some((l) => l.id === leadPAId);
        if (getPALeadsRes.ok && hasPALead) {
            console.log('PA successfully listed authorized created lead!');
            console.log('RESULT: TEST 1 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 1 FAILED', { status: getPALeadsRes.status, hasPALead, paLeads });
        }
        console.log('--- TEST 2: Manager Leads Visibility ---');
        const getMgrALeadsRes = await fetch(`${API_URL}/leads`, { headers: { Authorization: `Bearer ${tokenMgrA}` } });
        const mgrALeads = await getMgrALeadsRes.json();
        const hasTeamALead = Array.isArray(mgrALeads) && mgrALeads.some((l) => l.id === leadPAId);
        if (getMgrALeadsRes.ok && hasTeamALead) {
            console.log('Manager A successfully listed team member PA A lead!');
            console.log('RESULT: TEST 2 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 2 FAILED', { status: getMgrALeadsRes.status, hasTeamALead, mgrALeads });
        }
        console.log('--- TEST 3: Admin/SuperAdmin Leads Visibility ---');
        const getAdminLeadsRes = await fetch(`${API_URL}/leads`, { headers: { Authorization: `Bearer ${tokenAdmin}` } });
        const adminLeads = await getAdminLeadsRes.json();
        const hasAdminLead = Array.isArray(adminLeads) && adminLeads.some((l) => l.id === leadPAId);
        if (getAdminLeadsRes.ok && hasAdminLead) {
            console.log('SuperAdmin successfully listed global lead!');
            console.log('RESULT: TEST 3 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 3 FAILED', { status: getAdminLeadsRes.status, hasAdminLead });
        }
        console.log('--- TEST 4: HR Leads Visibility ---');
        const getHRLeadsRes = await fetch(`${API_URL}/leads`, { headers: { Authorization: `Bearer ${tokenHR}` } });
        const hrLeads = await getHRLeadsRes.json();
        if (getHRLeadsRes.ok && Array.isArray(hrLeads)) {
            console.log('HR successfully fetched leads list with HTTP 200!');
            console.log('RESULT: TEST 4 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 4 FAILED', { status: getHRLeadsRes.status, hrLeads });
        }
        console.log('--- TEST 5: GET Lead by ID ---');
        const getSingleRes = await fetch(`${API_URL}/leads/${leadPAId}`, { headers: { Authorization: `Bearer ${tokenPAA}` } });
        const singleLeadData = await getSingleRes.json();
        if (getSingleRes.ok && singleLeadData.id === leadPAId && singleLeadData.firstName === 'PALead') {
            console.log('GET /leads/:id returned 200 and complete lead details!');
            console.log('RESULT: TEST 5 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 5 FAILED', { status: getSingleRes.status, singleLeadData });
        }
        console.log('--- TEST 6: Manager Team Members Retrieval ---');
        const teamMembersRes = await fetch(`${API_URL}/teams/${teamA.id}/members`, { headers: { Authorization: `Bearer ${tokenMgrA}` } });
        const teamMembers = await teamMembersRes.json();
        const hasPAAMember = Array.isArray(teamMembers) && teamMembers.some((m) => m.id === paA.id);
        if (teamMembersRes.ok && hasPAAMember) {
            console.log('Manager A successfully retrieved team members including PA A!');
            console.log('RESULT: TEST 6 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 6 FAILED', { status: teamMembersRes.status, teamMembers });
        }
        console.log('--- TEST 7: Team Isolation Verification ---');
        const mgrBLeadsRes = await fetch(`${API_URL}/leads`, { headers: { Authorization: `Bearer ${tokenMgrB}` } });
        const mgrBLeads = await mgrBLeadsRes.json();
        const hasOutsideLeadInB = Array.isArray(mgrBLeads) && mgrBLeads.some((l) => l.id === leadPAId);
        const mgrBMembersRes = await fetch(`${API_URL}/teams/${teamA.id}/members`, { headers: { Authorization: `Bearer ${tokenMgrB}` } });
        if (!hasOutsideLeadInB && mgrBMembersRes.status === 403) {
            console.log('Manager B cannot access Manager A team lead or team members (403 returned)!');
            console.log('RESULT: TEST 7 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 7 FAILED', { hasOutsideLeadInB, mgrBMembersStatus: mgrBMembersRes.status });
        }
        console.log('--- TEST 8: Edit Lead Latest Data Loading ---');
        const editFetchRes = await fetch(`${API_URL}/leads/${leadPAId}`, { headers: { Authorization: `Bearer ${tokenMgrA}` } });
        const editFetchData = await editFetchRes.json();
        if (editFetchRes.status === 200 && editFetchData.email) {
            console.log('Edit Lead drawer fetch returns 200 OK with fresh lead dataset!');
            console.log('RESULT: TEST 8 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 8 FAILED', { status: editFetchRes.status, editFetchData });
        }
        console.log('--- TEST 9: Lead Update & Persistence ---');
        const updateRes = await fetch(`${API_URL}/leads/${leadPAId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPAA}` },
            body: JSON.stringify({ city: 'Pune' }),
        });
        console.log('PATCH /leads/:id Status:', updateRes.status);
        const refetchRes = await fetch(`${API_URL}/leads/${leadPAId}`, { headers: { Authorization: `Bearer ${tokenPAA}` } });
        const refetchedData = await refetchRes.json();
        if (updateRes.ok && refetchedData.city === 'Pune') {
            console.log('Lead update succeeded and city updated to "Pune" persistent in DB!');
            console.log('RESULT: TEST 9 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 9 FAILED', { updateStatus: updateRes.status, refetchedCity: refetchedData.city });
        }
        console.log('--- TEST 10: College Approvals Team Isolation & Approval ---');
        const pitchRes = await fetch(`${API_URL}/leads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPAA}` },
            body: JSON.stringify({
                firstName: 'ApprovalLead', lastName: 'RegTest2', phone: getRandomPhone(), email: `pareg2_${Date.now()}@test.com`,
                city: 'Delhi', state: 'Delhi', source: 'WEBSITE', collegeIds: [testCollege.id],
            }),
        });
        const pitchData = await pitchRes.json();
        const leadPitchId = (pitchData.lead?.id || pitchData.id);
        createdLeadIds.push(leadPitchId);
        const pitchRecord = await prisma.leadCollege.findFirst({ where: { leadId: leadPitchId, collegeId: testCollege.id } });
        const approveRes = await fetch(`${API_URL}/leads/pitches/${pitchRecord.id}/approval`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenMgrA}` },
            body: JSON.stringify({ status: 'APPROVED' }),
        });
        const approveOutsideRes = await fetch(`${API_URL}/leads/pitches/${pitchRecord.id}/approval`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenMgrB}` },
            body: JSON.stringify({ status: 'APPROVED' }),
        });
        if (approveRes.status === 200 && approveOutsideRes.status === 403) {
            console.log('Manager A approved own team pitch (200), Manager B blocked (403)!');
            console.log('RESULT: TEST 10 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 10 FAILED', { approveStatus: approveRes.status, approveOutsideStatus: approveOutsideRes.status });
        }
        console.log('--- TEST 11: Manager Pitch Auto-Approval ---');
        const mgrPitchLeadRes = await fetch(`${API_URL}/leads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenMgrA}` },
            body: JSON.stringify({
                firstName: 'MgrPitch', lastName: 'RegTest3', phone: getRandomPhone(), email: `mgrpitch_${Date.now()}@test.com`,
                city: 'Delhi', state: 'Delhi', source: 'WEBSITE', collegeIds: [testCollege.id],
            }),
        });
        const mgrPitchLeadData = await mgrPitchLeadRes.json();
        const mgrPitchLeadId = (mgrPitchLeadData.lead?.id || mgrPitchLeadData.id);
        createdLeadIds.push(mgrPitchLeadId);
        const pitchMgrRecord = await prisma.leadCollege.findFirst({ where: { leadId: mgrPitchLeadId, collegeId: testCollege.id } });
        const mgrSelfNotifs = await prisma.notificationRecipient.count({
            where: { userId: managerA.id, notification: { message: { contains: 'MgrPitch' } } },
        });
        if (pitchMgrRecord?.approvalStatus === 'APPROVED' && mgrSelfNotifs === 0) {
            console.log('Manager created pitch auto-approved (APPROVED) with zero self-notifications!');
            console.log('RESULT: TEST 11 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 11 FAILED', { pitchMgrRecord, mgrSelfNotifs });
        }
        console.log('--- TEST 12: PA Pitch Pending Approval & Pipeline Lock ---');
        const paPendingLeadRes = await fetch(`${API_URL}/leads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPAA}` },
            body: JSON.stringify({
                firstName: 'PAPending', lastName: 'RegTest4', phone: getRandomPhone(), email: `papending_${Date.now()}@test.com`,
                city: 'Delhi', state: 'Delhi', source: 'WEBSITE', collegeIds: [testCollege.id],
            }),
        });
        const paPendingLeadData = await paPendingLeadRes.json();
        const paPendingLeadId = (paPendingLeadData.lead?.id || paPendingLeadData.id);
        createdLeadIds.push(paPendingLeadId);
        const pitchPAPending = await prisma.leadCollege.findFirst({ where: { leadId: paPendingLeadId, collegeId: testCollege.id } });
        const pipelineBlockRes = await fetch(`${API_URL}/leads/${paPendingLeadId}/pipeline`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPAA}` },
            body: JSON.stringify({ collegeId: testCollege.id, statusId: 2, applicationId: 'APP_REG_123' }),
        });
        if (pitchPAPending?.approvalStatus === 'PENDING' && pipelineBlockRes.status === 400) {
            console.log('PA pitch initialized as PENDING and pipeline correctly locked (400 Bad Request)!');
            console.log('RESULT: TEST 12 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 12 FAILED', { pitchPAPending, pipelineBlockStatus: pipelineBlockRes.status });
        }
    }
    finally {
        console.log('--- CLEANING UP TEMPORARY REGRESSION TEST DATA ---');
        for (const leadId of createdLeadIds) {
            if (leadId) {
                await prisma.interaction.deleteMany({ where: { leadId } });
                await prisma.leadCollegeHistory.deleteMany({ where: { leadCollege: { leadId } } });
                await prisma.leadCollege.deleteMany({ where: { leadId } });
                await prisma.leadAssignment.deleteMany({ where: { leadId } });
                await prisma.activityLog.deleteMany({ where: { entityId: leadId } });
                await prisma.lead.deleteMany({ where: { id: leadId } });
            }
        }
        console.log(`Cleaned up ${createdLeadIds.length} test leads.`);
        if (testCollegeReqAppId) {
            await prisma.leadCollegeHistory.deleteMany({ where: { leadCollege: { collegeId: testCollegeReqAppId } } });
            await prisma.leadCollege.deleteMany({ where: { collegeId: testCollegeReqAppId } });
            await prisma.college.deleteMany({ where: { id: testCollegeReqAppId } });
            console.log('Cleaned up test college:', testCollegeReqAppId);
        }
        if (createdNotifIds.length > 0) {
            await prisma.notificationRecipient.deleteMany({ where: { notificationId: { in: createdNotifIds } } });
            await prisma.notification.deleteMany({ where: { id: { in: createdNotifIds } } });
            console.log('Cleaned up test notifications.');
        }
        await prisma.user.update({
            where: { id: paA.id },
            data: { teamId: origPaATeamId, managerId: origPaAManagerId },
        });
        await prisma.$disconnect();
        console.log('\n=== REGRESSION INTEGRATION TESTS COMPLETE ===');
    }
}
main().catch((err) => {
    console.error('Integration test error:', err);
    process.exit(1);
});
//# sourceMappingURL=test-lead-team-regression-fix.js.map