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
    console.log('=== STARTING INTEGRATION TESTS FOR EDIT COLLEGE PERMISSIONS & BUSINESS RULES ===\n');
    const hrUser = await prisma.user.findFirst({
        where: { status: 'ACTIVE', role: { name: 'HR' } },
        include: { role: true },
    });
    const paUser = await prisma.user.findFirst({
        where: { status: 'ACTIVE', role: { name: 'Program Advisor' } },
        include: { role: true },
    });
    const managerUser = await prisma.user.findFirst({
        where: { status: 'ACTIVE', role: { name: 'Manager' } },
        include: { role: true },
    });
    if (!hrUser || !paUser || !managerUser) {
        throw new Error('Required test users (HR, Program Advisor, Manager) not found in database.');
    }
    const hrToken = jwt.sign({
        sub: hrUser.id,
        email: hrUser.email,
        username: hrUser.username,
        firstName: hrUser.firstName,
        lastName: hrUser.lastName,
        roleId: hrUser.roleId,
        teamId: hrUser.teamId,
        type: 'access',
    }, JWT_SECRET, { expiresIn: '1h' });
    const paToken = jwt.sign({
        sub: paUser.id,
        email: paUser.email,
        username: paUser.username,
        firstName: paUser.firstName,
        lastName: paUser.lastName,
        roleId: paUser.roleId,
        teamId: paUser.teamId,
        type: 'access',
    }, JWT_SECRET, { expiresIn: '1h' });
    const managerToken = jwt.sign({
        sub: managerUser.id,
        email: managerUser.email,
        username: managerUser.username,
        firstName: managerUser.firstName,
        lastName: managerUser.lastName,
        roleId: managerUser.roleId,
        teamId: managerUser.teamId,
        type: 'access',
    }, JWT_SECRET, { expiresIn: '1h' });
    let testCollege1Id = null;
    let testCollege2Id = null;
    let testLeadId = null;
    try {
        const college1 = await prisma.college.create({
            data: {
                name: `EDIT_TEST_COLLEGE_1_${Date.now()}`,
                description: 'Original Description 1',
                city: 'City1',
                state: 'State1',
                isActive: true,
                hasTieUp: true,
                requiresApproval: false,
            },
        });
        testCollege1Id = college1.id;
        const college2 = await prisma.college.create({
            data: {
                name: `EDIT_TEST_COLLEGE_2_${Date.now()}`,
                description: 'Original Description 2',
                isActive: true,
                hasTieUp: true,
                requiresApproval: false,
            },
        });
        testCollege2Id = college2.id;
        console.log('--- TEST 1: HR updates college ---');
        const updateRes1 = await fetch(`${API_URL}/colleges/${college1.id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${hrToken}`,
            },
            body: JSON.stringify({
                description: 'Updated Description by HR',
                city: 'NewCity1',
            }),
        });
        console.log('HR Update HTTP Status:', updateRes1.status);
        const updatedCol1 = await prisma.college.findUnique({ where: { id: college1.id } });
        if (updateRes1.status === 200 && updatedCol1?.description === 'Updated Description by HR' && updatedCol1?.city === 'NewCity1') {
            console.log('Database Verification: Attributes updated successfully in DB.');
            console.log('RESULT: TEST 1 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 1 FAILED', { status: updateRes1.status, col1: updatedCol1 });
        }
        console.log('--- TEST 2: Program Advisor attempts update ---');
        const updateRes2 = await fetch(`${API_URL}/colleges/${college1.id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${paToken}`,
            },
            body: JSON.stringify({
                description: 'Unauthorized update by PA',
            }),
        });
        const data2 = await updateRes2.json();
        console.log('PA Update HTTP Status:', updateRes2.status);
        console.log('Error Message:', data2.message);
        const dbCol2 = await prisma.college.findUnique({ where: { id: college1.id } });
        if (updateRes2.status === 403 && dbCol2?.description === 'Updated Description by HR') {
            console.log('Database Verification: Database untouched (Rejection 403).');
            console.log('RESULT: TEST 2 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 2 FAILED', { status: updateRes2.status, dbCol2 });
        }
        console.log('--- TEST 3: Manager attempts update ---');
        const updateRes3 = await fetch(`${API_URL}/colleges/${college1.id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${managerToken}`,
            },
            body: JSON.stringify({
                description: 'Unauthorized update by Manager',
            }),
        });
        const data3 = await updateRes3.json();
        console.log('Manager Update HTTP Status:', updateRes3.status);
        console.log('Error Message:', data3.message);
        const dbCol3 = await prisma.college.findUnique({ where: { id: college1.id } });
        if (updateRes3.status === 403 && dbCol3?.description === 'Updated Description by HR') {
            console.log('Database Verification: Database untouched (Rejection 403).');
            console.log('RESULT: TEST 3 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 3 FAILED', { status: updateRes3.status, dbCol3 });
        }
        console.log('--- TEST 4: Attempt duplicate college name ---');
        const updateRes4 = await fetch(`${API_URL}/colleges/${college1.id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${hrToken}`,
            },
            body: JSON.stringify({
                name: college2.name,
            }),
        });
        const data4 = await updateRes4.json();
        console.log('Duplicate Name HTTP Status:', updateRes4.status);
        console.log('Error Message:', data4.message);
        const dbCol4 = await prisma.college.findUnique({ where: { id: college1.id } });
        if (updateRes4.status === 409 && dbCol4?.name === college1.name) {
            console.log('Database Verification: Original college name preserved.');
            console.log('RESULT: TEST 4 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 4 FAILED', { status: updateRes4.status, dbCol4 });
        }
        console.log('--- TEST 5: Partial update (one field) ---');
        const updateRes5 = await fetch(`${API_URL}/colleges/${college1.id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${hrToken}`,
            },
            body: JSON.stringify({
                contactPerson: 'Dr. Jane Smith',
            }),
        });
        console.log('Partial Update HTTP Status:', updateRes5.status);
        const dbCol5 = await prisma.college.findUnique({ where: { id: college1.id } });
        if (updateRes5.status === 200 &&
            dbCol5?.contactPerson === 'Dr. Jane Smith' &&
            dbCol5?.name === college1.name &&
            dbCol5?.city === 'NewCity1') {
            console.log('Database Verification: Specified field updated, omitted fields preserved.');
            console.log('RESULT: TEST 5 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 5 FAILED', { status: updateRes5.status, dbCol5 });
        }
        console.log('--- TEST 6: Update requiresApproval (false -> true) ---');
        const updateRes6 = await fetch(`${API_URL}/colleges/${college1.id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${hrToken}`,
            },
            body: JSON.stringify({
                requiresApproval: true,
            }),
        });
        console.log('RequiresApproval Update HTTP Status:', updateRes6.status);
        const dbCol6 = await prisma.college.findUnique({ where: { id: college1.id } });
        if (updateRes6.status === 200 && dbCol6?.requiresApproval === true) {
            console.log('Database Verification: requiresApproval updated to true.');
            console.log('RESULT: TEST 6 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 6 FAILED', { status: updateRes6.status, dbCol6 });
        }
        console.log('--- TEST 7: Update isActive (true -> false) & check existing LeadCollege records ---');
        const getRandomPhone = () => '9' + Math.floor(100000000 + Math.random() * 900000000).toString();
        const lead = await prisma.lead.create({
            data: {
                firstName: 'Preserved',
                lastName: 'Lead',
                phone: getRandomPhone(),
                email: `preserved_${Date.now()}@example.com`,
                city: 'City',
                state: 'State',
                source: 'WEBSITE',
                statusId: 1,
                createdById: hrUser.id,
            },
        });
        testLeadId = lead.id;
        await prisma.leadCollege.create({
            data: {
                leadId: lead.id,
                collegeId: college1.id,
                statusId: 1,
                pitchedById: hrUser.id,
                approvalStatus: 'APPROVED',
            },
        });
        const leadCollegeCountBefore = await prisma.leadCollege.count({
            where: { collegeId: college1.id },
        });
        const updateRes7 = await fetch(`${API_URL}/colleges/${college1.id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${hrToken}`,
            },
            body: JSON.stringify({
                isActive: false,
            }),
        });
        console.log('IsActive Update HTTP Status:', updateRes7.status);
        const dbCol7 = await prisma.college.findUnique({ where: { id: college1.id } });
        const leadCollegeCountAfter = await prisma.leadCollege.count({
            where: { collegeId: college1.id },
        });
        if (updateRes7.status === 200 &&
            dbCol7?.isActive === false &&
            leadCollegeCountAfter === leadCollegeCountBefore &&
            leadCollegeCountAfter > 0) {
            console.log('Database Verification: College.isActive updated to false. Existing LeadCollege records remained intact!');
            console.log('RESULT: TEST 7 PASSED\n');
        }
        else {
            console.error('RESULT: TEST 7 FAILED', { status: updateRes7.status, dbCol7, leadCollegeCountBefore, leadCollegeCountAfter });
        }
    }
    finally {
        console.log('--- CLEANING UP TEMPORARY TEST DATA ---');
        if (testLeadId) {
            await prisma.leadCollegeHistory.deleteMany({ where: { leadCollege: { leadId: testLeadId } } });
            await prisma.leadCollege.deleteMany({ where: { leadId: testLeadId } });
            await prisma.leadAssignment.deleteMany({ where: { leadId: testLeadId } });
            await prisma.activityLog.deleteMany({ where: { entityId: testLeadId } });
            await prisma.lead.deleteMany({ where: { id: testLeadId } });
            console.log('Cleaned up test lead:', testLeadId);
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
        await prisma.$disconnect();
        console.log('\n=== INTEGRATION TESTS COMPLETE ===');
    }
}
main().catch((err) => {
    console.error('Integration test error:', err);
    process.exit(1);
});
//# sourceMappingURL=test-edit-college-permissions.js.map