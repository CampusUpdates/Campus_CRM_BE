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
    console.log('=== STARTING END-TO-END TEST FOR PITCH APPROVALS FLOW ===\n');
    const user = await prisma.user.findFirst({
        where: { status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } },
        include: { role: true },
    }) || await prisma.user.findFirst({
        where: { status: 'ACTIVE' },
        include: { role: true },
    });
    if (!user) {
        throw new Error('No active user found in database for testing.');
    }
    const token = jwt.sign({
        sub: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        roleId: user.roleId,
        teamId: user.teamId,
        type: 'access',
    }, JWT_SECRET, { expiresIn: '1h' });
    console.log(`Authenticated as user: ${user.email} (${user.id})`);
    let testCollegeId = null;
    let testLeadId = null;
    let testPitchId = null;
    try {
        const college = await prisma.college.create({
            data: {
                name: `APPROVAL_TEST_COLLEGE_${Date.now()}`,
                description: 'Test College for Pitch Approval Flow',
                isActive: true,
                hasTieUp: true,
                requiresApproval: true,
            },
        });
        testCollegeId = college.id;
        console.log('Created test college requiring approval:', college.name);
        const getRandomPhone = () => '9' + Math.floor(100000000 + Math.random() * 900000000).toString();
        const createRes = await fetch(`${API_URL}/leads`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                firstName: 'ApprovalTest',
                lastName: 'Student',
                phone: getRandomPhone(),
                email: `approval_${Date.now()}@example.com`,
                city: 'TestCity',
                state: 'TestState',
                source: 'WEBSITE',
                collegeIds: [college.id],
            }),
        });
        const createData = await createRes.json();
        console.log('Create Lead API HTTP Status:', createRes.status);
        if (createRes.status !== 201) {
            throw new Error(`Failed to create lead: ${JSON.stringify(createData)}`);
        }
        testLeadId = createData.lead?.id || createData.id;
        console.log('Created test lead ID:', testLeadId);
        const initialPitch = await prisma.leadCollege.findFirst({
            where: { leadId: testLeadId, collegeId: college.id },
        });
        if (!initialPitch || initialPitch.approvalStatus !== 'PENDING') {
            throw new Error(`Expected PENDING pitch status, got: ${initialPitch?.approvalStatus}`);
        }
        testPitchId = initialPitch.id;
        console.log('Initial LeadCollege approvalStatus in DB:', initialPitch.approvalStatus);
        console.log('\n--- Testing GET /leads/pitches/approvals ---');
        const getRes = await fetch(`${API_URL}/leads/pitches/approvals?status=PENDING`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        console.log('GET /leads/pitches/approvals HTTP Status:', getRes.status);
        const getList = await getRes.json();
        console.log('Pitches count returned:', Array.isArray(getList) ? getList.length : getList);
        const foundPitch = Array.isArray(getList) && getList.find((p) => p.id === testPitchId);
        if (!foundPitch) {
            throw new Error(`Created PENDING pitch ${testPitchId} not found in GET response`);
        }
        console.log('Found pitched item in GET list:', foundPitch.college.name, '-> Status:', foundPitch.approvalStatus);
        console.log('\n--- Testing PATCH /leads/pitches/:id/approval (Approve) ---');
        const patchRes = await fetch(`${API_URL}/leads/pitches/${testPitchId}/approval`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                status: 'APPROVED',
            }),
        });
        console.log('PATCH approval HTTP Status:', patchRes.status);
        const patchData = await patchRes.json();
        console.log('PATCH response approvalStatus:', patchData.approvalStatus);
        const finalPitch = await prisma.leadCollege.findUnique({
            where: { id: testPitchId },
        });
        console.log('Final LeadCollege approvalStatus in DB:', finalPitch?.approvalStatus);
        if (finalPitch?.approvalStatus !== 'APPROVED') {
            throw new Error(`Expected APPROVED status, got: ${finalPitch?.approvalStatus}`);
        }
        console.log('\n=== END-TO-END PITCH APPROVALS FLOW PASSED SUCCESSFULLY ===');
    }
    finally {
        console.log('\n--- CLEANING UP TEMPORARY TEST DATA ---');
        if (testLeadId) {
            await prisma.leadCollegeHistory.deleteMany({ where: { leadCollege: { leadId: testLeadId } } });
            await prisma.leadCollege.deleteMany({ where: { leadId: testLeadId } });
            await prisma.leadAssignment.deleteMany({ where: { leadId: testLeadId } });
            await prisma.activityLog.deleteMany({ where: { entityId: testLeadId } });
            await prisma.lead.deleteMany({ where: { id: testLeadId } });
            console.log('Cleaned up test lead:', testLeadId);
        }
        if (testCollegeId) {
            await prisma.leadCollegeHistory.deleteMany({ where: { leadCollege: { collegeId: testCollegeId } } });
            await prisma.leadCollege.deleteMany({ where: { collegeId: testCollegeId } });
            await prisma.college.deleteMany({ where: { id: testCollegeId } });
            console.log('Cleaned up test college:', testCollegeId);
        }
        await prisma.$disconnect();
    }
}
main().catch((err) => {
    console.error('End-to-end test error:', err);
    process.exit(1);
});
//# sourceMappingURL=test-pitch-approvals-flow.js.map