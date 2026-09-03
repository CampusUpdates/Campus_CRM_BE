import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ValidationService } from './constants/services/validation.service';
import { CredentialService } from './constants/services/credential.service';
import { UserContextService } from './services/user-context.service';
import { UserContextInterceptor } from './interceptors/user-context.interceptor';

@Global()
@Module({
  providers: [
    ValidationService,
    CredentialService,
    UserContextService,
    {
      provide: APP_INTERCEPTOR,
      useClass: UserContextInterceptor,
    },
  ],
  exports: [ValidationService, CredentialService, UserContextService],
})
export class CommonModule {}
