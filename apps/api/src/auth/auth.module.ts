import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Global()
@Module({
  // Secrets are passed per sign/verify call so the access and refresh keys stay
  // separate; the module itself holds no default secret.
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService],
  exports: [AuthService, PasswordService, TokenService],
})
export class AuthModule {}
