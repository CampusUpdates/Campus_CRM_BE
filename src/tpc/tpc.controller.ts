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
import { TpcService } from './tpc.service';
import { AssignTpcDto } from './dto/assign-tpc.dto';
import { UpdateTpcStatusDto } from './dto/update-tpc-status.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from 'src/auth/interfaces/authenticated-request.interface';

@Controller('tpc')
export class TpcController {
  constructor(private readonly tpcService: TpcService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  getAllTpcs(@Req() req: AuthenticatedRequest) {
    return this.tpcService.getAllTpcs(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('users')
  getEligibleUsers() {
    return this.tpcService.getSelectableUsers();
  }

  @UseGuards(JwtAuthGuard)
  @Get('my')
  getMyTpcs(@Req() req: AuthenticatedRequest) {
    return this.tpcService.getMyTpcs(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('assigned')
  getAssignedTpcs(@Req() req: AuthenticatedRequest) {
    return this.tpcService.getAssignedTpcs(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('assign')
  assignTpc(
    @Body() assignTpcDto: AssignTpcDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tpcService.assignTpc(assignTpcDto, req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('lead/:leadId')
  getTpcsForLead(@Param('leadId') leadId: string) {
    return this.tpcService.getTpcsForLead(leadId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('assignment/:assignmentId/status')
  updateAssignmentStatus(
    @Param('assignmentId') assignmentId: string,
    @Body() updateDto: UpdateTpcStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tpcService.updateAssignmentStatus(
      assignmentId,
      updateDto,
      req.user.sub,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Delete('assignment/:assignmentId')
  removeAssignment(@Param('assignmentId') assignmentId: string) {
    return this.tpcService.removeAssignment(assignmentId);
  }
}
