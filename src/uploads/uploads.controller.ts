import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Delete,
} from '@nestjs/common';
import type { Response } from 'express';
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
    @Body('categoryId') categoryId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.processFileUpload(file, req.user.sub, categoryId);
  }

  @Get('categories')
  async getCategories(@Req() req: AuthenticatedRequest) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.getCategories();
  }

  @Post('categories')
  async createCategory(
    @Body('name') name: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.createCategory(name);
  }

  @Post(':id/confirm-import')
  async confirmImport(
    @Param('id') id: string,
    @Body() confirmDto: { actions: Record<string, string> },
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.confirmImport(id, confirmDto.actions, req.user.sub);
  }

  @Post(':id/cancel-import')
  async cancelImport(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.cancelImport(id, req.user.sub);
  }

  @Delete(':id/soft')
  async softDeleteUpload(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.softDeleteUpload(id);
  }

  @Get(':id/hard-delete-preview')
  async previewHardDelete(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.previewHardDelete(id);
  }

  @Delete(':id/hard')
  async hardDeleteUploadRecords(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.hardDeleteUploadRecords(id, req.user.sub);
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

  @Get('data-assignments/assignee/:assigneeId')
  async findAssigneeAssignmentsDetail(
    @Param('assigneeId') assigneeId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.findAssigneeAssignmentsDetail(assigneeId);
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

  @Post('reclaim-assignment/:assignmentId')
  async reclaimAssignmentById(
    @Param('assignmentId') assignmentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.reclaimAssignmentById(
      assignmentId,
      req.user.sub,
      req.user.roleId,
    );
  }

  @Get(':id/callers')
  async getDatasetCallers(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.getDatasetCallers(id);
  }

  @Get(':id/export-response')
  async exportDatasetResponseHistory(
    @Param('id') id: string,
    @Query('disposition') disposition: string | undefined,
    @Query('calledById') calledById: string | undefined,
    @Query('time') time: string | undefined,
    @Query('fromDate') fromDate: string | undefined,
    @Query('toDate') toDate: string | undefined,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.exportDatasetResponseHistory(
      id,
      res,
      disposition,
      calledById,
      time,
      fromDate,
      toDate,
    );
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.assertAdminOrManager(req.user.sub, req.user.roleId);
    return this.uploadsService.findUploadOne(id);
  }
}
