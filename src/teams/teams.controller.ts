import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
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
}


