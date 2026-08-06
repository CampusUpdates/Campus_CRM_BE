import { Controller } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Get, Body, Post } from '@nestjs/common';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService){}

    @Get('token')
    generateToken(){
        return this.authService.generateToken();
    }

    @Post('login')
    login(@Body() loginDto: LoginDto){
        return this.authService.login(loginDto)
    }
}
