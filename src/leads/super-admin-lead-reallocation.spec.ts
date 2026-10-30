import { Test, TestingModule } from '@nestjs/testing';
import { LeadsService } from './leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TeamLeadAuthorizationService } from '../teams/team-lead-authorization.service';
import { ConflictException, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';

describe('Super Admin Lead Reallocation Override', () => {
  let service: LeadsService;
  let mockPrisma: any;
  let mockNotificationsService: any;
  let mockTeamLeadAuthService: any;
  let mockTx: any;

  const superAdminId = 'super-admin-0000-0000-0000-000000000001';
  const managerId = 'manager-0000-0000-0000-000000000002';
  const teamLeadId = 'teamlead-0000-0000-0000-000000000003';
  const paTeamA = 'pa-teama-0000-0000-0000-000000000004';
  const paTeamB = 'pa-teamb-0000-0000-0000-000000000005';
  const managerTarget = 'manager-target-0000-0000-0000-000000000006';
  const hrUserId = 'hr-user-0000-0000-0000-000000000007';

  const leadId = 'lead-0000-0000-0000-000000000001';

  beforeEach(async () => {
    mockTx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      lead: {
        findUnique: jest.fn(),
      },
      leadAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 101,
            leadId: data.leadId,
            userId: data.userId,
            assignedAt: data.assignedAt,
            expiresAt: data.expiresAt,
            status: data.status,
          }),
        ),
      },
      leadOwnershipHistory: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 'hist-1', ...data }),
        ),
      },
      activityLog: {
        create: jest.fn().mockResolvedValue({ id: 'act-1' }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ firstName: 'Super', lastName: 'Admin' }),
      },
    };

    mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (callback) => {
        return callback(mockTx);
      }),
      user: {
        findUnique: jest.fn(),
      },
    };

    mockNotificationsService = {
      createNotification: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    };

    mockTeamLeadAuthService = {
      isTeamLead: jest.fn().mockResolvedValue(false),
      canTeamLeadAccessLead: jest.fn().mockResolvedValue(false),
      canTeamLeadAccessAdvisor: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: TeamLeadAuthorizationService, useValue: mockTeamLeadAuthService },
      ],
    }).compile();

    service = module.get<LeadsService>(LeadsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Super Admin Reallocation Overrides', () => {
    it('1.1. Super Admin can reallocate an ACTIVE lead assigned to a PA within 4-day window', async () => {
      // Authenticated caller: Super Admin
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: superAdminId, roleId: 1, role: { id: 1, name: 'SUPER_ADMIN' } })
        .mockResolvedValueOnce({ id: paTeamB, status: 'ACTIVE', roleId: 2, role: { id: 2, name: 'Program Advisor' } });

      const activeExpiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      mockTx.lead.findUnique.mockResolvedValue({
        id: leadId,
        firstName: 'Active',
        lastName: 'Student',
        status: { name: 'LEAD' },
        assignments: [
          { userId: paTeamA, status: 'ACTIVE', expiresAt: activeExpiry },
        ],
      });

      const res = await service.assignLead(leadId, paTeamB, { sub: superAdminId });

      expect(res.assignment.userId).toBe(paTeamB);
      expect(res.assignment.status).toBe('ACTIVE');

      // Previous active assignment was marked EXPIRED
      expect(mockTx.leadAssignment.updateMany).toHaveBeenCalledWith({
        where: { leadId, status: 'ACTIVE' },
        data: { status: 'EXPIRED' },
      });

      // Ownership history recorded reassignment
      expect(mockTx.leadOwnershipHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          leadId,
          previousOwnerId: paTeamA,
          newOwnerId: paTeamB,
          changedById: superAdminId,
          reason: 'ADMIN_REASSIGNMENT',
        }),
      });

      // Persistent notification sent to new owner
      expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientUserIds: [paTeamB],
          title: 'Lead Reallocated to You',
        }),
      );
    });

    it('1.2. Super Admin can reallocate an EXPIRED lead', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: superAdminId, roleId: 1, role: { id: 1, name: 'SUPER_ADMIN' } })
        .mockResolvedValueOnce({ id: paTeamB, status: 'ACTIVE', roleId: 2, role: { id: 2, name: 'Program Advisor' } });

      const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      mockTx.lead.findUnique.mockResolvedValue({
        id: leadId,
        firstName: 'Expired',
        lastName: 'Student',
        status: { name: 'LEAD' },
        assignments: [
          { userId: paTeamA, status: 'EXPIRED', expiresAt: expiredDate },
        ],
      });

      const res = await service.assignLead(leadId, paTeamB, { sub: superAdminId });
      expect(res.assignment.userId).toBe(paTeamB);
      expect(mockNotificationsService.createNotification).toHaveBeenCalled();
    });

    it('1.3. Super Admin can reallocate an UNASSIGNED lead', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: superAdminId, roleId: 1, role: { id: 1, name: 'SUPER_ADMIN' } })
        .mockResolvedValueOnce({ id: paTeamB, status: 'ACTIVE', roleId: 2, role: { id: 2, name: 'Program Advisor' } });

      mockTx.lead.findUnique.mockResolvedValue({
        id: leadId,
        firstName: 'Unassigned',
        lastName: 'Student',
        status: { name: 'LEAD' },
        assignments: [],
      });

      const res = await service.assignLead(leadId, paTeamB, { sub: superAdminId });
      expect(res.assignment.userId).toBe(paTeamB);
      expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientUserIds: [paTeamB],
          title: 'New Lead Assigned',
        }),
      );
    });

    it('1.4. Super Admin can reallocate a lead assigned to another team PA to a PA in a different team', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: superAdminId, roleId: 1, role: { id: 1, name: 'SUPER_ADMIN' } })
        .mockResolvedValueOnce({ id: paTeamB, status: 'ACTIVE', roleId: 2, role: { id: 2, name: 'Program Advisor' } });

      mockTx.lead.findUnique.mockResolvedValue({
        id: leadId,
        firstName: 'CrossTeam',
        lastName: 'Student',
        status: { name: 'LEAD' },
        assignments: [
          { userId: paTeamA, status: 'ACTIVE', expiresAt: new Date(Date.now() + 1000000) },
        ],
      });

      const res = await service.assignLead(leadId, paTeamB, { sub: superAdminId });
      expect(res.assignment.userId).toBe(paTeamB);
      expect(mockTeamLeadAuthService.canTeamLeadAccessLead).not.toHaveBeenCalled();
    });

    it('1.5. Super Admin can reallocate a lead assigned to a Manager', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: superAdminId, roleId: 1, role: { id: 1, name: 'SUPER_ADMIN' } })
        .mockResolvedValueOnce({ id: managerTarget, status: 'ACTIVE', roleId: 3, role: { id: 3, name: 'Manager' } });

      mockTx.lead.findUnique.mockResolvedValue({
        id: leadId,
        firstName: 'ManagerOwned',
        lastName: 'Student',
        status: { name: 'LEAD' },
        assignments: [
          { userId: managerId, status: 'ACTIVE', expiresAt: new Date(Date.now() + 1000000) },
        ],
      });

      const res = await service.assignLead(leadId, managerTarget, { sub: superAdminId });
      expect(res.assignment.userId).toBe(managerTarget);
    });

    it('1.6. Super Admin can reallocate an ADMITTED lead (ADMISSION_DONE) and preserves lead status', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: superAdminId, roleId: 1, role: { id: 1, name: 'SUPER_ADMIN' } })
        .mockResolvedValueOnce({ id: paTeamB, status: 'ACTIVE', roleId: 2, role: { id: 2, name: 'Program Advisor' } });

      mockTx.lead.findUnique.mockResolvedValue({
        id: leadId,
        firstName: 'Admitted',
        lastName: 'Student',
        status: { name: 'ADMISSION_DONE' },
        assignments: [
          { userId: paTeamA, status: 'ACTIVE', expiresAt: new Date(Date.now() + 1000000) },
        ],
      });

      const res = await service.assignLead(leadId, paTeamB, { sub: superAdminId });
      expect(res.assignment.userId).toBe(paTeamB);

      // Lead status was NOT modified or reopened
      expect(mockTx.lead.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: leadId } }));
    });

    it('1.7. Super Admin can reallocate a CANCELLED or INVALID lead', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: superAdminId, roleId: 1, role: { id: 1, name: 'SUPER_ADMIN' } })
        .mockResolvedValueOnce({ id: paTeamB, status: 'ACTIVE', roleId: 2, role: { id: 2, name: 'Program Advisor' } });

      mockTx.lead.findUnique.mockResolvedValue({
        id: leadId,
        firstName: 'Cancelled',
        lastName: 'Student',
        status: { name: 'CANCELLED' },
        assignments: [
          { userId: paTeamA, status: 'EXPIRED', expiresAt: new Date(Date.now() - 50000) },
        ],
      });

      const res = await service.assignLead(leadId, paTeamB, { sub: superAdminId });
      expect(res.assignment.userId).toBe(paTeamB);
    });
  });

  describe('2. Target User Validation', () => {
    it('2.1. Throws NotFoundException if target user does not exist or is inactive', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: superAdminId, roleId: 1, role: { id: 1, name: 'SUPER_ADMIN' } })
        .mockResolvedValueOnce({ id: 'inactive-user', status: 'INACTIVE', roleId: 2 });

      await expect(
        service.assignLead(leadId, 'inactive-user', { sub: superAdminId }),
      ).rejects.toThrow(NotFoundException);
    });

    it('2.2. Throws BadRequestException if target user has HR role', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: superAdminId, roleId: 1, role: { id: 1, name: 'SUPER_ADMIN' } })
        .mockResolvedValueOnce({ id: hrUserId, status: 'ACTIVE', roleId: 4, role: { id: 4, name: 'HR' } });

      await expect(
        service.assignLead(leadId, hrUserId, { sub: superAdminId }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('3. Non-Super Admin Restrictions Preserved', () => {
    it('3.1. Rejects Manager reallocation for active lead inside 4-day window', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: managerId, roleId: 3, role: { id: 3, name: 'Manager' } })
        .mockResolvedValueOnce({ id: paTeamB, status: 'ACTIVE', roleId: 2, role: { id: 2, name: 'Program Advisor' } });

      mockTx.lead.findUnique.mockResolvedValue({
        id: leadId,
        firstName: 'Active',
        lastName: 'Student',
        status: { name: 'LEAD' },
        assignments: [
          { userId: paTeamA, status: 'ACTIVE', expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) },
        ],
      });

      await expect(
        service.assignLead(leadId, paTeamB, { sub: managerId }),
      ).rejects.toThrow(ConflictException);

      expect(mockNotificationsService.createNotification).not.toHaveBeenCalled();
    });

    it('3.2. Rejects Manager reallocation for admitted lead (ADMISSION_DONE)', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: managerId, roleId: 3, role: { id: 3, name: 'Manager' } })
        .mockResolvedValueOnce({ id: paTeamB, status: 'ACTIVE', roleId: 2, role: { id: 2, name: 'Program Advisor' } });

      mockTx.lead.findUnique.mockResolvedValue({
        id: leadId,
        firstName: 'Admitted',
        lastName: 'Student',
        status: { name: 'ADMISSION_DONE' },
        assignments: [],
      });

      await expect(
        service.assignLead(leadId, paTeamB, { sub: managerId }),
      ).rejects.toThrow(ForbiddenException);

      expect(mockNotificationsService.createNotification).not.toHaveBeenCalled();
    });

    it('3.3. Rejects Team Lead assigning lead outside supervised advisors', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: teamLeadId,
        roleId: 5,
        role: { id: 5, name: 'Team Lead' },
      });

      mockTeamLeadAuthService.isTeamLead.mockResolvedValue(true);
      mockTeamLeadAuthService.canTeamLeadAccessLead.mockResolvedValue(true);
      mockTeamLeadAuthService.canTeamLeadAccessAdvisor.mockResolvedValue(false); // Unsupervised advisor

      await expect(
        service.assignLead(leadId, paTeamB, { sub: teamLeadId }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
