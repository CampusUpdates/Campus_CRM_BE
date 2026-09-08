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
    console.log('=== STARTING INTEGRATION TESTS FOR LEADCOLLEGE PITCH RULES ===\n');
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
    const testCollegeIds = [];
    const testLeadIds = [];
    try {
        const college1 = await prisma.college.create({
            data: {
                name: `TEST_COLLEGE_1_${Date.now()}`,
                description: 'Test College 1',
                isActive: true,
                hasTieUp: true,
                requiresApproval: false,
            },
        });
        testCollegeIds.push(college1.id);
        const college2 = await prisma.college.create({
            data: {
                name: `TEST_COLLEGE_2_${Date.now()}`,
                description: 'Test College 2',
                isActive: true,
                hasTieUp: true,
                requiresApproval: true,
            },
        });
        testCollegeIds.push(college2.id);
        const college3 = await prisma.college.create({
            data: {
                name: `TEST_COLLEGE_3_${Date.now()}`,
                description: 'Test College 3',
                isActive: false,
                hasTieUp: true,
                requiresApproval: false,
            },
        });
        testCollegeIds.push(college3.id);
        const college4 = await prisma.college.create({
            data: {
                name: `TEST_COLLEGE_4_${Date.now()}`,
                description: 'Test College 4',
                isActive: true,
                hasTieUp: false,
                requiresApproval: false,
            },
        });
        testCollegeIds.push(college4.id);
        const college5 = await prisma.college.create({
            data: {
                name: `TEST_COLLEGE_5_${Date.now()}`,
                description: 'Test College 5',
                isActive: false,
                hasTieUp: false,
                requiresApproval: false,
            },
        });
        testCollegeIds.push(college5.id);
        console.log('Created temporary test colleges.');
        const postLead = async (phone, email, collegeIds) => {
            const res = await fetch(`${API_URL}/leads`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    firstName: 'TestLead',
                    lastName: 'Student',
                    phone,
                    email,
                    city: 'TestCity',
                    state: 'TestState',
                    source: 'WEBSITE',
                    collegeIds,
                }),
            });
            const data = await res.json();
            return { status: res.status, data };
        };
        const getRandomPhone = () => '9' + Math.floor(100000000 + Math.random() * 900000000).toString();
        console.log('\n--- TEST 1: isActive=true, hasTieUp=true, requiresApproval=false ---');
        const phone1 = getRandomPhone();
        const res1 = await postLead(phone1, `test1_${Date.now()}_${Math.random()}@example.com`, [college1.id]);
        console.log('HTTP Status:', res1.status);
        if (res1.status === 201) {
            const leadId1 = res1.data.id || res1.data.lead?.id;
            if (leadId1)
                testLeadIds.push(leadId1);
            const leadCollege1 = await prisma.leadCollege.findFirst({
                where: { leadId: leadId1, collegeId: college1.id },
            });
            console.log('Database LeadCollege approvalStatus:', leadCollege1?.approvalStatus);
            if (leadCollege1?.approvalStatus === 'APPROVED') {
                console.log('RESULT: TEST 1 PASSED');
            }
            else {
                console.error('RESULT: TEST 1 FAILED - expected approvalStatus APPROVED, got:', leadCollege1?.approvalStatus);
            }
        }
        else {
            console.error('RESULT: TEST 1 FAILED - HTTP Status:', res1.status, res1.data);
        }
        console.log('\n--- TEST 2: isActive=true, hasTieUp=true, requiresApproval=true ---');
        const phone2 = getRandomPhone();
        const res2 = await postLead(phone2, `test2_${Date.now()}_${Math.random()}@example.com`, [college2.id]);
        console.log('HTTP Status:', res2.status);
        if (res2.status === 201) {
            const leadId2 = res2.data.id || res2.data.lead?.id;
            if (leadId2)
                testLeadIds.push(leadId2);
            const leadCollege2 = await prisma.leadCollege.findFirst({
                where: { leadId: leadId2, collegeId: college2.id },
            });
            console.log('Database LeadCollege approvalStatus:', leadCollege2?.approvalStatus);
            if (leadCollege2?.approvalStatus === 'PENDING') {
                console.log('RESULT: TEST 2 PASSED');
            }
            else {
                console.error('RESULT: TEST 2 FAILED - expected approvalStatus PENDING, got:', leadCollege2?.approvalStatus);
            }
        }
        else {
            console.error('RESULT: TEST 2 FAILED - HTTP Status:', res2.status, res2.data);
        }
        console.log('\n--- TEST 3: isActive=false, hasTieUp=true ---');
        const phone3 = getRandomPhone();
        const res3 = await postLead(phone3, `test3_${Date.now()}_${Math.random()}@example.com`, [college3.id]);
        console.log('HTTP Status:', res3.status);
        console.log('Error Message:', res3.data.message);
        const count3 = await prisma.leadCollege.count({ where: { collegeId: college3.id } });
        if (res3.status === 400 && res3.data.message === 'This college is not currently available for pitching.' && count3 === 0) {
            console.log('Database verification: 0 LeadCollege records created.');
            console.log('RESULT: TEST 3 PASSED');
        }
        else {
            console.error('RESULT: TEST 3 FAILED - expected 400 with pitch error, got:', res3.status, res3.data);
        }
        console.log('\n--- TEST 4: isActive=true, hasTieUp=false ---');
        const phone4 = getRandomPhone();
        const res4 = await postLead(phone4, `test4_${Date.now()}_${Math.random()}@example.com`, [college4.id]);
        console.log('HTTP Status:', res4.status);
        console.log('Error Message:', res4.data.message);
        const count4 = await prisma.leadCollege.count({ where: { collegeId: college4.id } });
        if (res4.status === 400 && res4.data.message === 'This college is not currently available for pitching.' && count4 === 0) {
            console.log('Database verification: 0 LeadCollege records created.');
            console.log('RESULT: TEST 4 PASSED');
        }
        else {
            console.error('RESULT: TEST 4 FAILED - expected 400 with pitch error, got:', res4.status, res4.data);
        }
        console.log('\n--- TEST 5: isActive=false, hasTieUp=false ---');
        const phone5 = getRandomPhone();
        const res5 = await postLead(phone5, `test5_${Date.now()}_${Math.random()}@example.com`, [college5.id]);
        console.log('HTTP Status:', res5.status);
        console.log('Error Message:', res5.data.message);
        const count5 = await prisma.leadCollege.count({ where: { collegeId: college5.id } });
        if (res5.status === 400 && res5.data.message === 'This college is not currently available for pitching.' && count5 === 0) {
            console.log('Database verification: 0 LeadCollege records created.');
            console.log('RESULT: TEST 5 PASSED');
        }
        else {
            console.error('RESULT: TEST 5 FAILED - expected 400 with pitch error, got:', res5.status, res5.data);
        }
        console.log('\n--- TEST 6: Duplicate pitch prevention ---');
        const patchRes = await fetch(`${API_URL}/leads/${testLeadIds[0]}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                collegeIds: [college1.id],
            }),
        });
        console.log('PATCH Status:', patchRes.status);
        const leadColleges6 = await prisma.leadCollege.findMany({
            where: { leadId: testLeadIds[0], collegeId: college1.id },
        });
        console.log('LeadCollege count for lead + college1:', leadColleges6.length);
        if (patchRes.status === 200 && leadColleges6.length === 1) {
            console.log('Database verification: Exactly 1 LeadCollege record preserved (no duplicates created).');
            console.log('RESULT: TEST 6 PASSED');
        }
        else {
            console.error('RESULT: TEST 6 FAILED - expected count 1, got:', leadColleges6.length);
        }
    }
    finally {
        console.log('\n--- CLEANING UP TEMPORARY TEST DATA ---');
        const validLeadIds = testLeadIds.filter((id) => Boolean(id));
        const validCollegeIds = testCollegeIds.filter((id) => Boolean(id));
        if (validLeadIds.length > 0) {
            await prisma.leadCollegeHistory.deleteMany({ where: { leadCollege: { leadId: { in: validLeadIds } } } });
            await prisma.leadCollege.deleteMany({ where: { leadId: { in: validLeadIds } } });
            await prisma.leadAssignment.deleteMany({ where: { leadId: { in: validLeadIds } } });
            await prisma.activityLog.deleteMany({ where: { entityId: { in: validLeadIds } } });
            await prisma.lead.deleteMany({ where: { id: { in: validLeadIds } } });
            console.log(`Cleaned up ${validLeadIds.length} temporary test leads.`);
        }
        if (validCollegeIds.length > 0) {
            await prisma.leadCollegeHistory.deleteMany({ where: { leadCollege: { collegeId: { in: validCollegeIds } } } });
            await prisma.leadCollege.deleteMany({ where: { collegeId: { in: validCollegeIds } } });
            await prisma.college.deleteMany({ where: { id: { in: validCollegeIds } } });
            console.log(`Cleaned up ${validCollegeIds.length} temporary test colleges.`);
        }
        await prisma.$disconnect();
        console.log('\n=== INTEGRATION TESTS COMPLETE ===');
    }
}
main().catch((err) => {
    console.error('Test execution error:', err);
    process.exit(1);
});
//# sourceMappingURL=test-pitch-rules.js.map