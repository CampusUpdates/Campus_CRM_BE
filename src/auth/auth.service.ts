
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/login.dto';
@Injectable()
export class AuthService {
 constructor (
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService){} 
 
//test method
 async generateToken(){
    const payload = {
    sub: 1,
    email: "name@gmail.com",
    name: "Name person"
 }
 return {
    access_token: await this.jwtService.signAsync(payload)
 }
 }
 //login

 async login(loginDto: LoginDto){
    const user = await this.prisma.user.findUnique({
        where:{
            email: loginDto.email,
        }
    })
    return user;
 }
}
