import { Module } from '@nestjs/common';
import { ValidationService } from './constants/services/validation.service';
import { CredentialService } from './constants/services/credential.service';
@Module({
  providers: [ValidationService, CredentialService],
  exports: [ValidationService, CredentialService],
})
export class CommonModule {}
