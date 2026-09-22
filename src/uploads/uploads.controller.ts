import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadsService, UploadedMulterFile } from './uploads.service';
import { CreateDataAssignmentDto } from './dto/create-data-assignment.dto';
import { FilterStudentDataDto } from './dto/filter-student-data.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions/permissions.guard';
import type { AuthenticatedRequest } from 'src/auth/interfaces/authenticated-request.interface';
import { PrismaService } from 'src/prisma/prisma.service';

@Controller('uploads')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UploadsController {
  constructor(
    private readonly uploadsService: UploadsService,
    private readonly prisma: PrismaService,
  ) { }

  private async assertAdminOrManager(userId: string, roleId: number) {
    // Role ID 1: SUPER_ADMIN, Role ID 3: MANAGER
    if (roleId === 1 || roleId === 3) {
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: { select: { name: true } } },
    });

    const roleName = user?.role?.name?.toUpperCase() || '';
    if (roleName.includes('SUPER_ADMIN') || roleName.includes('MANAGER')) {
      return;
    }

    throw new ForbiddenException(
      'Access denied: Data Management operations require SUPER_ADMIN or MANAGER role.',
    );
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: UploadedMulterFile,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.processFileUpload(file, req.user.sub);
  }

  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Req() req?: AuthenticatedRequest,
  ) {
    if (req?.user) {
      await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    }
    return this.uploadsService.findAllUploads(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 10,
    );
  }

  @Get('student-data')
  async findFilteredStudentData(
    @Query() filterDto: FilterStudentDataDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.findFilteredStudentData(filterDto);
  }

  @Get('eligible-assignees')
  async getEligibleAssignees(@Req() req: AuthenticatedRequest) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.findEligibleAssignees(
      req.user.sub,
      req.user.roleId,
    );
  }

  @Get('unassigned-students')
  async getUnassignedStudents(@Req() req: AuthenticatedRequest) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.getUnassignedStudents();
  }

  @Get('data-assignments')
  async findAllAssignments(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Req() req?: AuthenticatedRequest,
  ) {
    if (req?.user) {
      await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    }
    return this.uploadsService.findAllAssignments(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 10,
    );
  }

  @Get('data-assignments/:id')
  async findAssignmentDetails(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.findAssignmentDetails(id);
  }

  @Post('assign-data')
  async assignData(
    @Body() assignDto: CreateDataAssignmentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.assignData(
      assignDto,
      req.user.sub,
      req.user.roleId,
    );
  }

  @Post('reclaim-advisor-data/:advisorId')
  async reclaimAdvisorData(
    @Param('advisorId') advisorId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.reclaimAdvisorData(
      advisorId,
      req.user.sub,
      req.user.roleId,
    );
  }

  @Post('reclaim-all-advisor-data')
  async reclaimAllAdvisorData(@Req() req: AuthenticatedRequest) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.reclaimAllAdvisorData(
      req.user.sub,
      req.user.roleId,
    );
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.findUploadOne(id);
  }
}
