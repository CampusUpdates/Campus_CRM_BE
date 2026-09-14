import { Test, TestingModule } from '@nestjs/testing';
import { OfficeService } from './office.service';
import { GeofenceService } from './geofence.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ActivityLogService } from 'src/activity-log/activity-log.service';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

describe('OfficeService & GeofenceService Test Suite', () => {
  let officeService: OfficeService;
  let geofenceService: GeofenceService;

  const mockPrismaService = {
    office: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockActivityLogService = {
    createLog: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OfficeService,
        GeofenceService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ActivityLogService, useValue: mockActivityLogService },
      ],
    }).compile();

    officeService = module.get<OfficeService>(OfficeService);
    geofenceService = module.get<GeofenceService>(GeofenceService);
    jest.clearAllMocks();
  });

  describe('Haversine Distance & Geofence Matching', () => {
    it('should calculate distance accurately between two coordinates', () => {
      // Vapi Office: 20.3893, 72.9106
      // User location 50m away: 20.3897, 72.9106
      const dist = geofenceService.calculateDistanceMeters(
        20.3893,
        72.9106,
        20.3897,
        72.9106,
      );
      expect(dist).toBeGreaterThan(40);
      expect(dist).toBeLessThan(60);
    });

    it('should find nearest matching office within radius', () => {
      const activeOffices = [
        {
          id: 1,
          name: 'Vapi Office',
          latitude: 20.3893,
          longitude: 72.9106,
          radiusMeters: 100,
          isActive: true,
        },
        {
          id: 2,
          name: 'Mumbai Office',
          latitude: 19.076,
          longitude: 72.8777,
          radiusMeters: 100,
          isActive: true,
        },
      ] as any[];

      // User near Vapi Office (approx 20m)
      const result = geofenceService.findNearestMatchingOffice(
        20.3894,
        72.9106,
        activeOffices,
      );
      expect(result).not.toBeNull();
      expect(result?.office.name).toBe('Vapi Office');
      expect(result?.distanceMeters).toBeLessThan(100);
    });

    it('should return null when user is outside all office radiuses', () => {
      const activeOffices = [
        {
          id: 1,
          name: 'Vapi Office',
          latitude: 20.3893,
          longitude: 72.9106,
          radiusMeters: 100,
          isActive: true,
        },
      ] as any[];

      // User in Delhi (approx 1000km away)
      const result = geofenceService.findNearestMatchingOffice(
        28.6139,
        77.209,
        activeOffices,
      );
      expect(result).toBeNull();
    });

    it('should ignore inactive offices or offices without coordinates', () => {
      const activeOffices = [
        {
          id: 1,
          name: 'Inactive Office',
          latitude: 20.3893,
          longitude: 72.9106,
          radiusMeters: 500,
          isActive: false,
        },
        {
          id: 2,
          name: 'No Coord Office',
          latitude: null,
          longitude: null,
          radiusMeters: 500,
          isActive: true,
        },
      ] as any[];

      const result = geofenceService.findNearestMatchingOffice(
        20.3893,
        72.9106,
        activeOffices,
      );
      expect(result).toBeNull();
    });
  });

  describe('Office CRUD Server-Side Validations', () => {
    it('should reject invalid latitude (> 90)', async () => {
      mockPrismaService.office.findUnique.mockResolvedValue(null);

      await expect(
        officeService.create({
          name: 'Invalid Lat Office',
          latitude: 120,
          longitude: 72.91,
          radiusMeters: 100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid longitude (< -180)', async () => {
      mockPrismaService.office.findUnique.mockResolvedValue(null);

      await expect(
        officeService.create({
          name: 'Invalid Lon Office',
          latitude: 20.38,
          longitude: -200,
          radiusMeters: 100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject negative or zero radiusMeters', async () => {
      mockPrismaService.office.findUnique.mockResolvedValue(null);

      await expect(
        officeService.create({
          name: 'Invalid Radius Office',
          latitude: 20.38,
          longitude: 72.91,
          radiusMeters: 0,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create office successfully with valid coordinates', async () => {
      mockPrismaService.office.findUnique.mockResolvedValue(null);
      mockPrismaService.office.create.mockResolvedValue({
        id: 10,
        name: 'Ahmedabad Office',
        address: 'SG Highway',
        city: 'Ahmedabad',
        state: 'Gujarat',
        latitude: 23.0225,
        longitude: 72.5714,
        radiusMeters: 200,
        isActive: true,
      });

      const res = await officeService.create(
        {
          name: 'Ahmedabad Office',
          address: 'SG Highway',
          city: 'Ahmedabad',
          state: 'Gujarat',
          latitude: 23.0225,
          longitude: 72.5714,
          radiusMeters: 200,
        },
        'admin-user-id',
      );

      expect(res.name).toBe('Ahmedabad Office');
      expect(mockActivityLogService.createLog).toHaveBeenCalled();
    });
  });
});
