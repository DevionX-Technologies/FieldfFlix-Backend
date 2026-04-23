import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Provider } from 'src/constant/enum';

@Injectable()
export class GoogleOauthGuard extends AuthGuard(Provider.Google) {
  constructor() {
    super({
      // accessType: 'offline',
      prompt: 'consent',
    });
  }
}
