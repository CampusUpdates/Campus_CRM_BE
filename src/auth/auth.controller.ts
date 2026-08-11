import {
  Body,
  Controller,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PasswordChangeGuard } from './guards/password-change.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @UseGuards(PasswordChangeGuard)
  @Patch('change-password')
  changePassword(
    @Req() req: any,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      req.user.sub,
      changePasswordDto,
    );
  }
}