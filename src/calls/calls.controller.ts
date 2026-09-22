import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CallsService } from './calls.service';
import { InitiateMockCallDto } from './dto/initiate-mock-call.dto';
import { EndMockCallDto } from './dto/end-mock-call.dto';
import { CreateCallOutcomeDto } from './dto/create-call-outcome.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions/permissions.guard';
import type { AuthenticatedRequest } from 'src/auth/interfaces/authenticated-request.interface';

@Controller('calls')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get('queue')
  async getCallQueue(@Req() req: AuthenticatedRequest) {
    return this.callsService.getCallQueue(req.user.sub);
  }

  @Get('student-data/:id')
  async getAssignedStudentDataOne(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.callsService.getAssignedStudentDataOne(
      id,
      req.user.sub,
      req.user.roleId,
    );
  }

  @Post('initiate')
  async initiateMockCall(
    @Body() dto: InitiateMockCallDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.callsService.initiateMockCall(
      dto.studentDataId,
      req.user.sub,
      req.user.roleId,
    );
  }

  @Post('end')
  async endMockCall(
    @Body() dto: EndMockCallDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.callsService.endMockCall(dto.callId, req.user.sub);
  }

  @Get('status/:callId')
  async getMockCallStatus(@Param('callId') callId: string) {
    return this.callsService.getMockCallStatus(callId);
  }

  @Post('outcome')
  async createCallOutcome(
    @Body() dto: CreateCallOutcomeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.callsService.createCallOutcome(
      dto,
      req.user.sub,
      req.user.roleId,
    );
  }

  @Get('history/:studentDataId')
  async getCallHistory(
    @Param('studentDataId') studentDataId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.callsService.getCallHistory(
      studentDataId,
      req.user.sub,
      req.user.roleId,
    );
  }
}
