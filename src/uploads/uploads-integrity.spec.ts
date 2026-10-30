jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => { },
  CronExpression: {
    EVERY_5_MINUTES: '*/5 * * * *',
    EVERY_HOUR: '0 * * * *',
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { UploadsService, UploadedMulterFile } from './uploads.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as XLSX from 'xlsx';

describe('UploadsService - Category Validation and Duplicate Detection Integrity', () => {
  let service: UploadsService;
  let prismaMock: any;

  const validCategoryId = '6b75096a-a61d-4927-ba64-96a6ea1127b9';
  const otherCategoryId = 'ff643935-2a39-47b3-b361-21157bfe94a6';
  const nonExistentCategoryId = '00000000-0000-0000-0000-000000000000';
  const testUserId = '298c540b-77d4-43ea-b562-f73b718884ce';

  function createTestWorkbook(rows: Record<string, any>[]): Buffer {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  beforeEach(async () => {
    prismaMock = {
      dataCategory: {
        findUnique: jest.fn(),
      },
      dataUpload: {
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
      },
      studentData: {
        findMany: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      activityLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockImplementation(async (callback) => {
        return callback(prismaMock);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<UploadsService>(UploadsService);
  });

  describe('Category Validation', () => {
    it('REG-01: Rejects missing, null, or empty categoryId with HTTP 400 "Category is required."', async () => {
      const file: UploadedMulterFile = {
        originalname: 'test.xlsx',
        size: 100,
        buffer: Buffer.from('dummy'),
      };

      await expect(service.processFileUpload(file, testUserId, ''))
        .rejects.toThrow(new BadRequestException('Category is required.'));

      await expect(service.processFileUpload(file, testUserId, '   '))
        .rejects.toThrow(new BadRequestException('Category is required.'));

      await expect(service.processFileUpload(file, testUserId, null as any))
        .rejects.toThrow(new BadRequestException('Category is required.'));
    });

    it('REG-02: Rejects non-existent category UUID with HTTP 400', async () => {
      prismaMock.dataCategory.findUnique.mockResolvedValue(null);

      const file: UploadedMulterFile = {
        originalname: 'test.xlsx',
        size: 100,
        buffer: Buffer.from('dummy'),
      };

      await expect(service.processFileUpload(file, testUserId, nonExistentCategoryId))
        .rejects.toThrow(new BadRequestException(`Category with ID "${nonExistentCategoryId}" does not exist.`));
      expect(prismaMock.dataUpload.create).not.toHaveBeenCalled();
    });

    it('Invalid UUID format: Rejects non-UUID string without raw database error', async () => {
      const file: UploadedMulterFile = {
        originalname: 'test.xlsx',
        size: 100,
        buffer: Buffer.from('dummy'),
      };

      await expect(service.processFileUpload(file, testUserId, 'not-a-valid-uuid'))
        .rejects.toThrow(new BadRequestException('Category with ID "not-a-valid-uuid" does not exist.'));
      expect(prismaMock.dataCategory.findUnique).not.toHaveBeenCalled();
    });

    it('Legacy upload confirmation safeguard: Rejects confirmImport for NULL-category upload', async () => {
      prismaMock.dataUpload.findUnique.mockResolvedValue({
        id: 'legacy-upload-1',
        categoryId: null,
        status: 'PROCESSING',
        fileUrl: '/uploads/legacy.xlsx',
      });

      await expect(service.confirmImport('legacy-upload-1', {}, testUserId))
        .rejects.toThrow(new BadRequestException('Cannot confirm import: Upload has no assigned category.'));
    });
  });

  describe('Duplicate Detection', () => {
    it('REG-03: Valid upload with new students succeeds with valid categoryId', async () => {
      prismaMock.dataCategory.findUnique.mockResolvedValue({
        id: validCategoryId,
        name: 'MHCET',
      });

      prismaMock.dataUpload.create.mockResolvedValue({
        id: 'upload-123',
        categoryId: validCategoryId,
      });

      const buffer = createTestWorkbook([
        { Name: 'John Doe', Phone: '9876543210', Email: 'john@example.com' },
      ]);

      const file: UploadedMulterFile = {
        originalname: 'students.xlsx',
        size: buffer.length,
        buffer,
      };

      prismaMock.studentData.findMany.mockResolvedValue([]);

      const result = await service.processFileUpload(file, testUserId, validCategoryId);

      expect(result.status).toBe('COMPLETED');
      expect(result.totalRecords).toBe(1);
      expect(prismaMock.studentData.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            firstName: 'John',
            lastName: 'Doe',
            phone: '9876543210',
            categoryId: validCategoryId,
          }),
        ],
      });
    });

    it('REG-04: Intra-category duplicate triggers REQUIRES_REVIEW and preserves workflow', async () => {
      prismaMock.dataCategory.findUnique.mockResolvedValue({
        id: validCategoryId,
        name: 'MHCET',
      });

      prismaMock.dataUpload.create.mockResolvedValue({
        id: 'upload-123',
        categoryId: validCategoryId,
      });

      const buffer = createTestWorkbook([
        { Name: 'John Doe', Phone: '+919876543210', Email: 'john@example.com' },
      ]);

      const file: UploadedMulterFile = {
        originalname: 'students.xlsx',
        size: buffer.length,
        buffer,
      };

      prismaMock.studentData.findMany.mockResolvedValue([
        {
          id: 'existing-1',
          firstName: 'John',
          lastName: 'Doe',
          phone: '9876543210',
          email: 'john.old@example.com',
          city: 'Mumbai',
          state: 'Maharashtra',
          categoryId: validCategoryId,
          category: { id: validCategoryId, name: 'MHCET' },
        },
      ]);

      const result = await service.processFileUpload(file, testUserId, validCategoryId);

      expect(result.status).toBe('REQUIRES_REVIEW');
      expect(result.duplicates.length).toBe(1);
      expect(result.duplicates[0].matchType).toBe('INTRA_CATEGORY');
      expect(result.duplicates[0].categoryName).toBe('MHCET');
      expect(prismaMock.studentData.createMany).not.toHaveBeenCalled();
    });

    it('REG-05: Cross-category duplicate triggers REQUIRES_REVIEW and is not inserted silently', async () => {
      prismaMock.dataCategory.findUnique.mockResolvedValue({
        id: validCategoryId,
        name: 'MHCET',
      });

      prismaMock.dataUpload.create.mockResolvedValue({
        id: 'upload-456',
        categoryId: validCategoryId,
      });

      const buffer = createTestWorkbook([
        { Name: 'Jane Smith', Phone: '9123456780', Email: 'jane@example.com' },
      ]);

      const file: UploadedMulterFile = {
        originalname: 'cross_students.xlsx',
        size: buffer.length,
        buffer,
      };

      // Existing student is in HIRING category
      prismaMock.studentData.findMany.mockResolvedValue([
        {
          id: 'existing-hiring-1',
          firstName: 'Jane',
          lastName: 'Smith',
          phone: '+919123456780',
          email: 'jane@work.com',
          city: 'Delhi',
          state: 'Delhi',
          categoryId: otherCategoryId,
          category: { id: otherCategoryId, name: 'HIRING' },
        },
      ]);

      const result = await service.processFileUpload(file, testUserId, validCategoryId);

      expect(result.status).toBe('REQUIRES_REVIEW');
      expect(result.duplicates.length).toBe(1);
      expect(result.duplicates[0].matchType).toBe('CROSS_CATEGORY');
      expect(result.duplicates[0].categoryName).toBe('HIRING');
      expect(result.duplicates[0].existing.firstName).toContain('[HIRING]');
      expect(prismaMock.studentData.createMany).not.toHaveBeenCalled();
    });

    it('Spreadsheet internal duplicates: De-duplicates duplicate rows within same file', async () => {
      prismaMock.dataCategory.findUnique.mockResolvedValue({
        id: validCategoryId,
        name: 'MHCET',
      });

      prismaMock.dataUpload.create.mockResolvedValue({
        id: 'upload-789',
        categoryId: validCategoryId,
      });

      const buffer = createTestWorkbook([
        { Name: 'Alice Wonderland', Phone: '9998887771' },
        { Name: 'Alice Duplicate', Phone: '9998887771' }, // Same phone in sheet
      ]);

      const file: UploadedMulterFile = {
        originalname: 'internal_dups.xlsx',
        size: buffer.length,
        buffer,
      };

      prismaMock.studentData.findMany.mockResolvedValue([]);

      const result = await service.processFileUpload(file, testUserId, validCategoryId);

      expect(result.status).toBe('COMPLETED');
      expect(result.totalRecords).toBe(1); // Only 1 record imported
    });
  });
});
