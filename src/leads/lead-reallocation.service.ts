import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ReallocationQueryDto, AssignmentStatusFilter } from './dto/reallocation-query.dto';

@Injectable()
export class LeadReallocationService {
  constructor(private prisma: PrismaService) {}

  async getLeadsForReallocation(query: ReallocationQueryDto) {
    const {
      page = 1,
      limit = 10,
      leadId,
      search,
      leadStatus,
      assignmentStatus,
      userId,
      createdFrom,
      createdTo,
    } = query;

    const skip = (page - 1) * limit;
    const now = new Date();

    const where: any = {};

    // Specific Lead ID (direct lookup from search selection)
    if (leadId) {
      where.id = leadId;
    }

    // Search
    if (search && search.trim() !== '') {
      const term = search.trim();
      const words = term.split(/\s+/).filter(Boolean);

      const orConditions: any[] = [
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term, mode: 'insensitive' } },
        { alternatePhone: { contains: term, mode: 'insensitive' } },
        { graduationCollegeName: { contains: term, mode: 'insensitive' } },
        {
          collegeApplications: {
            some: {
              college: {
                name: { contains: term, mode: 'insensitive' },
              },
            },
          },
        },
        {
          finalCollege: {
            name: { contains: term, mode: 'insensitive' },
          },
        },
      ];

      // Multi-word name matching (e.g. "Abhay Tomar", "Priyanshu Soni")
      if (words.length > 1) {
        orConditions.push({
          AND: words.map((w) => ({
            OR: [
              { firstName: { contains: w, mode: 'insensitive' } },
              { lastName: { contains: w, mode: 'insensitive' } },
            ],
          })),
        });
      }

      where.OR = orConditions;
    }

    // Lead Status
    if (leadStatus && leadStatus.toUpperCase() !== 'ALL') {
      where.status = {
        name: { equals: leadStatus, mode: 'insensitive' }
      };
    }

    // Created Date
    if (createdFrom || createdTo) {
      where.createdAt = {};
      if (createdFrom) where.createdAt.gte = new Date(createdFrom);
      if (createdTo) {
        const to = new Date(createdTo);
        to.setHours(23, 59, 59, 999);
        where.createdAt.lte = to;
      }
    }

    // Current Owner (UserId)
    // "Current Owner" means the user of the latest assignment.
    // If we want to filter by current owner:
    if (userId) {
      where.assignments = {
        some: {
          userId: userId,
          status: 'ACTIVE',
          expiresAt: { gt: now }
        }
      };
    }

    // Assignment Status
    if (assignmentStatus && assignmentStatus !== AssignmentStatusFilter.ALL) {
      const activeCondition = {
        status: 'ACTIVE',
        expiresAt: { gt: now }
      };

      if (assignmentStatus === AssignmentStatusFilter.ACTIVE) {
        if (!where.assignments) where.assignments = {};
        where.assignments.some = activeCondition;
      } else if (assignmentStatus === AssignmentStatusFilter.UNASSIGNED) {
        if (!where.assignments) where.assignments = {};
        where.assignments.none = {};
      } else if (assignmentStatus === AssignmentStatusFilter.EXPIRED) {
        if (!where.assignments) where.assignments = {};
        where.assignments.some = {}; // Must have at least one assignment

        // And NOT have any active assignment
        if (!where.NOT) where.NOT = {};
        where.NOT = {
          assignments: {
            some: activeCondition
          }
        };
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          status: true,
          assignments: {
            orderBy: { assignedAt: 'desc' },
            take: 1, // Get the most recent assignment for determining owner/status
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  role: { select: { id: true, name: true } },
                  team: { select: { id: true, name: true } },
                }
              }
            }
          },
          ownershipHistories: {
            orderBy: { createdAt: 'desc' },
            take: 1
          },
          callRecords: {
            orderBy: { createdAt: 'asc' },
            include: {
              createdBy: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
          finalCollege: {
            select: {
              id: true,
              name: true,
              city: true,
              state: true,
            },
          },
          collegeApplications: {
            include: {
              college: {
                select: {
                  id: true,
                  name: true,
                  city: true,
                  state: true,
                },
              },
              status: true,
            },
          },
        },
      }),
      this.prisma.lead.count({ where }),
    ]);

    const mappedData = data.map(lead => {
      const latestAssignment = lead.assignments[0];
      let computedAssignmentStatus = 'UNASSIGNED';
      let computedCurrentOwner: any = null;

      if (latestAssignment) {
        const isActive = latestAssignment.status === 'ACTIVE' && latestAssignment.expiresAt > now;
        if (isActive) {
          computedAssignmentStatus = 'ACTIVE';
          computedCurrentOwner = latestAssignment.user;
        } else {
          computedAssignmentStatus = 'EXPIRED';
          // Explicitly do NOT set current owner if expired, as per requirements:
          // "Expired assignment -> Historical owner, NOT current owner"
        }
      }

      const remarks = (lead.callRecords || []).map(record => ({
        id: record.id,
        notes: record.notes || '',
        outcome: record.outcome,
        createdAt: record.createdAt,
        startedAt: record.startedAt,
        author: record.createdBy
          ? `${record.createdBy.firstName} ${record.createdBy.lastName || ''}`.trim()
          : 'System',
        authorDetails: record.createdBy || null,
      }));

      return {
        id: lead.id,
        firstName: lead.firstName,
        lastName: lead.lastName,
        phone: lead.phone,
        email: lead.email,
        courseInterested: lead.courseInterested,
        status: lead.status,
        createdAt: lead.createdAt,
        latestAssignment,
        computedAssignmentStatus,
        computedCurrentOwner,
        remarks,
        finalCollege: lead.finalCollege,
        collegeApplications: lead.collegeApplications,
      };
    });

    return {
      data: mappedData,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
