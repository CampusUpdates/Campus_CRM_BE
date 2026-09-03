import { Module } from '@nestjs/common';
import { TpcController } from './tpc.controller';
import { TpcService } from './tpc.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TpcController],
  providers: [TpcService],
  exports: [TpcService],
})
export class TpcModule {}
