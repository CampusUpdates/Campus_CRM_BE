import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
  Param,
  Patch,
  Get,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { UpdateLeadPipelineDto } from './dto/update-lead-pipeline.dto';
import { ApprovePitchDto } from './dto/approve-pitch.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions/permissions.guard';
import { RequirePermission } from 'src/permissions/permissions.decorator';
import type { AuthenticatedRequest } from 'src/auth/interfaces/authenticated-request.interface';

import { AssignLeadDto } from './dto/assign-lead.dto';
import { BulkAssignLeadDto } from './dto/bulk-assign-lead.dto';
import { ProcessClaimRequestDto } from './dto/process-claim-request.dto';
import { QueryClaimRequestDto } from './dto/query-claim-request.dto';
import { CollegeStatus } from '@prisma/client';

import { LeadReallocationService } from './lead-reallocation.service';
import { ReallocationQueryDto } from './dto/reallocation-query.dto';
import { ReallocateLeadDto } from './dto/reallocate-lead.dto';
import { BulkReallocateLeadsDto } from './dto/bulk-reallocate-leads.dto';

@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly leadReallocationService: LeadReallocationService,
  ) { }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('LEAD_CREATE')
  @Post()
  create(
    @Body() createLeadDto: CreateLeadDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leadsService.create(createLeadDto, req.user.sub);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('LEAD_VIEW')
  @Get()
  findAll(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query('statusGroup') statusGroup?: string,
    @Query('search') search?: string,
    @Query('time') time?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('colleges') colleges?: string | string[],
    @Query('ownerId') ownerId?: string,
    @Query('assignedToId') assignedToId?: string,
  ) {
    const scope = req.userPermissions?.['LEAD_VIEW'] || 'OWN';
    const effectiveOwnerId = ownerId || assignedToId;
    return this.leadsService.findAll(
      req.user,
      { status, statusGroup, search, time, fromDate, toDate, page, limit, colleges, ownerId: effectiveOwnerId },
      scope,
    );
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('LEAD_VIEW')
  @Get('export')
  async exportExcel(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Query('status') status?: string,
    @Query('statusGroup') statusGroup?: string,
    @Query('search') search?: string,
    @Query('time') time?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('colleges') colleges?: string | string[],
    @Query('ownerId') ownerId?: string,
    @Query('assignedToId') assignedToId?: string,
  ) {
    const scope = req.userPermissions?.['LEAD_VIEW'] || 'OWN';
    const effectiveOwnerId = ownerId || assignedToId;
    const buffer = await this.leadsService.exportExcel(
      req.user,
      { status, statusGroup, search, time, fromDate, toDate, colleges, ownerId: effectiveOwnerId },
      scope,
    );

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename=leads_export.xlsx',
      'Content-Length': buffer.length,
    });

    res.end(buffer);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('LEAD_VIEW')
  @Get('assignable-count')
  getAssignableLeadsCount(@Req() req: AuthenticatedRequest) {
    return this.leadsService.getAssignableLeadsCount(req.user);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('LEAD_SEARCH')
  @Get('search')
  searchByPhone(
    @Query('phone') phone: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leadsService.searchByPhone(phone, req.user);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('LEAD_ASSIGN')
  @Post('bulk-assign')
  assignBulkLeads(
    @Body() bulkAssignDto: BulkAssignLeadDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leadsService.assignBulkLeads(bulkAssignDto, req.user);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('COLLEGE_LEAD_APPROVE')
  @Get('pitches/approvals')
  getPitchApprovals(
    @Query('status') status: CollegeStatus,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = req.userPermissions?.['COLLEGE_LEAD_APPROVE'] || 'TEAM';
    return this.leadsService.getPitchApprovals(req.user, scope, status);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('COLLEGE_LEAD_APPROVE')
  @Patch('pitches/:id/approval')
  processPitchApproval(
    @Param('id') pitchId: string,
    @Body() approvePitchDto: ApprovePitchDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = req.userPermissions?.['COLLEGE_LEAD_APPROVE'] || 'TEAM';
    return this.leadsService.processPitchApproval(
      pitchId,
      approvePitchDto.status,
      req.user,
      scope,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('claim-requests')
  getClaimRequests(
    @Query() query: QueryClaimRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leadsService.getClaimRequests(req.user.sub, query);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('claim-requests/:requestId')
  processClaimRequest(
    @Param('requestId') requestId: string,
    @Body() dto: ProcessClaimRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leadsService.processClaimRequest(requestId, req.user.sub, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('DATA_MANAGEMENT_VIEW')
  @Get('reallocation')
  getLeadsForReallocation(@Query() query: ReallocationQueryDto) {
    return this.leadReallocationService.getLeadsForReallocation(query);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('DATA_MANAGEMENT_ASSIGN')
  @Post(':id/reallocate')
  reallocateLead(
    @Param('id') id: string,
    @Body() dto: ReallocateLeadDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leadsService.assignLead(id, dto.targetUserId, req.user);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('DATA_MANAGEMENT_ASSIGN')
  @Post('bulk-reallocate')
  bulkReallocateLeads(
    @Body() dto: BulkReallocateLeadsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leadsService.bulkReallocateLeads(dto, req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/profile')
  getLead360Profile(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.leadsService.getLead360Profile(id, req.user.sub);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('LEAD_VIEW')
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const scope = req.userPermissions?.['LEAD_VIEW'] || 'OWN';
    return this.leadsService.findOne(id, req.user, scope);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('LEAD_UPDATE')
  @Patch(':id/pipeline')
  updatePipeline(
    @Param('id') id: string,
    @Body() updateLeadPipelineDto: UpdateLeadPipelineDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = req.userPermissions?.['LEAD_UPDATE'] || 'OWN';
    return this.leadsService.updatePipeline(
      id,
      updateLeadPipelineDto,
      req.user,
      scope,
    );
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('LEAD_UPDATE')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateLeadDto: UpdateLeadDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = req.userPermissions?.['LEAD_UPDATE'] || 'OWN';
    return this.leadsService.update(id, updateLeadDto, req.user, scope);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('LEAD_CLAIM')
  @Post(':id/claim')
  claim(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.leadsService.claim(id, req.user.sub);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('LEAD_CLAIM')
  @Post(':id/claim-request')
  createClaimRequest(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leadsService.createClaimRequest(id, req.user.sub);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('LEAD_ASSIGN')
  @Post(':id/assign')
  assignLead(
    @Param('id') id: string,
    @Body() assignLeadDto: AssignLeadDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leadsService.assignLead(
      id,
      assignLeadDto.targetUserId,
      req.user,
    );
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('LEAD_VIEW')
  @Get(':id/shares')
  getLeadShares(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leadsService.getLeadShares(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('LEAD_VIEW')
  @Post(':id/acknowledge')
  acknowledgeLead(
    @Param('id') id: string,
    @Body() body: { shareId?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leadsService.acknowledgeLead(id, req.user.sub, body?.shareId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('LEAD_VIEW')
  @Post(':id/share')
  shareLead(
    @Param('id') id: string,
    @Body() body: { channel?: string; context?: string; recipientId?: string; collegeId?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leadsService.shareLead(
      id,
      req.user.sub,
      body?.channel,
      body?.context,
      body?.recipientId,
      body?.collegeId,
    );
  }
}
