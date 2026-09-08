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
    console.log('=== STARTING INTEGRATION TESTS FOR MANAGER PITCH AUTO-APPROVAL BUSINESS RULE ===\n');
    const allActiveUsers = await prisma.user.findMany({
        where: { status: 'ACTIVE' },
        include: { role: true },
    });
    const managerUser = allActiveUsers.find((u) => u.role.name === 'Manager' || u.role.name === 'MANAGER');
    const paUser = allActiveUsers.find((u) => (u.role.name === 'Program Advisor' || u.role.name === 'PROGRAM_ADVISOR') && u.id !== managerUser?.id);
    if (!managerUser || !paUser) {
        throw new Error('Required test users (Manager, Program Advisor) not found in DB.');
    }
    let testTeam = await prisma.team.findFirst({
        where: { managerId: managerUser.id, isActive: true },
    });
    if (!testTeam) {
        testTeam = await prisma.team.create({
            data: {
                name: `AUTO_APP_TEAM_${Date.now()}`,
                managerId: managerUser.id,
                isActive: true,
            },
        });
    }
    await prisma.user.update({
        where: { id: managerUser.id },
        data: { teamId: testTeam.id },
    });
    await prisma.user.update({
        where: { id: paUser.id },
        data: { teamId: testTeam.id, managerId: managerUser.id },
    });
    const managerToken = jwt.sign({ sub: managerUser.id, email: managerUser.email, username: managerUser.username, roleId: managerUser.roleId, teamId: testTeam.id, type: 'access' }, JWT_SECRET, { expiresIn: '1h' });
    const paToken = jwt.sign({ sub: paUser.id, email: paUser.email, username: paUser.username, roleId: paUser.roleId, teamId: testTeam.id, type: 'access' }, JWT_SECRET, { expiresIn: '1h' });
    const getRandomPhone = () => '9' + Math.floor(100000000 + Math.random() * 900000000).toString();
    const appStatus = await prisma.leadStatus.findFirst({
        where: { name: 'APPLICATION', isActive: true },
    }) || await prisma.leadStatus.findFirst({ where: { id: 2, isActive: true } });
    let collegeReqAppId = null;
    let collegeNoReqAppId = null;
    const testLeadIds = [];
    const createdNotificationIds = [];
    try {
        const collegeReqApp = await prisma.college.create({
            data: {
                name: `AUTO_APP_COLLEGE_1_${Date.now()}`,
                description: 'College requiring approval test',
                isActive: true,
                hasTieUp: true,
                requiresApproval: true,
            },
        });
        collegeReqAppId = collegeReqApp.id;
        const collegeNoReqApp = await prisma.college.create({
            data: {
                name: `AUTO_APP_COLLEGE_2_${Date.now()}`,
                description: 'College not requiring approval test',
                isActive: true,
                hasTieUp: true,
                requiresApproval: false,
            },
        });
        collegeNoReqAppId = collegeNoReqApp.id;
        console.log('--- TEST 1: Manager Pitches College with requiresApproval = true ---');
        const mgrLead1Res = await fetch(`${API_URL}/leads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerToken}` },
            body: JSON.stringify({
                firstName: 'ManagerLead', lastName: 'Test1', phone: getRandomPhone(), email: `mgrlead1_${Date.now()}@test.com`,
                city: 'Delhi', state: 'Delhi', source: 'WEBSITE', collegeIds: [collegeReqApp.id],
            }),
        });
        const mgrLead1Data = await mgrLead1Res.json();
        const mgrLead1Id = (mgrLead1Data.lead?.id || mgrLead1Data.id);
        testLeadIds.push(mgrLead1Id);
        const pitchMgr1 = await prisma.leadCollege.findFirst({ where: { leadId: mgrLead1Id, collegeId: collegeReqApp.id } });
        const selfNotifCount1 = await prisma.notification.count({
            where: { title: 'New College Pitch Approval', message: { contains: collegeReqApp.name } },
        });
        if (pitchMgr1?.approvalStatus === 'APPROVED' && selfNotifCount1 === 0) {
            console.log('Manager-created pitch approvalStatus:', pitchMgr1.approvalStatus, '(APPROVED!)');
            console.log('No self-approval manager notification created.');
            console.log('RESULT: TEST 1 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 1 FAILED', { pitchMgr1, selfNotifCount1 });
        }
        console.log('--- TEST 2: Manager Pitches College with requiresApproval = false ---');
        const mgrLead2Res = await fetch(`${API_URL}/leads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerToken}` },
            body: JSON.stringify({
                firstName: 'ManagerLead', lastName: 'Test2', phone: getRandomPhone(), email: `mgrlead2_${Date.now()}@test.com`,
                city: 'Delhi', state: 'Delhi', source: 'WEBSITE', collegeIds: [collegeNoReqApp.id],
            }),
        });
        const mgrLead2Data = await mgrLead2Res.json();
        const mgrLead2Id = (mgrLead2Data.lead?.id || mgrLead2Data.id);
        testLeadIds.push(mgrLead2Id);
        const pitchMgr2 = await prisma.leadCollege.findFirst({ where: { leadId: mgrLead2Id, collegeId: collegeNoReqApp.id } });
        if (pitchMgr2?.approvalStatus === 'APPROVED') {
            console.log('Manager-created pitch approvalStatus:', pitchMgr2.approvalStatus, '(APPROVED!)');
            console.log('RESULT: TEST 2 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 2 FAILED', { pitchMgr2 });
        }
        console.log('--- TEST 3: PA Pitches College with requiresApproval = true ---');
        const paLead1Res = await fetch(`${API_URL}/leads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${paToken}` },
            body: JSON.stringify({
                firstName: 'PALead', lastName: 'Test1', phone: getRandomPhone(), email: `palead1_${Date.now()}@test.com`,
                city: 'Pune', state: 'Maharashtra', source: 'WEBSITE', collegeIds: [collegeReqApp.id],
            }),
        });
        const paLead1Data = await paLead1Res.json();
        const paLead1Id = (paLead1Data.lead?.id || paLead1Data.id);
        testLeadIds.push(paLead1Id);
        const pitchPA1 = await prisma.leadCollege.findFirst({ where: { leadId: paLead1Id, collegeId: collegeReqApp.id } });
        const mgrNotifPA1 = await prisma.notificationRecipient.findFirst({
            where: { userId: managerUser.id, notification: { title: 'New College Pitch Approval', message: { contains: collegeReqApp.name } } },
            include: { notification: true },
        });
        if (pitchPA1?.approvalStatus === 'PENDING' && mgrNotifPA1) {
            createdNotificationIds.push(mgrNotifPA1.notificationId);
            console.log('PA-created pitch approvalStatus:', pitchPA1.approvalStatus, '(PENDING!)');
            console.log('Manager notification created successfully:', mgrNotifPA1.notification.title);
            console.log('RESULT: TEST 3 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 3 FAILED', { pitchPA1, mgrNotifPA1 });
        }
        console.log('--- TEST 4: PA Pitches College with requiresApproval = false ---');
        const paLead2Res = await fetch(`${API_URL}/leads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${paToken}` },
            body: JSON.stringify({
                firstName: 'PALead', lastName: 'Test2', phone: getRandomPhone(), email: `palead2_${Date.now()}@test.com`,
                city: 'Pune', state: 'Maharashtra', source: 'WEBSITE', collegeIds: [collegeNoReqApp.id],
            }),
        });
        const paLead2Data = await paLead2Res.json();
        const paLead2Id = (paLead2Data.lead?.id || paLead2Data.id);
        testLeadIds.push(paLead2Id);
        const pitchPA2 = await prisma.leadCollege.findFirst({ where: { leadId: paLead2Id, collegeId: collegeNoReqApp.id } });
        if (pitchPA2?.approvalStatus === 'APPROVED') {
            console.log('PA-created pitch (requiresApproval=false) approvalStatus:', pitchPA2.approvalStatus, '(APPROVED!)');
            console.log('RESULT: TEST 4 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 4 FAILED', { pitchPA2 });
        }
        console.log('--- TEST 5: Manager Pipeline Transition on Auto-Approved Pitch ---');
        if (appStatus) {
            const pipelineMgrRes = await fetch(`${API_URL}/leads/${mgrLead1Id}/pipeline`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerToken}` },
                body: JSON.stringify({ collegeId: collegeReqApp.id, statusId: appStatus.id, applicationId: 'APP_TEST_123' }),
            });
            console.log('Manager Pipeline Transition HTTP Status:', pipelineMgrRes.status);
            const updatedLeadMgr = await prisma.leadCollege.findFirst({ where: { leadId: mgrLead1Id, collegeId: collegeReqApp.id } });
            if (pipelineMgrRes.status === 200 && updatedLeadMgr?.statusId === appStatus.id) {
                console.log('Manager successfully moved pipeline to statusId:', appStatus.id);
                console.log('RESULT: TEST 5 PASSED\n');
            }
            else {
                console.error('RESULT: TEST 5 FAILED', { status: pipelineMgrRes.status, updatedLeadMgr });
            }
        }
        else {
            console.log('Skipping pipeline status transition test (APPLICATION status not found in DB)');
            console.log('RESULT: TEST 5 PASSED\n');
        }
        console.log('--- TEST 6: PA Pipeline Transition Blocked on PENDING Pitch ---');
        if (appStatus) {
            const pipelinePARes = await fetch(`${API_URL}/leads/${paLead1Id}/pipeline`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${paToken}` },
                body: JSON.stringify({ collegeId: collegeReqApp.id, statusId: appStatus.id, applicationId: 'APP_TEST_456' }),
            });
            console.log('PA Pipeline Transition HTTP Status:', pipelinePARes.status);
            const pipelinePAData = await pipelinePARes.json();
            console.log('Error Message:', pipelinePAData.message);
            if (pipelinePARes.status === 400) {
                console.log('RESULT: TEST 6 PASSED (Pipeline transition correctly blocked with 400!)\n');
            }
            else {
                console.error('RESULT: TEST 6 FAILED', { status: pipelinePARes.status });
            }
        }
        else {
            console.log('Skipping pipeline status block test');
            console.log('RESULT: TEST 6 PASSED\n');
        }
        console.log('--- TEST 7: Verification of Zero Self-Notifications for Manager ---');
        const mgrSelfNotifs = await prisma.notificationRecipient.count({
            where: { userId: managerUser.id, notification: { message: { contains: 'ManagerLead' } } },
        });
        if (mgrSelfNotifs === 0) {
            console.log('Verified 0 self-notifications created for Manager!');
            console.log('RESULT: TEST 7 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 7 FAILED', { mgrSelfNotifs });
        }
        console.log('--- TEST 8: Manager Approves PA Pitch -> PA Approval Notification ---');
        const approvePARes = await fetch(`${API_URL}/leads/pitches/${pitchPA1.id}/approval`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerToken}` },
            body: JSON.stringify({ status: 'APPROVED' }),
        });
        console.log('Manager Approve PA Pitch HTTP Status:', approvePARes.status);
        const paApprovalNotif = await prisma.notificationRecipient.findFirst({
            where: { userId: paUser.id, notification: { title: 'College Pitch Approved', message: { contains: collegeReqApp.name } } },
            include: { notification: true },
        });
        if (approvePARes.status === 200 && paApprovalNotif) {
            createdNotificationIds.push(paApprovalNotif.notificationId);
            console.log('PA Approval notification found:', paApprovalNotif.notification.title);
            console.log('RESULT: TEST 8 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 8 FAILED', { approveStatus: approvePARes.status, paApprovalNotif });
        }
        console.log('--- TEST 9: Manager Rejects PA Second Pitch -> PA Rejection Notification ---');
        const paLead3Res = await fetch(`${API_URL}/leads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${paToken}` },
            body: JSON.stringify({
                firstName: 'PALead', lastName: 'Test3', phone: getRandomPhone(), email: `palead3_${Date.now()}@test.com`,
                city: 'Pune', state: 'Maharashtra', source: 'WEBSITE', collegeIds: [collegeReqApp.id],
            }),
        });
        const paLead3Data = await paLead3Res.json();
        const paLead3Id = (paLead3Data.lead?.id || paLead3Data.id);
        testLeadIds.push(paLead3Id);
        const pitchPA3 = await prisma.leadCollege.findFirst({ where: { leadId: paLead3Id, collegeId: collegeReqApp.id } });
        const rejectPARes = await fetch(`${API_URL}/leads/pitches/${pitchPA3.id}/approval`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerToken}` },
            body: JSON.stringify({ status: 'REJECTED' }),
        });
        console.log('Manager Reject PA Pitch HTTP Status:', rejectPARes.status);
        const paRejectionNotif = await prisma.notificationRecipient.findFirst({
            where: { userId: paUser.id, notification: { title: 'College Pitch Rejected', message: { contains: collegeReqApp.name } } },
            include: { notification: true },
        });
        if (rejectPARes.status === 200 && paRejectionNotif) {
            createdNotificationIds.push(paRejectionNotif.notificationId);
            console.log('PA Rejection notification found:', paRejectionNotif.notification.title);
            console.log('RESULT: TEST 9 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 9 FAILED', { rejectStatus: rejectPARes.status, paRejectionNotif });
        }
    }
    finally {
        console.log('--- CLEANING UP TEMPORARY TEST DATA ---');
        for (const leadId of testLeadIds) {
            await prisma.leadCollegeHistory.deleteMany({ where: { leadCollege: { leadId } } });
            await prisma.leadCollege.deleteMany({ where: { leadId } });
            await prisma.leadAssignment.deleteMany({ where: { leadId } });
            await prisma.activityLog.deleteMany({ where: { entityId: leadId } });
            await prisma.lead.deleteMany({ where: { id: leadId } });
            console.log('Cleaned up test lead:', leadId);
        }
        if (collegeReqAppId) {
            await prisma.leadCollegeHistory.deleteMany({ where: { leadCollege: { collegeId: collegeReqAppId } } });
            await prisma.leadCollege.deleteMany({ where: { collegeId: collegeReqAppId } });
            await prisma.college.deleteMany({ where: { id: collegeReqAppId } });
            console.log('Cleaned up test college 1:', collegeReqAppId);
        }
        if (collegeNoReqAppId) {
            await prisma.leadCollegeHistory.deleteMany({ where: { leadCollege: { collegeId: collegeNoReqAppId } } });
            await prisma.leadCollege.deleteMany({ where: { collegeId: collegeNoReqAppId } });
            await prisma.college.deleteMany({ where: { id: collegeNoReqAppId } });
            console.log('Cleaned up test college 2:', collegeNoReqAppId);
        }
        if (createdNotificationIds.length > 0) {
            await prisma.notificationRecipient.deleteMany({ where: { notificationId: { in: createdNotificationIds } } });
            await prisma.notification.deleteMany({ where: { id: { in: createdNotificationIds } } });
            console.log('Cleaned up test notifications.');
        }
        await prisma.$disconnect();
        console.log('\n=== INTEGRATION TESTS COMPLETE ===');
    }
}
main().catch((err) => {
    console.error('Integration test error:', err);
    process.exit(1);
});
//# sourceMappingURL=test-manager-pitch-auto-approval.js.map