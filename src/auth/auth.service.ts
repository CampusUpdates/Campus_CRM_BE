import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import * as argon2 from 'argon2'
import { LoginDto } from './dto/login.dto';
import { JwtService} from '@nestjs/jwt'
import { ChangePasswordDto } from './dto/change-password.dto';
import { ERROR_MESSAGES } from 'src/common/constants/error-message';
@Injectable()
export class AuthService {
 constructor (
  private readonly prisma: PrismaService,
  private readonly jwtService : JwtService){} 
 //login
async login(loginDto: LoginDto) {
  console.log(loginDto)
  const user = await this.prisma.user.findUnique({
    where: {
      username: loginDto.username,
    },
  });

  if (!user) {
    throw new UnauthorizedException('Invalid credentials');
  }

  const isPasswordValid = await argon2.verify(
    user.passwordHash,
    loginDto.password,
  );

  if (!isPasswordValid) {
    throw new UnauthorizedException('Invalid credentials');
  }

  //check if a user is active
  if (user.status !== 'ACTIVE') {
    throw new UnauthorizedException('User account is inactive');
  }

  if (user.mustChangePassword) {
  const payload = {
    sub: user.id,
    type: 'password-change',
  };

  const passwordChangeToken = await this.jwtService.signAsync(
    payload,
    {
      expiresIn: '10m',
    },
  );

  return {
    requiresPasswordChange: true,
    passwordChangeToken,
  };
}
  const payload = {
    sub: user.id,
    username: user.username,
    roleId: user.roleId,
    teamId: user.teamId,
    type:"access"
  }
  const access_token = await this.jwtService.signAsync(payload);
  return {
    message: 'Login successful',
    access_token
  };
}

async changePassword(userId: string, changePasswordDto: ChangePasswordDto ){
  const user = await this.prisma.user.findUnique({
    where: {
      id: userId,
    }
  })
  if(!user){
      throw new UnauthorizedException(ERROR_MESSAGES.INVALID_CREDENTIALS)
  }
  const isPasswordValid = await argon2.verify(
    user.passwordHash,
    changePasswordDto.oldPassword,
  );
 if (!isPasswordValid) {
    throw new UnauthorizedException(ERROR_MESSAGES.INVALID_CREDENTIALS);
  }

  //create newPassword hash
  const newPasswordHash = await argon2.hash(changePasswordDto.newPassword);
  //update user 
   await this.prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      passwordHash: newPasswordHash,
      mustChangePassword: false,
    },
  });

  return {
    message: 'Password changed successfully',
  };
}
}
