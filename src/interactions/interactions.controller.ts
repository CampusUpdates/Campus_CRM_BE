import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InteractionsService } from './interactions.service';
import { CreateInteractionDto } from './dto/create-interaction.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from 'src/auth/interfaces/authenticated-request.interface';

@Controller('interactions')
export class InteractionsController {
  constructor(private readonly interactionsService: InteractionsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  createInteraction(
    @Body() dto: CreateInteractionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.interactionsService.createInteraction(dto, req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('lead/:leadId')
  getInteractionsForLead(@Param('leadId') leadId: string) {
    return this.interactionsService.getInteractionsForLead(leadId);
  }
}
