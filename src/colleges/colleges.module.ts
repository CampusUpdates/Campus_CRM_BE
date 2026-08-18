import { Module } from '@nestjs/common';
import { CollegesController } from './colleges.controller';
import { CollegesService } from './colleges.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CollegesController],
  providers: [CollegesService],
  exports: [CollegesService],
})
export class CollegesModule {}
