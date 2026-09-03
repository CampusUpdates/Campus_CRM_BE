import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { MockTelephonyProvider } from './providers/mock-telephony.provider';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],

  controllers: [CallsController],
  providers: [
    CallsService,
    {
      provide: 'TelephonyProvider',
      useClass: MockTelephonyProvider,
    },
  ],
  exports: [CallsService],
})
export class CallsModule {}
