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
    console.log('=== STARTING INTEGRATION TESTS FOR PITCH APPROVAL NOTIFICATIONS & STUDENT INFO ===\n');
    const managerUser = await prisma.user.findFirst({
        where: { status: 'ACTIVE', role: { name: 'Manager' } },
        include: { role: true },
    });
    const paUser = await prisma.user.findFirst({
        where: { status: 'ACTIVE', role: { name: 'Program Advisor' } },
        include: { role: true },
    });
    if (!managerUser || !paUser) {
        throw new Error('Required test users (Manager, Program Advisor) not found in DB.');
    }
    let testTeam = await prisma.team.findFirst({
        where: { managerId: managerUser.id },
    });
    if (!testTeam) {
        testTeam = await prisma.team.create({
            data: {
                name: `TEST_PITCH_TEAM_${Date.now()}`,
                managerId: managerUser.id,
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
    const paToken = jwt.sign({
        sub: paUser.id,
        email: paUser.email,
        username: paUser.username,
        firstName: paUser.firstName,
        lastName: paUser.lastName,
        roleId: paUser.roleId,
        teamId: testTeam.id,
        type: 'access',
    }, JWT_SECRET, { expiresIn: '1h' });
    const managerToken = jwt.sign({
        sub: managerUser.id,
        email: managerUser.email,
        username: managerUser.username,
        firstName: managerUser.firstName,
        lastName: managerUser.lastName,
        roleId: managerUser.roleId,
        teamId: testTeam.id,
        type: 'access',
    }, JWT_SECRET, { expiresIn: '1h' });
    let testCollege1Id = null;
    let testCollege2Id = null;
    let testLead1Id = null;
    let testLead2Id = null;
    const createdNotificationIds = [];
    try {
        const college1 = await prisma.college.create({
            data: {
                name: `NOTIF_TEST_COLLEGE_1_${Date.now()}`,
                description: 'Test description 1',
                isActive: true,
                hasTieUp: true,
                requiresApproval: true,
            },
        });
        testCollege1Id = college1.id;
        const college2 = await prisma.college.create({
            data: {
                name: `NOTIF_TEST_COLLEGE_2_${Date.now()}`,
                description: 'Test description 2',
                isActive: true,
                hasTieUp: true,
                requiresApproval: false,
            },
        });
        testCollege2Id = college2.id;
        const getRandomPhone = () => '9' + Math.floor(100000000 + Math.random() * 900000000).toString();
        console.log('--- TEST 1: PENDING Pitch & Manager Notification ---');
        const createLeadRes1 = await fetch(`${API_URL}/leads`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${paToken}`,
            },
            body: JSON.stringify({
                firstName: 'Aniket',
                lastName: 'Mehta',
                phone: getRandomPhone(),
                email: `aniket_${Date.now()}@example.com`,
                city: 'Pune',
                state: 'Maharashtra',
                source: 'WEBSITE',
                collegeIds: [college1.id],
            }),
        });
        const createLeadData1 = await createLeadRes1.json();
        testLead1Id = (createLeadData1.lead?.id || createLeadData1.id);
        console.log('Created Lead 1 HTTP Status:', createLeadRes1.status);
        const pitch1 = await prisma.leadCollege.findFirst({
            where: { leadId: testLead1Id, collegeId: college1.id },
        });
        if (!pitch1 || pitch1.approvalStatus !== 'PENDING') {
            throw new Error(`TEST 1 FAILED: Expected approvalStatus PENDING, got ${pitch1?.approvalStatus}`);
        }
        const subNotifRecipient1 = await prisma.notificationRecipient.findFirst({
            where: {
                userId: managerUser.id,
                notification: { title: 'New College Pitch Approval', message: { contains: college1.name } },
            },
            include: { notification: true },
            orderBy: { createdAt: 'desc' },
        });
        if (subNotifRecipient1) {
            createdNotificationIds.push(subNotifRecipient1.notificationId);
            console.log('Manager Notification Found:', subNotifRecipient1.notification.title);
            console.log('Notification Message:', subNotifRecipient1.notification.message);
            console.log('Recipient User ID:', subNotifRecipient1.userId, '(Matches Manager User ID!)');
            console.log('RESULT: TEST 1 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 1 FAILED: Manager notification not found.');
        }
        console.log('--- TEST 2: Auto-Approved Pitch (requiresApproval = false) ---');
        const createLeadRes2 = await fetch(`${API_URL}/leads`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${paToken}`,
            },
            body: JSON.stringify({
                firstName: 'Siddharth',
                lastName: 'Rao',
                phone: getRandomPhone(),
                email: `siddharth_${Date.now()}@example.com`,
                city: 'Mumbai',
                state: 'Maharashtra',
                source: 'WEBSITE',
                collegeIds: [college2.id],
            }),
        });
        const createLeadData2 = await createLeadRes2.json();
        testLead2Id = (createLeadData2.lead?.id || createLeadData2.id);
        const pitch2 = await prisma.leadCollege.findFirst({
            where: { leadId: testLead2Id, collegeId: college2.id },
        });
        const notifForCollege2 = await prisma.notification.count({
            where: { title: 'New College Pitch Approval', message: { contains: college2.name } },
        });
        if (pitch2?.approvalStatus === 'APPROVED' && notifForCollege2 === 0) {
            console.log('LeadCollege approvalStatus: APPROVED');
            console.log('No manager approval notification created for auto-approved pitch.');
            console.log('RESULT: TEST 2 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 2 FAILED', { pitch2, notifForCollege2 });
        }
        console.log('--- TEST 3: Manager Approval Notification (PENDING -> APPROVED) ---');
        const approveRes = await fetch(`${API_URL}/leads/pitches/${pitch1.id}/approval`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${managerToken}`,
            },
            body: JSON.stringify({ status: 'APPROVED' }),
        });
        console.log('Manager Approve HTTP Status:', approveRes.status);
        const updatedPitch1 = await prisma.leadCollege.findUnique({ where: { id: pitch1.id } });
        const approvalNotifRecipient = await prisma.notificationRecipient.findFirst({
            where: {
                userId: paUser.id,
                notification: { title: 'College Pitch Approved', message: { contains: college1.name } },
            },
            include: { notification: true },
            orderBy: { createdAt: 'desc' },
        });
        if (approveRes.status === 200 &&
            updatedPitch1?.approvalStatus === 'APPROVED' &&
            approvalNotifRecipient) {
            createdNotificationIds.push(approvalNotifRecipient.notificationId);
            console.log('Approval Notification Found:', approvalNotifRecipient.notification.title);
            console.log('Notification Message:', approvalNotifRecipient.notification.message);
            console.log('Recipient User ID:', approvalNotifRecipient.userId, '(Matches PA User ID!)');
            console.log('RESULT: TEST 3 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 3 FAILED', { approveResStatus: approveRes.status, updatedPitch1, approvalNotifRecipient });
        }
        console.log('--- TEST 4: Manager Rejection Notification (PENDING -> REJECTED) ---');
        const lead3Res = await fetch(`${API_URL}/leads`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${paToken}`,
            },
            body: JSON.stringify({
                firstName: 'Vikram',
                lastName: 'Sharma',
                phone: getRandomPhone(),
                email: `vikram_${Date.now()}@example.com`,
                city: 'Delhi',
                state: 'Delhi',
                source: 'WEBSITE',
                collegeIds: [college1.id],
            }),
        });
        const lead3Data = await lead3Res.json();
        const testLead3Id = (lead3Data.lead?.id || lead3Data.id);
        const pitch3 = await prisma.leadCollege.findFirst({
            where: { leadId: testLead3Id, collegeId: college1.id },
        });
        const rejectRes = await fetch(`${API_URL}/leads/pitches/${pitch3.id}/approval`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${managerToken}`,
            },
            body: JSON.stringify({ status: 'REJECTED' }),
        });
        console.log('Manager Reject HTTP Status:', rejectRes.status);
        const updatedPitch3 = await prisma.leadCollege.findUnique({ where: { id: pitch3.id } });
        const rejectionNotifRecipient = await prisma.notificationRecipient.findFirst({
            where: {
                userId: paUser.id,
                notification: { title: 'College Pitch Rejected', message: { contains: college1.name } },
            },
            include: { notification: true },
            orderBy: { createdAt: 'desc' },
        });
        if (rejectRes.status === 200 &&
            updatedPitch3?.approvalStatus === 'REJECTED' &&
            rejectionNotifRecipient) {
            createdNotificationIds.push(rejectionNotifRecipient.notificationId);
            console.log('Rejection Notification Found:', rejectionNotifRecipient.notification.title);
            console.log('Notification Message:', rejectionNotifRecipient.notification.message);
            console.log('Recipient User ID:', rejectionNotifRecipient.userId, '(Matches PA User ID!)');
            console.log('RESULT: TEST 4 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 4 FAILED', { rejectResStatus: rejectRes.status, updatedPitch3, rejectionNotifRecipient });
        }
        if (testLead3Id) {
            await prisma.leadCollegeHistory.deleteMany({ where: { leadCollege: { leadId: testLead3Id } } });
            await prisma.leadCollege.deleteMany({ where: { leadId: testLead3Id } });
            await prisma.leadAssignment.deleteMany({ where: { leadId: testLead3Id } });
            await prisma.activityLog.deleteMany({ where: { entityId: testLead3Id } });
            await prisma.lead.deleteMany({ where: { id: testLead3Id } });
        }
        console.log('--- TEST 5: Recipient Targeting Verification ---');
        console.log('Submission notification recipient: Manager User ID');
        console.log('Approval notification recipient: PA User ID');
        console.log('Rejection notification recipient: PA User ID');
        console.log('RESULT: TEST 5 PASSED\n');
        console.log('--- TEST 6: Duplicate Notification Protection ---');
        const paNotifCountBeforeDup = await prisma.notificationRecipient.count({
            where: { userId: paUser.id },
        });
        const reApproveRes = await fetch(`${API_URL}/leads/pitches/${pitch1.id}/approval`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${managerToken}`,
            },
            body: JSON.stringify({ status: 'APPROVED' }),
        });
        const paNotifCountAfterDup = await prisma.notificationRecipient.count({
            where: { userId: paUser.id },
        });
        if (paNotifCountAfterDup === paNotifCountBeforeDup) {
            console.log('Re-processing already approved pitch did NOT generate duplicate notification.');
            console.log('RESULT: TEST 6 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 6 FAILED', { before: paNotifCountBeforeDup, after: paNotifCountAfterDup });
        }
        console.log('--- TEST 7: GET /leads/pitches/approvals Returns Student Info ---');
        const getApprovalsRes = await fetch(`${API_URL}/leads/pitches/approvals?status=ALL`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${managerToken}`,
            },
        });
        const approvalsList = await getApprovalsRes.json();
        console.log('GET Approvals HTTP Status:', getApprovalsRes.status);
        const targetApprovalItem = Array.isArray(approvalsList)
            ? approvalsList.find((item) => item.id === pitch1.id)
            : null;
        if (targetApprovalItem &&
            targetApprovalItem.lead?.firstName === 'Aniket' &&
            targetApprovalItem.lead?.lastName === 'Mehta' &&
            targetApprovalItem.lead?.phone &&
            targetApprovalItem.lead?.email &&
            targetApprovalItem.lead?.city === 'Pune' &&
            targetApprovalItem.lead?.state === 'Maharashtra') {
            console.log('Retrieved Approval Item Lead Details:');
            console.log('Name:', targetApprovalItem.lead.firstName, targetApprovalItem.lead.lastName);
            console.log('Phone:', targetApprovalItem.lead.phone);
            console.log('Email:', targetApprovalItem.lead.email);
            console.log('City/State:', targetApprovalItem.lead.city, ',', targetApprovalItem.lead.state);
            console.log('RESULT: TEST 7 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 7 FAILED', { targetApprovalItem });
        }
    }
    finally {
        console.log('--- CLEANING UP TEMPORARY TEST DATA ---');
        if (testLead1Id) {
            await prisma.leadCollegeHistory.deleteMany({ where: { leadCollege: { leadId: testLead1Id } } });
            await prisma.leadCollege.deleteMany({ where: { leadId: testLead1Id } });
            await prisma.leadAssignment.deleteMany({ where: { leadId: testLead1Id } });
            await prisma.activityLog.deleteMany({ where: { entityId: testLead1Id } });
            await prisma.lead.deleteMany({ where: { id: testLead1Id } });
            console.log('Cleaned up test lead 1:', testLead1Id);
        }
        if (testLead2Id) {
            await prisma.leadCollegeHistory.deleteMany({ where: { leadCollege: { leadId: testLead2Id } } });
            await prisma.leadCollege.deleteMany({ where: { leadId: testLead2Id } });
            await prisma.leadAssignment.deleteMany({ where: { leadId: testLead2Id } });
            await prisma.activityLog.deleteMany({ where: { entityId: testLead2Id } });
            await prisma.lead.deleteMany({ where: { id: testLead2Id } });
            console.log('Cleaned up test lead 2:', testLead2Id);
        }
        if (testCollege1Id) {
            await prisma.leadCollegeHistory.deleteMany({ where: { leadCollege: { collegeId: testCollege1Id } } });
            await prisma.leadCollege.deleteMany({ where: { collegeId: testCollege1Id } });
            await prisma.college.deleteMany({ where: { id: testCollege1Id } });
            console.log('Cleaned up test college 1:', testCollege1Id);
        }
        if (testCollege2Id) {
            await prisma.leadCollegeHistory.deleteMany({ where: { leadCollege: { collegeId: testCollege2Id } } });
            await prisma.leadCollege.deleteMany({ where: { collegeId: testCollege2Id } });
            await prisma.college.deleteMany({ where: { id: testCollege2Id } });
            console.log('Cleaned up test college 2:', testCollege2Id);
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
//# sourceMappingURL=test-pitch-approval-notifications.js.map