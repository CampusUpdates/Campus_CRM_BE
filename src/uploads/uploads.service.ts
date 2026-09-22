import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataAssignmentStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateDataAssignmentDto,
  SelectionMode,
} from './dto/create-data-assignment.dto';
import {
  AssignmentStatusFilter,
  FilterStudentDataDto,
} from './dto/filter-student-data.dto';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractStudentFromRow(row: Record<string, any>): {
  firstName: string;
  middleName?: string;
  lastName?: string;
  phone: string;
  email?: string;
  city?: string;
  state?: string;
} | null {
  const norm: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k) {
      norm[normalizeKey(k)] = v != null ? String(v).trim() : '';
    }
  }

  let firstName =
    norm['firstname'] ||
    norm['first'] ||
    norm['fname'] ||
    norm['givenname'] ||
    '';

  let middleName =
    norm['middlename'] ||
    norm['middle'] ||
    norm['mname'] ||
    norm['initial'] ||
    norm['initials'] ||
    '';

  let lastName =
    norm['lastname'] ||
    norm['last'] ||
    norm['surname'] ||
    norm['lname'] ||
    norm['familyname'] ||
    '';

  // Fallback to combined name field if explicit firstName is missing
  if (!firstName) {
    const fullNameVal =
      norm['name'] ||
      norm['studentname'] ||
      norm['fullname'] ||
      norm['student'] ||
      norm['applicantname'] ||
      norm['candidate'] ||
      norm['candidatename'] ||
      norm['user'] ||
      '';

    if (fullNameVal) {
      if (!lastName && fullNameVal.includes(' ')) {
        const parts = fullNameVal.trim().split(/\s+/);
        firstName = parts[0];
        if (parts.length === 2) {
          lastName = parts[1];
        } else if (parts.length > 2) {
          if (!middleName) {
            middleName = parts.slice(1, -1).join(' ');
          }
          lastName = parts[parts.length - 1];
        }
      } else {
        firstName = fullNameVal.trim();
      }
    }
  }

  let phone =
    norm['phone'] ||
    norm['phonenumber'] ||
    norm['phoneno'] ||
    norm['phonenum'] ||
    norm['mobile'] ||
    norm['mobilenumber'] ||
    norm['mobileno'] ||
    norm['mobilenum'] ||
    norm['mob'] ||
    norm['contact'] ||
    norm['contactnumber'] ||
    norm['contactno'] ||
    norm['contactnum'] ||
    norm['tel'] ||
    norm['telephone'] ||
    norm['telephonenumber'] ||
    norm['telephoneno'] ||
    norm['cell'] ||
    norm['cellphone'] ||
    norm['cellnumber'] ||
    norm['ph'] ||
    '';

  if (typeof phone === 'string' && phone.endsWith('.0')) {
    phone = phone.slice(0, -2);
  }
  phone = String(phone).trim();

  const email =
    norm['email'] ||
    norm['emailaddress'] ||
    norm['mail'] ||
    norm['emailid'] ||
    norm['mailid'] ||
    norm['useremail'] ||
    '';

  const city =
    norm['city'] ||
    norm['location'] ||
    norm['district'] ||
    norm['town'] ||
    norm['place'] ||
    norm['address'] ||
    '';

  const state = norm['state'] || norm['province'] || norm['region'] || '';

  if (!firstName || !phone) {
    return null;
  }

  return {
    firstName,
    middleName: middleName || undefined,
    lastName: lastName || undefined,
    phone,
    email: email || undefined,
    city: city || undefined,
    state: state || undefined,
  };
}

export class UploadedMulterFile {
  fieldname?: string;
  originalname: string;
  encoding?: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class UploadsService {
  constructor(private readonly prisma: PrismaService) {}

  async processFileUpload(file: UploadedMulterFile, userId: string) {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file uploaded.');
    }

    const maxSizeBytes = 20 * 1024 * 1024; // 20 MB
    if (file.size > maxSizeBytes) {
      throw new BadRequestException(
        'File size exceeds maximum allowed limit of 20 MB.',
      );
    }

    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const savedFileName = `${timestamp}_${safeName}`;
    const filePath = path.join(uploadDir, savedFileName);

    fs.writeFileSync(filePath, file.buffer);
    const fileUrl = `/uploads/${savedFileName}`;

    const upload = await this.prisma.dataUpload.create({
      data: {
        uploadedById: userId,
        fileName: file.originalname,
        fileUrl,
        totalRecords: 0,
        status: 'PROCESSING',
      },
    });

    try {
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];

      if (!sheetName) {
        throw new Error('Spreadsheet has no readable sheets.');
      }

      const sheet = workbook.Sheets[sheetName];
      const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, {
        defval: '',
        raw: false,
      });

      const validRecords: any[] = [];
      const seenPhones = new Set<string>();

      for (const row of rawRows) {
        const rec = extractStudentFromRow(row);
        if (rec && !seenPhones.has(rec.phone)) {
          seenPhones.add(rec.phone);
          validRecords.push({
            uploadId: upload.id,
            firstName: rec.firstName,
            middleName: rec.middleName || null,
            lastName: rec.lastName || null,
            phone: rec.phone,
            email: rec.email || null,
            city: rec.city || null,
            state: rec.state || null,
          });
        }
      }

      if (validRecords.length === 0) {
        await this.prisma.dataUpload.update({
          where: { id: upload.id },
          data: { status: 'FAILED' },
        });
        throw new BadRequestException(
          'No valid student records found in file. Required columns (First Name, Phone) are missing or records are empty.',
        );
      }

      await this.prisma.$transaction(
        async (tx) => {
          await tx.studentData.createMany({
            data: validRecords,
          });

          await tx.dataUpload.update({
            where: { id: upload.id },
            data: {
              totalRecords: validRecords.length,
              status: 'COMPLETED',
            },
          });

          await tx.activityLog.create({
            data: {
              userId,
              activity: 'DATA_UPLOAD',
              entityType: 'DATA_UPLOAD',
              entityId: upload.id,
              description: `Uploaded dataset "${file.originalname}" with ${validRecords.length} records`,
            },
          });
        },
        { timeout: 30000 },
      );

      return {
        message: `Student dataset uploaded successfully. ${validRecords.length} records imported.`,
        uploadId: upload.id,
        totalRecords: validRecords.length,
        status: 'COMPLETED',
      };
    } catch (err: any) {
      await this.prisma.dataUpload
        .update({
          where: { id: upload.id },
          data: { status: 'FAILED' },
        })
        .catch(() => {});

      if (err instanceof BadRequestException) {
        throw err;
      }

      throw new BadRequestException(
        `Failed to process file: ${err.message || 'Invalid or corrupted file contents.'}`,
      );
    }
  }

  async findAllUploads(page: number = 1, limit: number = 10) {
    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(100, Math.max(1, Number(limit) || 10));
    const skip = (p - 1) * l;

    const [data, total] = await Promise.all([
      this.prisma.dataUpload.findMany({
        skip,
        take: l,
        orderBy: { uploadedAt: 'desc' },
        include: {
          uploadedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              username: true,
            },
          },
          _count: {
            select: {
              studentData: true,
            },
          },
        },
      }),
      this.prisma.dataUpload.count(),
    ]);

    return {
      data,
      pagination: {
        page: p,
        limit: l,
        total,
        totalPages: Math.ceil(total / l) || 1,
      },
    };
  }

  async findUploadOne(id: string) {
    const upload = await this.prisma.dataUpload.findUnique({
      where: { id },
      include: {
        uploadedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        studentData: true,
      },
    });

    if (!upload) {
      throw new NotFoundException('Data upload record not found');
    }

    return upload;
  }

  private getAvailableStudentDataCondition() {
    return {
      assignmentItems: {
        none: {
          assignment: {
            status: DataAssignmentStatus.ACTIVE,
          },
        },
      },
    };
  }

  private getAssignedStudentDataCondition() {
    return {
      assignmentItems: {
        some: {
          assignment: {
            status: DataAssignmentStatus.ACTIVE,
          },
        },
      },
    };
  }

  async findFilteredStudentData(filterDto: FilterStudentDataDto) {
    const page = Number(filterDto.page) || 1;
    const limit = Number(filterDto.limit) || 50;
    const skip = (page - 1) * limit;

    const availableWhere = this.getAvailableStudentDataCondition();
    const assignedWhere = this.getAssignedStudentDataCondition();

    const baseConditions: any[] = [];

    if (filterDto.states && filterDto.states.length > 0) {
      baseConditions.push({ state: { in: filterDto.states } });
    }

    if (filterDto.cities && filterDto.cities.length > 0) {
      baseConditions.push({ city: { in: filterDto.cities } });
    }

    if (filterDto.uploadIds && filterDto.uploadIds.length > 0) {
      baseConditions.push({ uploadId: { in: filterDto.uploadIds } });
    }

    if (filterDto.search && filterDto.search.trim()) {
      const s = filterDto.search.trim();
      baseConditions.push({
        OR: [
          { firstName: { contains: s, mode: 'insensitive' } },
          { lastName: { contains: s, mode: 'insensitive' } },
          { phone: { contains: s, mode: 'insensitive' } },
          { email: { contains: s, mode: 'insensitive' } },
          { city: { contains: s, mode: 'insensitive' } },
          { state: { contains: s, mode: 'insensitive' } },
        ],
      });
    }

    const baseWhere = baseConditions.length > 0 ? { AND: baseConditions } : {};

    let statusWhere = {};
    if (filterDto.assignmentStatus === AssignmentStatusFilter.AVAILABLE) {
      statusWhere = availableWhere;
    } else if (filterDto.assignmentStatus === AssignmentStatusFilter.ASSIGNED) {
      statusWhere = assignedWhere;
    }

    const finalWhere = {
      AND: [baseWhere, statusWhere],
    };

    const availableCountWhere = {
      AND: [baseWhere, availableWhere],
    };

    const assignedCountWhere = {
      AND: [baseWhere, assignedWhere],
    };

    // Batch 1: Primary paginated dataset and total matching count
    const [data, total] = await Promise.all([
      this.prisma.studentData.findMany({
        where: finalWhere,
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
        include: {
          upload: {
            select: { id: true, fileName: true, uploadedAt: true },
          },
          assignmentItems: {
            where: {
              assignment: {
                status: DataAssignmentStatus.ACTIVE,
              },
            },
            include: {
              assignment: {
                select: {
                  id: true,
                  assignedTo: {
                    select: { firstName: true, lastName: true },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.studentData.count({ where: finalWhere }),
    ]);

    // Batch 2: Status counts and distribution calculations
    const [availableCount, assignedCount, availableMatchingStudents] =
      await Promise.all([
        this.prisma.studentData.count({ where: availableCountWhere }),
        this.prisma.studentData.count({ where: assignedCountWhere }),
        this.prisma.studentData.findMany({
          where: availableCountWhere,
          select: { state: true },
        }),
      ]);

    // Batch 3: Distinct filter options
    const [distinctStates, distinctCities, uploadsList] = await Promise.all([
      this.prisma.studentData.findMany({
        distinct: ['state'],
        select: { state: true },
        where: { state: { not: null } },
      }),
      this.prisma.studentData.findMany({
        distinct: ['city'],
        select: { city: true, state: true },
        where: { city: { not: null } },
      }),
      this.prisma.dataUpload.findMany({
        select: { id: true, fileName: true },
        orderBy: { uploadedAt: 'desc' },
      }),
    ]);

    const distribution: Record<string, number> = {};
    for (const s of availableMatchingStudents) {
      const st = s.state || 'Unspecified';
      distribution[st] = (distribution[st] || 0) + 1;
    }

    return {
      data: data.map((item) => ({
        ...item,
        isAvailable: item.assignmentItems.length === 0,
        activeAssignment: item.assignmentItems[0]?.assignment || null,
      })),
      meta: {
        total,
        availableCount,
        assignedCount,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
      distribution,
      filterOptions: {
        states: distinctStates.map((s) => s.state).filter(Boolean) as string[],
        cities: distinctCities.map((c) => c.city).filter(Boolean) as string[],
        uploads: uploadsList,
      },
    };
  }

  async getUnassignedStudents() {
    const filterRes = await this.findFilteredStudentData({
      assignmentStatus: AssignmentStatusFilter.AVAILABLE,
      page: 1,
      limit: 1000,
    });
    return filterRes.data;
  }

  async findEligibleAssignees(assignerId: string, roleId: number) {
    let isSuperAdmin = roleId === 1;
    if (!isSuperAdmin) {
      const assignerUser = await this.prisma.user.findUnique({
        where: { id: assignerId },
        select: { role: { select: { name: true } } },
      });
      if (assignerUser?.role?.name?.toUpperCase().includes('SUPER_ADMIN')) {
        isSuperAdmin = true;
      }
    }

    if (isSuperAdmin) {
      return this.prisma.user.findMany({
        where: {
          status: 'ACTIVE',
          role: { name: 'Program Advisor' },
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          username: true,
          team: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { firstName: 'asc' },
      });
    }

    const managedTeams = await this.prisma.team.findMany({
      where: { managerId: assignerId },
      select: { id: true },
    });

    const managedTeamIds = managedTeams.map((t) => t.id);

    if (managedTeamIds.length === 0) {
      return [];
    }

    return this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        role: { name: 'Program Advisor' },
        OR: [
          ...(managedTeamIds.length > 0
            ? [{ teamId: { in: managedTeamIds } }]
            : []),
          { managerId: assignerId },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        username: true,
        team: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { firstName: 'asc' },
    });
  }

  private getFarFutureExpiry(): Date {
    return new Date('2099-12-31T23:59:59.999Z');
  }

  async assignData(
    dto: CreateDataAssignmentDto,
    assignerId: string,
    roleId: number,
  ) {
    const { assignedToId, selectionMode, studentDataIds, quantity, filters } =
      dto;
    const now = new Date();

    const eligibleAssignees = await this.findEligibleAssignees(
      assignerId,
      roleId,
    );
    const targetUser = eligibleAssignees.find((u) => u.id === assignedToId);

    if (!targetUser) {
      throw new BadRequestException(
        'Target user is not an active Program Advisor under your management.',
      );
    }

    let candidateIds: string[] = [];
    const availableWhere = this.getAvailableStudentDataCondition();

    if (
      selectionMode === SelectionMode.ALL_MATCHING ||
      !studentDataIds ||
      studentDataIds.length === 0
    ) {
      const filterDto = filters || new FilterStudentDataDto();
      const baseConditions: any[] = [];

      if (filterDto.states && filterDto.states.length > 0) {
        baseConditions.push({ state: { in: filterDto.states } });
      }
      if (filterDto.cities && filterDto.cities.length > 0) {
        baseConditions.push({ city: { in: filterDto.cities } });
      }
      if (filterDto.uploadIds && filterDto.uploadIds.length > 0) {
        baseConditions.push({ uploadId: { in: filterDto.uploadIds } });
      }
      if (filterDto.search && filterDto.search.trim()) {
        const s = filterDto.search.trim();
        baseConditions.push({
          OR: [
            { firstName: { contains: s, mode: 'insensitive' } },
            { lastName: { contains: s, mode: 'insensitive' } },
            { phone: { contains: s, mode: 'insensitive' } },
            { email: { contains: s, mode: 'insensitive' } },
            { city: { contains: s, mode: 'insensitive' } },
            { state: { contains: s, mode: 'insensitive' } },
          ],
        });
      }

      const baseWhere =
        baseConditions.length > 0 ? { AND: baseConditions } : {};
      const finalWhere = { AND: [baseWhere, availableWhere] };

      const takeLimit = quantity && quantity > 0 ? quantity : undefined;

      const matchingRecords = await this.prisma.studentData.findMany({
        where: finalWhere,
        take: takeLimit,
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });

      candidateIds = matchingRecords.map((r) => r.id);
    } else {
      candidateIds = studentDataIds;
    }

    if (candidateIds.length === 0) {
      throw new BadRequestException(
        'No eligible student data records found matching your selection criteria.',
      );
    }

    const requestedCount = candidateIds.length;
    const expiresAt = this.getFarFutureExpiry();

    return this.prisma.$transaction(
      async (tx) => {
        const currentlyEligible = await tx.studentData.findMany({
          where: {
            id: { in: candidateIds },
            ...availableWhere,
          },
          select: { id: true },
        });

        const eligibleIds = currentlyEligible.map((s) => s.id);
        const skippedCount = requestedCount - eligibleIds.length;

        if (eligibleIds.length === 0) {
          throw new BadRequestException(
            'Selected records are no longer available for assignment (already assigned to another advisor).',
          );
        }

        const assignment = await tx.dataAssignment.create({
          data: {
            assignedToId,
            assignedById: assignerId,
            assignedAt: now,
            expiresAt,
            status: DataAssignmentStatus.ACTIVE,
          },
        });

        await tx.dataAssignmentItem.createMany({
          data: eligibleIds.map((studentDataId) => ({
            dataAssignmentId: assignment.id,
            studentDataId,
          })),
          skipDuplicates: true,
        });

        const targetName =
          `${targetUser.firstName} ${targetUser.lastName || ''}`.trim();
        const teamName = targetUser.team?.name || 'Admissions Team';

        await tx.activityLog.create({
          data: {
            userId: assignerId,
            activity: 'DATA_ASSIGNMENT',
            entityType: 'DATA_ASSIGNMENT',
            entityId: assignment.id,
            description: `Assigned ${eligibleIds.length} student records to ${targetName} (${teamName})`,
          },
        });

        const notification = await tx.notification.create({
          data: {
            type: 'DATA_ASSIGNMENT',
            title: 'New Student Data Assignment',
            message: `${eligibleIds.length} student records have been assigned to you by your manager.`,
          },
        });

        await tx.notificationRecipient.create({
          data: {
            notificationId: notification.id,
            userId: assignedToId,
            isRead: false,
          },
        });

        const message =
          skippedCount > 0
            ? `${eligibleIds.length} of ${requestedCount} records assigned to ${targetName} (${teamName}). ${skippedCount} records were skipped.`
            : `Successfully assigned ${eligibleIds.length} records to ${targetName} (${teamName}).`;

        return {
          message,
          assignment,
          requestedCount,
          assignedCount: eligibleIds.length,
          skippedCount,
          expiryTimeFormatted: 'Permanent',
        };
      },
      { timeout: 30000 },
    );
  }

  async findAllAssignments(page: number = 1, limit: number = 10) {
    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(100, Math.max(1, Number(limit) || 10));
    const skip = (p - 1) * l;

    const [data, total] = await Promise.all([
      this.prisma.dataAssignment.findMany({
        skip,
        take: l,
        orderBy: { assignedAt: 'desc' },
        include: {
          assignedTo: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              username: true,
              email: true,
              team: {
                select: { name: true },
              },
            },
          },
          assignedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              username: true,
            },
          },
          _count: {
            select: {
              items: true,
            },
          },
        },
      }),
      this.prisma.dataAssignment.count(),
    ]);

    return {
      data,
      pagination: {
        page: p,
        limit: l,
        total,
        totalPages: Math.ceil(total / l) || 1,
      },
    };
  }

  async findAssignmentDetails(assignmentId: string) {
    const assignment = await this.prisma.dataAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            username: true,
            role: { select: { id: true, name: true } },
            team: { select: { id: true, name: true } },
          },
        },
        assignedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            username: true,
          },
        },
        items: {
          include: {
            studentData: {
              include: {
                callRecords: {
                  orderBy: [
                    { startedAt: 'desc' },
                    { createdAt: 'desc' },
                  ],
                  take: 1,
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
              },
            },
          },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Data assignment with ID "${assignmentId}" not found`,
      );
    }

    return {
      id: assignment.id,
      assignedToId: assignment.assignedToId,
      assignedById: assignment.assignedById,
      assignedAt: assignment.assignedAt,
      expiresAt: assignment.expiresAt,
      status: assignment.status,
      reclaimedAt: assignment.reclaimedAt,
      assignedTo: assignment.assignedTo,
      assignedBy: assignment.assignedBy,
      totalRecords: assignment.items.length,
      items: assignment.items.map((item) => {
        const student = item.studentData;
        const latestCall = student.callRecords[0] || null;

        return {
          id: item.id,
          studentDataId: student.id,
          firstName: student.firstName,
          middleName: student.middleName,
          lastName: student.lastName,
          phone: student.phone,
          email: student.email,
          city: student.city,
          state: student.state,
          createdAt: student.createdAt,
          recentCall: latestCall
            ? {
                id: latestCall.id,
                outcome: latestCall.outcome,
                notes: latestCall.notes,
                startedAt: latestCall.startedAt,
                endedAt: latestCall.endedAt,
                durationSeconds: latestCall.durationSeconds,
                createdAt: latestCall.createdAt,
                createdBy: latestCall.createdBy
                  ? {
                      id: latestCall.createdBy.id,
                      firstName: latestCall.createdBy.firstName,
                      lastName: latestCall.createdBy.lastName,
                      email: latestCall.createdBy.email,
                    }
                  : null,
              }
            : null,
        };
      }),
    };
  }

  async reclaimAdvisorData(
    advisorId: string,
    managerId: string,
    roleId: number,
  ) {
    const eligibleAdvisors = await this.findEligibleAssignees(
      managerId,
      roleId,
    );
    const isEligible = eligibleAdvisors.some((a) => a.id === advisorId);

    if (!isEligible) {
      throw new ForbiddenException(
        'You can only reclaim data assignments from Program Advisors within your authorized team scope.',
      );
    }

    const activeAssignments = await this.prisma.dataAssignment.findMany({
      where: {
        assignedToId: advisorId,
        status: DataAssignmentStatus.ACTIVE,
      },
      include: {
        items: true,
      },
    });

    if (activeAssignments.length === 0) {
      return {
        message: 'No active data assignments found for this Program Advisor.',
        reclaimedAssignmentsCount: 0,
        reclaimedRecordsCount: 0,
        advisorId,
      };
    }

    const assignmentIds = activeAssignments.map((a) => a.id);
    const totalRecordsCount = activeAssignments.reduce(
      (sum, a) => sum + a.items.length,
      0,
    );

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.dataAssignment.updateMany({
        where: {
          id: { in: assignmentIds },
        },
        data: {
          status: DataAssignmentStatus.RECLAIMED,
          reclaimedAt: now,
        },
      });

      await tx.activityLog.create({
        data: {
          userId: managerId,
          activity: 'DATA_ASSIGNMENT',
          entityType: 'DATA_ASSIGNMENT',
          entityId: advisorId,
          description: `Reclaimed ${totalRecordsCount} student data records from Program Advisor ${advisorId}`,
        },
      });

      const notification = await tx.notification.create({
        data: {
          type: 'DATA_ASSIGNMENT',
          title: 'Student Data Reclaimed',
          message: `${totalRecordsCount} assigned student data records have been reclaimed by your manager.`,
        },
      });

      await tx.notificationRecipient.create({
        data: {
          notificationId: notification.id,
          userId: advisorId,
          isRead: false,
        },
      });

      return {
        message: `Successfully reclaimed ${totalRecordsCount} records from advisor.`,
        reclaimedAssignmentsCount: activeAssignments.length,
        reclaimedRecordsCount: totalRecordsCount,
        advisorId,
      };
    });
  }

  async reclaimAllAdvisorData(managerId: string, roleId: number) {
    const eligibleAdvisors = await this.findEligibleAssignees(
      managerId,
      roleId,
    );
    const eligibleAdvisorIds = eligibleAdvisors.map((a) => a.id);

    if (eligibleAdvisorIds.length === 0) {
      return {
        message: 'No eligible Program Advisors found in your scope.',
        affectedAdvisorsCount: 0,
        reclaimedAssignmentsCount: 0,
        reclaimedRecordsCount: 0,
      };
    }

    const activeAssignments = await this.prisma.dataAssignment.findMany({
      where: {
        assignedToId: { in: eligibleAdvisorIds },
        status: DataAssignmentStatus.ACTIVE,
      },
      include: {
        items: true,
      },
    });

    if (activeAssignments.length === 0) {
      return {
        message: 'No active data assignments found across your team.',
        affectedAdvisorsCount: 0,
        reclaimedAssignmentsCount: 0,
        reclaimedRecordsCount: 0,
      };
    }

    const affectedAdvisorIds = [
      ...new Set(activeAssignments.map((a) => a.assignedToId)),
    ];
    const assignmentIds = activeAssignments.map((a) => a.id);
    const totalRecordsCount = activeAssignments.reduce(
      (sum, a) => sum + a.items.length,
      0,
    );

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.dataAssignment.updateMany({
        where: {
          id: { in: assignmentIds },
        },
        data: {
          status: DataAssignmentStatus.RECLAIMED,
          reclaimedAt: now,
        },
      });

      await tx.activityLog.create({
        data: {
          userId: managerId,
          activity: 'DATA_ASSIGNMENT',
          entityType: 'DATA_ASSIGNMENT',
          entityId: managerId,
          description: `Bulk reclaimed ${totalRecordsCount} student data records across ${affectedAdvisorIds.length} Program Advisors.`,
        },
      });

      for (const advId of affectedAdvisorIds) {
        const advRecordsCount = activeAssignments
          .filter((a) => a.assignedToId === advId)
          .reduce((sum, a) => sum + a.items.length, 0);

        const notification = await tx.notification.create({
          data: {
            type: 'DATA_ASSIGNMENT',
            title: 'Student Data Reclaimed',
            message: `${advRecordsCount} assigned student data records have been reclaimed by your manager.`,
          },
        });

        await tx.notificationRecipient.create({
          data: {
            notificationId: notification.id,
            userId: advId,
            isRead: false,
          },
        });
      }

      return {
        message: `Successfully reclaimed ${totalRecordsCount} student data records across ${affectedAdvisorIds.length} Program Advisors.`,
        affectedAdvisorsCount: affectedAdvisorIds.length,
        reclaimedAssignmentsCount: activeAssignments.length,
        reclaimedRecordsCount: totalRecordsCount,
      };
    });
  }
}
