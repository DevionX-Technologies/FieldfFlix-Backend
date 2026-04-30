import { Controller, Post, Body, UseGuards, Get, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from 'src/decorators/public.decorator';
import { Request } from 'express';
import { GoogleOauthGuard } from 'src/auth/guards/google-auth.guard';
import { AppleAuthCallbackDto, SendOtpDto, VerifyOtpDto } from './dto/auth.dto';
import { ApiBody, ApiTags } from '@nestjs/swagger';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('send-otp')
  async sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto.mobile);
  }

  @Public()
  @Post('account-exists')
  async accountExists(@Body() dto: SendOtpDto) {
    return this.authService.accountExistsByPhone(dto.mobile);
  }

  @Public()
  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.mobile, dto.otp);
  }

  @Get('/google')
  @Public()
  @UseGuards(GoogleOauthGuard)
  googleLogin(): void {
    // res.redirect("/google");
  }

  @UseGuards(GoogleOauthGuard)
  @Public()
  @Get('/google/callback')
  async googleAuthRedirect(@Req() req: Request): Promise<any> {
    return this.authService.googleCallback(req);
  }

  @Public()
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        idToken: {
          type: 'string',
        },
      },
    },
  })
  @Post('google/mobile-login')
  async webLoginSignup(@Body('idToken') idToken: string): Promise<{
    token: string;
    isFirstTimeLogin: boolean;
    name: string;
    email: string;
  }> {
    return this.authService.googleMobileLoginSignup(idToken);
  }

  @Public()
  @Post('apple/callback')
  async appleAuthRedirect(
    @Body() appleAuthCallbackDto: AppleAuthCallbackDto,
  ): Promise<any> {
    return this.authService.appleCallback(appleAuthCallbackDto);
  }
}
