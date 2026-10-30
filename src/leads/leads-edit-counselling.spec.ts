import { Test, TestingModule } from '@nestjs/testing';
import { LeadsService } from './leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TeamLeadAuthorizationService } from '../teams/team-lead-authorization.service';
import { EmailService } from '../email/email.service';
import { BadRequestException } from '@nestjs/common';

describe('LeadsService - Edit Form Counselling Requests for Older Leads', () => {
  let service: LeadsService;
  let prismaMock: any;
  let notificationsServiceMock: any;
  let teamLeadAuthMock: any;

  const paId = '11111111-1111-1111-1111-111111111111';
  const managerId = '22222222-2222-2222-2222-222222222222';
  const teamLeadId = '33333333-3333-3333-3333-333333333333';
  const leadId = '44444444-4444-4444-4444-444444444444';
  const collegeId1 = '55555555-5555-5555-5555-555555555555';
  const collegeId2 = '66666666-6666-6666-6666-666666666666';

  const originalCreatedAt = new Date('2026-08-15T10:00:00.000Z'); // Created months ago

  const mockOlderLead = {
    id: leadId,
    firstName: 'Aarav',
    lastName: 'Patel',
    phone: '9876543210',
    email: 'aarav@example.com',
    createdAt: originalCreatedAt,
    createdById: paId,
    teamId: 1,
    statusId: 1,
    status: { id: 1, name: 'LEAD' },
    assignments: [
      {
        userId: paId,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 86400000),
        user: { id: paId, teamId: 1, managerId },
      },
    ],
  };

  beforeEach(async () => {
    notificationsServiceMock = {
      createNotification: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    };

    teamLeadAuthMock = {
      isTeamLead: jest.fn().mockResolvedValue(false),
      canTeamLeadAccessLead: jest.fn().mockResolvedValue(false),
    };

    prismaMock = {
      $transaction: jest.fn().mockImplementation((cb) => cb(prismaMock)),
      lead: {
        findUnique: jest.fn().mockResolvedValue(mockOlderLead),
        update: jest.fn().mockImplementation(({ where, data }) =>
          Promise.resolve({
            ...mockOlderLead,
            ...data,
            createdAt: originalCreatedAt, // original creation date unchanged
          }),
        ),
      },
      leadAssignment: {
        findFirst: jest.fn().mockResolvedValue(mockOlderLead.assignments[0]),
      },
      leadCollege: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      leadNegativeCollege: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      collegeCounsellingRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'counsel-new', leadId, collegeId: collegeId1 }),
        update: jest.fn().mockResolvedValue({ id: 'counsel-existing' }),
      },
      college: {
        findMany: jest.fn().mockImplementation(({ where }) => {
          const ids = where?.id?.in || [];
          return Promise.resolve(
            ids.map((id: string) => ({
              id,
              name: `College ${id.slice(0, 4)}`,
              city: 'Delhi',
              state: 'Delhi',
              isActive: true,
              hasTieUp: true,
            })),
          );
        }),
        findUnique: jest.fn().mockImplementation(({ where }) => {
          return Promise.resolve({
            id: where.id,
            name: 'Apex Institute of Technology',
          });
        }),
      },
      user: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === paId) {
            return Promise.resolve({
              id: paId,
              firstName: 'Amit',
              lastName: 'Verma',
              role: { name: 'Program Advisor' },
              teamId: 1,
              managerId,
            });
          }
          if (where.id === managerId) {
            return Promise.resolve({
              id: managerId,
              firstName: 'Vikram',
              lastName: 'Manager',
              role: { name: 'Manager' },
              teamId: 1,
            });
          }
          return Promise.resolve(null);
        }),
        findMany: jest.fn().mockImplementation(({ where }) => {
          if (where?.id?.in) {
            return Promise.resolve(
              where.id.in.map((id: string) => ({ id, status: 'ACTIVE' })),
            );
          }
          if (where?.OR) {
            return Promise.resolve([{ id: 'sa-1', status: 'ACTIVE' }]);
          }
          return Promise.resolve([]);
        }),
      },
      team: {
        findMany: jest.fn().mockResolvedValue([{ id: 1 }]),
        findUnique: jest.fn().mockResolvedValue({ id: 1, managerId }),
      },
      teamLeadAdvisor: {
        findMany: jest.fn().mockResolvedValue([{ teamLeadId }]),
      },
      teamLead: {
        findMany: jest.fn().mockResolvedValue([{ userId: teamLeadId }]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: NotificationsService, useValue: notificationsServiceMock },
        { provide: TeamLeadAuthorizationService, useValue: teamLeadAuthMock },
        { provide: EmailService, useValue: { sendLeadCreationNotificationToManager: jest.fn() } },
      ],
    }).compile();

    service = module.get<LeadsService>(LeadsService);
  });

  describe('Adding counselling requests on older leads via update', () => {
    it('1. should allow adding a counselling request to an older lead without altering createdAt', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const prefDateStr = tomorrow.toISOString().split('T')[0];

      const res = await service.update(
        leadId,
        {
          counsellingRequests: [
            {
              collegeId: collegeId1,
              preferredDate: prefDateStr,
              preferredTime: '11:00 AM',
              purpose: 'Campus Tour & Admission Counselling',
            },
          ],
        },
        { sub: paId },
        'OWN',
      );

      // Verify lead.update was called and did not change createdAt
      expect(prismaMock.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: leadId },
          data: expect.not.objectContaining({ createdAt: expect.anything() }),
        }),
      );
      expect(res.createdAt).toEqual(originalCreatedAt);

      // Verify college counselling request was created
      expect(prismaMock.collegeCounsellingRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          leadId,
          collegeId: collegeId1,
          preferredTime: '11:00 AM',
          purpose: 'Campus Tour & Admission Counselling',
          status: 'REQUESTED',
          requestedById: paId,
        }),
      });

      // Verify notification sent to Manager and Team Lead
      expect(notificationsServiceMock.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Counselling Requested',
          type: 'SYSTEM',
          recipientUserIds: expect.arrayContaining([managerId, teamLeadId]),
        }),
        expect.anything(),
      );
    });

    it('2. should prevent duplicate requests when the edit form is saved multiple times with same college', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const prefDateStr = tomorrow.toISOString().split('T')[0];

      // Simulate that collegeId1 ALREADY has an active REQUESTED request in DB
      prismaMock.collegeCounsellingRequest.findMany.mockResolvedValueOnce([
        {
          id: 'existing-counsel-1',
          leadId,
          collegeId: collegeId1,
          status: 'REQUESTED',
          preferredDate: new Date(`${prefDateStr}T00:00:00.000Z`),
          preferredTime: '10:00 AM',
          purpose: 'Original Request',
        },
      ]);

      await service.update(
        leadId,
        {
          counsellingRequests: [
            {
              collegeId: collegeId1,
              preferredDate: prefDateStr,
              preferredTime: '11:30 AM',
              purpose: 'Updated purpose',
            },
          ],
        },
        { sub: paId },
        'OWN',
      );

      // Must NOT create a duplicate
      expect(prismaMock.collegeCounsellingRequest.create).not.toHaveBeenCalled();

      // Must update the existing active request
      expect(prismaMock.collegeCounsellingRequest.update).toHaveBeenCalledWith({
        where: { id: 'existing-counsel-1' },
        data: expect.objectContaining({
          preferredTime: '11:30 AM',
          purpose: 'Updated purpose',
        }),
      });

      // Must NOT send duplicate notification
      expect(notificationsServiceMock.createNotification).not.toHaveBeenCalled();
    });

    it('3. should preserve existing counselling requests when editing other lead fields', async () => {
      // Simulate existing requests in DB
      prismaMock.collegeCounsellingRequest.findMany.mockResolvedValue([
        {
          id: 'counsel-old',
          leadId,
          collegeId: collegeId1,
          status: 'SCHEDULED',
        },
      ]);

      // Edit only phone and city
      const res = await service.update(
        leadId,
        {
          phone: '9123456780',
          city: 'Bangalore',
        },
        { sub: paId },
        'OWN',
      );

      // Verify lead updated
      expect(prismaMock.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: leadId },
          data: expect.objectContaining({
            phone: '9123456780',
            city: 'Bangalore',
          }),
        }),
      );

      // Existing counselling request was queried and returned intact
      expect(prismaMock.collegeCounsellingRequest.create).not.toHaveBeenCalled();
      expect(res.counsellingRequests).toBeDefined();
      expect(res.counsellingRequests.length).toBe(1);
    });

    it('4. should reject newly added counselling requests if preferred date is in the past', async () => {
      const pastDate = '2020-01-01';

      await expect(
        service.update(
          leadId,
          {
            counsellingRequests: [
              {
                collegeId: collegeId2,
                preferredDate: pastDate,
                purpose: 'Invalid past date',
              },
            ],
          },
          { sub: paId },
          'OWN',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.collegeCounsellingRequest.create).not.toHaveBeenCalled();
    });

    it('5. should return counsellingRequests when findOne is called for an older lead', async () => {
      prismaMock.lead.findUnique.mockResolvedValue({
        ...mockOlderLead,
        counsellingRequests: [
          {
            id: 'counsel-1',
            collegeId: collegeId1,
            status: 'REQUESTED',
            college: { id: collegeId1, name: 'Apex Institute' },
          },
        ],
      });

      const res = await service.findOne(leadId, { sub: paId }, 'OWN');

      expect(prismaMock.lead.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: leadId },
          include: expect.objectContaining({
            counsellingRequests: expect.anything(),
          }),
        }),
      );
      expect(res.counsellingRequests).toBeDefined();
      expect(res.counsellingRequests.length).toBe(1);
    });
  });
});
