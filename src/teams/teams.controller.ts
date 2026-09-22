import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { AssignTeamLeadDto } from './dto/assign-team-lead.dto';
import { AssignTeamLeadAdvisorDto } from './dto/assign-team-lead-advisor.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions/permissions.guard';
import { RequirePermission } from 'src/permissions/permissions.decorator';
import type { AuthenticatedRequest } from 'src/auth/interfaces/authenticated-request.interface';

@Controller('teams')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  @RequirePermission('TEAM_MANAGE')
  create(
    @Body() createTeamDto: CreateTeamDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.teamsService.create(createTeamDto, req.user);
  }

  @Patch(':id')
  @RequirePermission('TEAM_MANAGE')
  update(
    @Param('id') id: string,
    @Body() updateTeamDto: UpdateTeamDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.teamsService.update(id, updateTeamDto, req.user);
  }

  @Get()
  @RequirePermission('TEAM_MANAGE')
  findAll(@Req() req: AuthenticatedRequest) {
    return this.teamsService.findAll(req.user);
  }

  @Get('eligible-managers')
  @RequirePermission('TEAM_MANAGE')
  getEligibleManagers() {
    return this.teamsService.getEligibleManagers();
  }

  @Get('eligible-members')
  @RequirePermission('TEAM_MANAGE')
  getEligibleMembers() {
    return this.teamsService.getEligibleMembers();
  }

  @Get(':id')
  @RequirePermission('TEAM_MANAGE')
  findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.teamsService.findOneForManager(id, req.user);
  }

  @Get(':id/members')
  @RequirePermission('TEAM_MANAGE')
  getTeamMembers(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.teamsService.getTeamMembersForManager(id, req.user);
  }

  @Delete(':id')
  @RequirePermission('TEAM_MANAGE')
  remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.teamsService.remove(id, req.user);
  }

  // TEAM LEAD MANAGEMENT ENDPOINTS

  @Post(':id/team-leads')
  @RequirePermission('TEAM_MANAGE')
  assignTeamLead(
    @Param('id') id: string,
    @Body() dto: AssignTeamLeadDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.teamsService.assignTeamLead(id, dto.userId, req.user);
  }

  @Delete(':id/team-leads/:userId')
  @RequirePermission('TEAM_MANAGE')
  removeTeamLead(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.teamsService.removeTeamLead(id, userId, req.user);
  }

  @Get(':id/team-leads')
  @RequirePermission('TEAM_MANAGE')
  getTeamLeads(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.teamsService.getTeamLeads(id, req.user);
  }

  @Post(':id/team-leads/:teamLeadId/advisors')
  @RequirePermission('TEAM_MANAGE')
  assignAdvisorToTeamLead(
    @Param('id') id: string,
    @Param('teamLeadId') teamLeadId: string,
    @Body() dto: AssignTeamLeadAdvisorDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.teamsService.assignAdvisorToTeamLead(id, teamLeadId, dto.advisorId, req.user);
  }

  @Delete(':id/team-leads/:teamLeadId/advisors/:advisorId')
  @RequirePermission('TEAM_MANAGE')
  removeAdvisorFromTeamLead(
    @Param('id') id: string,
    @Param('teamLeadId') teamLeadId: string,
    @Param('advisorId') advisorId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.teamsService.removeAdvisorFromTeamLead(id, teamLeadId, advisorId, req.user);
  }

  @Get(':id/team-leads/:teamLeadId/advisors')
  @RequirePermission('TEAM_MANAGE')
  getTeamLeadAdvisors(
    @Param('id') id: string,
    @Param('teamLeadId') teamLeadId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.teamsService.getTeamLeadAdvisors(id, teamLeadId, req.user);
  }
}
