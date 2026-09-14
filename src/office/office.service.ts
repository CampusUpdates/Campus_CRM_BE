import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateOfficeDto } from './dto/create-office.dto';
import { UpdateOfficeDto } from './dto/update-office.dto';
import { ActivityLogService } from 'src/activity-log/activity-log.service';
import { ActivityType } from '@prisma/client';

@Injectable()
export class OfficeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLogService: ActivityLogService,
  ) {}

  // Coordinate and Radius Server-Side Validator
  private validateCoordinatesAndRadius(
    latitude?: number | null,
    longitude?: number | null,
    radiusMeters?: number | null,
  ) {
    if (latitude !== undefined && latitude !== null) {
      if (
        typeof latitude !== 'number' ||
        isNaN(latitude) ||
        latitude < -90 ||
        latitude > 90
      ) {
        throw new BadRequestException(
          'Latitude must be a valid number between -90 and 90.',
        );
      }
    }

    if (longitude !== undefined && longitude !== null) {
      if (
        typeof longitude !== 'number' ||
        isNaN(longitude) ||
        longitude < -180 ||
        longitude > 180
      ) {
        throw new BadRequestException(
          'Longitude must be a valid number between -180 and 180.',
        );
      }
    }

    if (radiusMeters !== undefined && radiusMeters !== null) {
      if (
        typeof radiusMeters !== 'number' ||
        isNaN(radiusMeters) ||
        radiusMeters <= 0 ||
        !Number.isInteger(radiusMeters)
      ) {
        throw new BadRequestException('Radius must be a positive integer.');
      }
    }
  }

  // Find all office locations
  async findAll() {
    return this.prisma.office.findMany({
      orderBy: {
        name: 'asc',
      },
    });
  }

  // Find active office locations with configured coordinates
  async findActiveConfiguredOffices() {
    return this.prisma.office.findMany({
      where: {
        isActive: true,
        latitude: { not: null },
        longitude: { not: null },
      },
    });
  }

  // Find single office by ID
  async findOne(id: number) {
    const office = await this.prisma.office.findUnique({
      where: { id },
    });

    if (!office) {
      throw new NotFoundException('Office location not found.');
    }

    return office;
  }

  // Create an office
  async create(dto: CreateOfficeDto, currentUserId?: string) {
    const existingOffice = await this.prisma.office.findUnique({
      where: {
        name: dto.name.trim(),
      },
    });

    if (existingOffice) {
      throw new ConflictException('An office with this name already exists.');
    }

    this.validateCoordinatesAndRadius(
      dto.latitude,
      dto.longitude,
      dto.radiusMeters,
    );

    const office = await this.prisma.office.create({
      data: {
        name: dto.name.trim(),
        address: dto.address?.trim() || null,
        city: dto.city?.trim() || null,
        state: dto.state?.trim() || null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        radiusMeters: dto.radiusMeters ?? 100,
        isActive: dto.isActive ?? true,
        attendancePolicy: {
          create: {
            officeStartTime: '10:00',
            casualLeaveCutoff: '10:30',
            halfDayCutoff: '14:00',
            officeEndTime: '19:00',
            isActive: true,
          },
        },
      },
    });

    if (currentUserId) {
      await this.activityLogService.createLog({
        userId: currentUserId,
        activity: ActivityType.ATTENDANCE,
        entityType: 'OFFICE',
        entityId: String(office.id),
        description: `Created office location ${office.name}`,
      });
    }

    return office;
  }

  // Update office
  async update(id: number, dto: UpdateOfficeDto, currentUserId?: string) {
    const existing = await this.findOne(id);

    if (dto.name && dto.name.trim() !== existing.name) {
      const duplicate = await this.prisma.office.findUnique({
        where: { name: dto.name.trim() },
      });
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException('An office with this name already exists.');
      }
    }

    this.validateCoordinatesAndRadius(
      dto.latitude,
      dto.longitude,
      dto.radiusMeters,
    );

    const updatedOffice = await this.prisma.office.update({
      where: { id },
      data: {
        name: dto.name !== undefined ? dto.name.trim() : undefined,
        address:
          dto.address !== undefined
            ? dto.address
              ? dto.address.trim()
              : null
            : undefined,
        city:
          dto.city !== undefined
            ? dto.city
              ? dto.city.trim()
              : null
            : undefined,
        state:
          dto.state !== undefined
            ? dto.state
              ? dto.state.trim()
              : null
            : undefined,
        latitude: dto.latitude !== undefined ? dto.latitude : undefined,
        longitude: dto.longitude !== undefined ? dto.longitude : undefined,
        radiusMeters:
          dto.radiusMeters !== undefined ? dto.radiusMeters : undefined,
        isActive: dto.isActive !== undefined ? dto.isActive : undefined,
      },
    });

    if (currentUserId) {
      await this.activityLogService.createLog({
        userId: currentUserId,
        activity: ActivityType.ATTENDANCE,
        entityType: 'OFFICE',
        entityId: String(id),
        description: `Updated office location configuration for ${updatedOffice.name}`,
      });
    }

    return updatedOffice;
  }

  // Toggle office active status
  async updateStatus(id: number, isActive: boolean, currentUserId?: string) {
    const existing = await this.findOne(id);

    const updatedOffice = await this.prisma.office.update({
      where: { id },
      data: { isActive },
    });

    if (currentUserId) {
      const statusText = isActive ? 'activated' : 'deactivated';
      await this.activityLogService.createLog({
        userId: currentUserId,
        activity: ActivityType.ATTENDANCE,
        entityType: 'OFFICE',
        entityId: String(id),
        description: `${statusText.charAt(0).toUpperCase() + statusText.slice(1)} office location ${existing.name}`,
      });
    }

    return updatedOffice;
  }
}
