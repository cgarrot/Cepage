import { Global, Module } from '@nestjs/common';
import { JsonSchemaValidatorService } from './json-schema-validator.service';

@Global()
@Module({
  providers: [JsonSchemaValidatorService],
  exports: [JsonSchemaValidatorService],
})
export class ValidationModule {}
