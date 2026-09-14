import { PrismaClient, PermissionScope } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Roles
  const rolesData = [
    { name: 'SUPER_ADMIN', description: 'Super Administrator with unrestricted access', displayOrder: 1 },
    { name: 'Program Advisor', description: 'Program Advisor managing individual leads', displayOrder: 2 },
    { name: 'Manager', description: 'Team Manager overseeing advisors and leads', displayOrder: 3 },
    { name: 'HR', description: 'Human Resources managing employees, attendance, and recruitment', displayOrder: 4 },
  ];

  const rolesMap = new Map<string, number>();
  for (const r of rolesData) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description, displayOrder: r.displayOrder },
      create: r,
    });
    rolesMap.set(r.name, role.id);
  }
  console.log('Roles seeded successfully');

  // 2. Permissions
  const permissionsData = [
    { name: 'LEAD_VIEW', description: 'View leads' },
    { name: 'LEAD_CREATE', description: 'Create new leads' },
    { name: 'LEAD_UPDATE', description: 'Update existing leads' },
    { name: 'LEAD_CLAIM', description: 'Claim unassigned leads' },
    { name: 'LEAD_SEARCH', description: 'Search leads' },
    { name: 'LEAD_ASSIGN', description: 'Assign leads to advisors' },
    { name: 'LEAD_REASSIGN', description: 'Reassign leads across team' },
    { name: 'COLLEGE_LEAD_APPROVE', description: 'Approve or reject college lead pitches' },
    { name: 'REPORT_TEAM_VIEW', description: 'View team performance reports' },
    { name: 'USER_MANAGE', description: 'Manage users and employee accounts' },
    { name: 'ATTENDANCE_MANAGE', description: 'Manage employee attendance records' },
    { name: 'RECRUITMENT_MANAGE', description: 'Manage candidates and interview schedules' },
    { name: 'COLLEGE_MANAGE', description: 'Manage college records and status' },
    { name: 'REPORT_HR_VIEW', description: 'View HR workforce reports' },
    { name: 'TEAM_MANAGE', description: 'Manage teams and team managers' },
    { name: 'BYPASS_OFFICE_VALIDATION', description: 'Bypass physical office location validation on login' },
    { name: 'MANAGE_ATTENDANCE_POLICY', description: 'Manage attendance policy rules' },
    { name: 'MANAGE_HOLIDAYS', description: 'Manage HR holidays' },
  ];

  const permissionsMap = new Map<string, number>();
  for (const p of permissionsData) {
    const perm = await prisma.permission.upsert({
      where: { name: p.name },
      update: { description: p.description },
      create: p,
    });
    permissionsMap.set(p.name, perm.id);
  }
  console.log('Permissions seeded successfully');

  // 3. Role Permissions Mapping
  const rolePermissions: Array<{ roleName: string; permName: string; scope: PermissionScope }> = [
    // Program Advisor
    { roleName: 'Program Advisor', permName: 'LEAD_VIEW', scope: PermissionScope.OWN },
    { roleName: 'Program Advisor', permName: 'LEAD_CREATE', scope: PermissionScope.ALL },
    { roleName: 'Program Advisor', permName: 'LEAD_UPDATE', scope: PermissionScope.OWN },
    { roleName: 'Program Advisor', permName: 'LEAD_CLAIM', scope: PermissionScope.ALL },
    { roleName: 'Program Advisor', permName: 'LEAD_SEARCH', scope: PermissionScope.ALL },

    // Manager
    { roleName: 'Manager', permName: 'LEAD_VIEW', scope: PermissionScope.TEAM },
    { roleName: 'Manager', permName: 'LEAD_CREATE', scope: PermissionScope.ALL },
    { roleName: 'Manager', permName: 'LEAD_UPDATE', scope: PermissionScope.TEAM },
    { roleName: 'Manager', permName: 'LEAD_CLAIM', scope: PermissionScope.ALL },
    { roleName: 'Manager', permName: 'LEAD_SEARCH', scope: PermissionScope.ALL },
    { roleName: 'Manager', permName: 'LEAD_ASSIGN', scope: PermissionScope.TEAM },
    { roleName: 'Manager', permName: 'LEAD_REASSIGN', scope: PermissionScope.TEAM },
    { roleName: 'Manager', permName: 'COLLEGE_LEAD_APPROVE', scope: PermissionScope.TEAM },
    { roleName: 'Manager', permName: 'REPORT_TEAM_VIEW', scope: PermissionScope.TEAM },
    { roleName: 'Manager', permName: 'TEAM_MANAGE', scope: PermissionScope.ALL },

    // HR
    { roleName: 'HR', permName: 'USER_MANAGE', scope: PermissionScope.ALL },
    { roleName: 'HR', permName: 'ATTENDANCE_MANAGE', scope: PermissionScope.ALL },
    { roleName: 'HR', permName: 'RECRUITMENT_MANAGE', scope: PermissionScope.ALL },
    { roleName: 'HR', permName: 'COLLEGE_MANAGE', scope: PermissionScope.ALL },
    { roleName: 'HR', permName: 'REPORT_HR_VIEW', scope: PermissionScope.ALL },
    { roleName: 'HR', permName: 'TEAM_MANAGE', scope: PermissionScope.ALL },
    { roleName: 'HR', permName: 'MANAGE_ATTENDANCE_POLICY', scope: PermissionScope.ALL },
    { roleName: 'HR', permName: 'MANAGE_HOLIDAYS', scope: PermissionScope.ALL },

    // Super Admin gets ALL permissions with ALL scope
    ...permissionsData.map((p) => ({
      roleName: 'SUPER_ADMIN',
      permName: p.name,
      scope: PermissionScope.ALL,
    })),
  ];

  for (const rp of rolePermissions) {
    const roleId = rolesMap.get(rp.roleName);
    const permissionId = permissionsMap.get(rp.permName);

    if (roleId && permissionId) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId,
            permissionId,
          },
        },
        update: { scope: rp.scope },
        create: {
          roleId,
          permissionId,
          scope: rp.scope,
        },
      });
    }
  }
  console.log('RolePermissions seeded successfully');

  // 4. Lead Statuses
  const leadStatuses = [
    { name: 'LEAD', description: 'Newly created lead', displayOrder: 1, color: 'blue' },
    { name: 'APPLICATION', description: 'Application process started', displayOrder: 2, color: 'yellow' },
    { name: 'INTERVIEW_SCHEDULED', description: 'Interview has been scheduled', displayOrder: 3, color: 'orange' },
    { name: 'INTERVIEW_DONE', description: 'Interview has been completed', displayOrder: 4, color: 'purple' },
    { name: 'LETTER_OUT', description: 'Offer or admission letter has been issued', displayOrder: 5, color: 'pink' },
    { name: 'ADMISSION_DONE', description: 'Admission has been completed', displayOrder: 6, color: 'green' },
    { name: 'CANCELLED', description: 'Admission has been cancelled', displayOrder: 7, color: 'red' },
  ];

  for (const status of leadStatuses) {
    await prisma.leadStatus.upsert({
      where: { name: status.name },
      update: {
        description: status.description,
        displayOrder: status.displayOrder,
        color: status.color,
      },
      create: status,
    });
  }
  console.log('Lead statuses seeded successfully');

  // 6. Default Attendance Policies for Existing Offices
  const offices = await prisma.office.findMany();
  for (const office of offices) {
    await prisma.attendancePolicy.upsert({
      where: { officeId: office.id },
      update: {},
      create: {
        officeId: office.id,
        officeStartTime: '10:00',
        casualLeaveCutoff: '10:30',
        halfDayCutoff: '14:00',
        officeEndTime: '19:00',
        isActive: true,
      },
    });
  }
  console.log('AttendancePolicies seeded for existing offices successfully');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });