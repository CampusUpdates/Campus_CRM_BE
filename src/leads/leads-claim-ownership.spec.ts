import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { LeadsService } from './leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TeamLeadAuthorizationService } from '../teams/team-lead-authorization.service';
import {
  ClaimRequestStatus,
  LeadSource,
  OwnershipChangeReason,
} from '@prisma/client';

describe('LeadsService - Lead Reclaim & Ownership History', () => {
  let service: LeadsService;
  let prismaMock: any;

  const validLeadUuid = '11111111-1111-4111-8111-111111111111';
  const superAdminUuid = '22222222-2222-4222-8222-222222222222';
  const advisorUuid = '33333333-3333-4333-8333-333333333333';
  const requesterUuid = '44444444-4444-4444-8444-444444444444';
  const claimRequestUuid = '55555555-5555-4555-8555-555555555555';

  const mockSuperAdminUser = {
    id: superAdminUuid,
    firstName: 'Super',
    lastName: 'Admin',
    email: 'superadmin@crm.com',
    status: 'ACTIVE',
    roleId: 1,
    role: { id: 1, name: 'SUPER_ADMIN' },
  };

  const mockAdvisorUser = {
    id: advisorUuid,
    firstName: 'John',
    lastName: 'Advisor',
    email: 'advisor@crm.com',
    status: 'ACTIVE',
    roleId: 2,
    role: { id: 2, name: 'PROGRAM_ADVISOR' },
  };

  const mockRequesterUser = {
    id: requesterUuid,
    firstName: 'Priya',
    lastName: 'Requester',
    email: 'priya@crm.com',
    status: 'ACTIVE',
    roleId: 2,
    role: { id: 2, name: 'PROGRAM_ADVISOR' },
  };

  const mockStatusLead = { id: 1, name: 'LEAD', isActive: true };
  const mockStatusAdmissionDone = {
    id: 2,
    name: 'ADMISSION_DONE',
    isActive: true,
  };

  const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago (expired)
  const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 days in future (active)

  const expiredLead = {
    id: validLeadUuid,
    statusId: 1,
    status: mockStatusLead,
    createdById: advisorUuid,
    assignments: [
      {
        id: 101,
        userId: advisorUuid,
        status: 'EXPIRED',
        assignedAt: pastDate,
        expiresAt: pastDate,
      },
    ],
    collegeApplications: [],
  };

  const activeLead = {
    id: validLeadUuid,
    statusId: 1,
    status: mockStatusLead,
    createdById: advisorUuid,
    assignments: [
      {
        id: 102,
        userId: advisorUuid,
        status: 'ACTIVE',
        assignedAt: new Date(),
        expiresAt: futureDate,
      },
    ],
    collegeApplications: [],
  };

  const admissionDoneLead = {
    id: validLeadUuid,
    statusId: 2,
    status: mockStatusAdmissionDone,
    createdById: advisorUuid,
    assignments: [],
    collegeApplications: [],
  };

  beforeEach(async () => {
    prismaMock = {
      user: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === superAdminUuid)
            return Promise.resolve(mockSuperAdminUser);
          if (where.id === advisorUuid) return Promise.resolve(mockAdvisorUser);
          if (where.id === requesterUuid)
            return Promise.resolve(mockRequesterUser);
          return Promise.resolve(null);
        }),
      },
      leadStatus: {
        findFirst: jest.fn().mockResolvedValue(mockStatusLead),
        findUnique: jest.fn().mockResolvedValue(mockStatusLead),
      },
      college: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      leadCollege: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      lead: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(expiredLead),
        create: jest.fn().mockResolvedValue({
          id: validLeadUuid,
          createdById: advisorUuid,
          statusId: 1,
          firstName: 'New',
          lastName: 'Student',
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      leadClaimRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: claimRequestUuid,
            ...data,
            requestedAt: new Date(),
          }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest
          .fn()
          .mockImplementation(({ where, data }) =>
            Promise.resolve({ id: where.id, ...data }),
          ),
      },
      leadAssignment: {
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 999, ...data }),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      leadOwnershipHistory: {
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'hist-1', ...data }),
          ),
      },
      activityLog: {
        create: jest.fn().mockResolvedValue({ id: 'act-1' }),
      },
      $queryRaw: jest.fn().mockImplementation((query) => {
        const sql = query.strings ? query.strings.join('') : String(query);
        if (sql.includes('LeadClaimRequest')) {
          return Promise.resolve([
            {
              id: claimRequestUuid,
              leadId: validLeadUuid,
              requestedById: requesterUuid,
              status: 'PENDING',
            },
          ]);
        }
        if (sql.includes('Lead')) {
          return Promise.resolve([{ id: validLeadUuid }]);
        }
        return Promise.resolve([]);
      }),
      $transaction: jest.fn((cb) => cb(prismaMock)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: NotificationsService,
          useValue: { createNotification: jest.fn() },
        },
        {
          provide: TeamLeadAuthorizationService,
          useValue: {
            isTeamLead: jest.fn().mockResolvedValue(false),
            getTeamLeadAdvisorIds: jest.fn().mockResolvedValue([]),
            getTeamLeadAssignedTeamIds: jest.fn().mockResolvedValue([]),
            canTeamLeadAccessTeam: jest.fn().mockResolvedValue(false),
            canTeamLeadAccessAdvisor: jest.fn().mockResolvedValue(false),
            canTeamLeadAccessLead: jest.fn().mockResolvedValue(false),
          },
        },
      ],
    }).compile();

    service = module.get<LeadsService>(LeadsService);
  });

  describe('Claim Request Creation', () => {
    it('1. Claim request after 4-day expiry succeeds', async () => {
      prismaMock.lead.findUnique.mockResolvedValue(expiredLead);
      const res = await service.createClaimRequest(
        validLeadUuid,
        requesterUuid,
      );

      expect(res).toBeDefined();
      expect(res.status).toBe('PENDING');
      expect(prismaMock.leadClaimRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          leadId: validLeadUuid,
          requestedById: requesterUuid,
          status: 'PENDING',
        }),
      });
      expect(prismaMock.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          activity: 'LEAD',
          entityType: 'LEAD_CLAIM_REQUEST',
        }),
      });
    });

    it('2. Claim request before expiry fails', async () => {
      prismaMock.lead.findUnique.mockResolvedValue(activeLead);
      await expect(
        service.createClaimRequest(validLeadUuid, requesterUuid),
      ).rejects.toThrow(ConflictException);
    });

    it('3. admission_done lead cannot be reclaimed', async () => {
      prismaMock.lead.findUnique.mockResolvedValue(admissionDoneLead);
      await expect(
        service.createClaimRequest(validLeadUuid, requesterUuid),
      ).rejects.toThrow(ForbiddenException);
    });

    it('4. Duplicate PENDING claim request fails', async () => {
      prismaMock.lead.findUnique.mockResolvedValue(expiredLead);
      prismaMock.leadClaimRequest.findFirst.mockResolvedValue({
        id: 'existing-req-id',
        status: 'PENDING',
      });

      await expect(
        service.createClaimRequest(validLeadUuid, requesterUuid),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Super Admin List & Authorization', () => {
    it('5. Non-Super Admin cannot list claim requests', async () => {
      await expect(service.getClaimRequests(advisorUuid)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('6. Non-Super Admin cannot approve/reject', async () => {
      await expect(
        service.processClaimRequest(claimRequestUuid, advisorUuid, {
          status: ClaimRequestStatus.APPROVED,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Super Admin Approval & Rejection', () => {
    it('7. Super Admin can approve', async () => {
      prismaMock.lead.findUnique.mockResolvedValue(expiredLead);

      const res = await service.processClaimRequest(
        claimRequestUuid,
        superAdminUuid,
        {
          status: ClaimRequestStatus.APPROVED,
          remarks: 'Approved by super admin',
        },
      );

      expect(res.message).toBe('Claim request approved successfully');
      expect(res.claimRequest.status).toBe('APPROVED');
    });

    it('8. Approval creates the correct new ownership (LeadAssignment)', async () => {
      prismaMock.lead.findUnique.mockResolvedValue(expiredLead);

      const res = await service.processClaimRequest(
        claimRequestUuid,
        superAdminUuid,
        {
          status: ClaimRequestStatus.APPROVED,
        },
      );

      expect(res.assignment).toBeDefined();
      expect(prismaMock.leadAssignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          leadId: validLeadUuid,
          userId: requesterUuid,
          status: 'ACTIVE',
        }),
      });
    });

    it('9. Approval creates LeadOwnershipHistory', async () => {
      prismaMock.lead.findUnique.mockResolvedValue(expiredLead);

      await service.processClaimRequest(claimRequestUuid, superAdminUuid, {
        status: ClaimRequestStatus.APPROVED,
      });

      expect(prismaMock.leadOwnershipHistory.create).toHaveBeenCalled();
    });

    it('10. History contains correct previousOwnerId', async () => {
      prismaMock.lead.findUnique.mockResolvedValue(expiredLead);

      await service.processClaimRequest(claimRequestUuid, superAdminUuid, {
        status: ClaimRequestStatus.APPROVED,
      });

      expect(prismaMock.leadOwnershipHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          previousOwnerId: advisorUuid,
        }),
      });
    });

    it('11. History contains correct newOwnerId', async () => {
      prismaMock.lead.findUnique.mockResolvedValue(expiredLead);

      await service.processClaimRequest(claimRequestUuid, superAdminUuid, {
        status: ClaimRequestStatus.APPROVED,
      });

      expect(prismaMock.leadOwnershipHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          newOwnerId: requesterUuid,
        }),
      });
    });

    it('12. History contains correct changedById', async () => {
      prismaMock.lead.findUnique.mockResolvedValue(expiredLead);

      await service.processClaimRequest(claimRequestUuid, superAdminUuid, {
        status: ClaimRequestStatus.APPROVED,
      });

      expect(prismaMock.leadOwnershipHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          changedById: superAdminUuid,
        }),
      });
    });

    it('13. History reason is CLAIM_APPROVED', async () => {
      prismaMock.lead.findUnique.mockResolvedValue(expiredLead);

      await service.processClaimRequest(claimRequestUuid, superAdminUuid, {
        status: ClaimRequestStatus.APPROVED,
      });

      expect(prismaMock.leadOwnershipHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reason: OwnershipChangeReason.CLAIM_APPROVED,
        }),
      });
    });

    it('14. Rejection does not change ownership', async () => {
      const res = await service.processClaimRequest(
        claimRequestUuid,
        superAdminUuid,
        {
          status: ClaimRequestStatus.REJECTED,
          remarks: 'Not eligible',
        },
      );

      expect(res.message).toBe('Claim request rejected successfully');
      expect(prismaMock.leadAssignment.create).not.toHaveBeenCalled();
    });

    it('15. Rejection does not create ownership history', async () => {
      await service.processClaimRequest(claimRequestUuid, superAdminUuid, {
        status: ClaimRequestStatus.REJECTED,
      });

      expect(prismaMock.leadOwnershipHistory.create).not.toHaveBeenCalled();
    });

    it('16. Rejection creates ActivityLog', async () => {
      await service.processClaimRequest(claimRequestUuid, superAdminUuid, {
        status: ClaimRequestStatus.REJECTED,
        remarks: 'Rejected reason',
      });

      expect(prismaMock.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: superAdminUuid,
          activity: 'LEAD',
          entityType: 'LEAD_CLAIM_REQUEST',
          description: expect.stringContaining('CLAIM_REJECTED'),
        }),
      });
    });

    it('17. Approval creates ActivityLog', async () => {
      prismaMock.lead.findUnique.mockResolvedValue(expiredLead);

      await service.processClaimRequest(claimRequestUuid, superAdminUuid, {
        status: ClaimRequestStatus.APPROVED,
      });

      expect(prismaMock.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: superAdminUuid,
          activity: 'LEAD',
          entityType: 'LEAD_CLAIM_REQUEST',
          description: expect.stringContaining('CLAIM_APPROVED'),
        }),
      });
    });

    it('18. Already processed request cannot be processed again', async () => {
      prismaMock.$queryRaw.mockImplementation((query) => {
        const sql = query.strings ? query.strings.join('') : String(query);
        if (sql.includes('LeadClaimRequest')) {
          return Promise.resolve([
            {
              id: claimRequestUuid,
              leadId: validLeadUuid,
              requestedById: requesterUuid,
              status: 'APPROVED',
            },
          ]);
        }
        return Promise.resolve([]);
      });

      await expect(
        service.processClaimRequest(claimRequestUuid, superAdminUuid, {
          status: ClaimRequestStatus.APPROVED,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('19. Concurrent approval cannot create duplicate ownership', async () => {
      let callCount = 0;
      prismaMock.$queryRaw.mockImplementation((query) => {
        const sql = query.strings ? query.strings.join('') : String(query);
        if (sql.includes('LeadClaimRequest')) {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve([
              {
                id: claimRequestUuid,
                leadId: validLeadUuid,
                requestedById: requesterUuid,
                status: 'PENDING',
              },
            ]);
          } else {
            return Promise.resolve([
              {
                id: claimRequestUuid,
                leadId: validLeadUuid,
                requestedById: requesterUuid,
                status: 'APPROVED',
              },
            ]);
          }
        }
        return Promise.resolve([{ id: validLeadUuid }]);
      });

      await service.processClaimRequest(claimRequestUuid, superAdminUuid, {
        status: ClaimRequestStatus.APPROVED,
      });

      await expect(
        service.processClaimRequest(claimRequestUuid, superAdminUuid, {
          status: ClaimRequestStatus.APPROVED,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Ownership History Rule on Lead Creation & Reassignment', () => {
    it('20. Initial ownership is recorded where an actual owner is established', async () => {
      await service.create(
        {
          firstName: 'New',
          lastName: 'Student',
          email: 'new.student@example.com',
          phone: '9999999999',
          city: 'Delhi',
          state: 'Delhi',
          source: LeadSource.OTHER,
          collegeIds: [],
        },
        advisorUuid,
      );

      expect(prismaMock.leadOwnershipHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          previousOwnerId: null,
          newOwnerId: advisorUuid,
          changedById: advisorUuid,
          reason: OwnershipChangeReason.INITIAL_ASSIGNMENT,
        }),
      });
    });

    it('21. Existing admin reassignment records ADMIN_REASSIGNMENT history', async () => {
      prismaMock.lead.findUnique.mockResolvedValue(expiredLead);

      await service.assignLead(validLeadUuid, requesterUuid, {
        sub: superAdminUuid,
      });

      expect(prismaMock.leadOwnershipHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          previousOwnerId: advisorUuid,
          newOwnerId: requesterUuid,
          changedById: superAdminUuid,
          reason: OwnershipChangeReason.ADMIN_REASSIGNMENT,
        }),
      });
    });
  });
});
