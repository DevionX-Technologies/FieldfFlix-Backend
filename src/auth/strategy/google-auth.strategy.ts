import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Provider } from 'src/constant/enum';

@Injectable()
export class GoogleStrategy extends PassportStrategy(
  Strategy,
  Provider.Google,
) {
  constructor() {
    super({
      // Put config in `.env`
      clientID: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_SECRET,
      callbackURL: process.env.GOOGLE_OAUTH_REDIRECT_URL,
      scope: [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/plus.login',
        'profile',
      ],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    try {
      const { id, name, emails, photos } = profile;
      if (!emails[0].verified) {
        throw new UnauthorizedException(
          `Email ${emails[0].value} is not verified`,
        );
      }
      const providerUser = {
        provider: Provider.Google,
        email: emails[0].value,
        name: name.givenName,
        lastName: name.familyName,
        providerId: id,
        profile: profile,
        picture: photos[0].value,
        accessToken,
        refreshToken,
      };

      done(null, providerUser);
    } catch (error) {
      // If an error occurs during validation, signal failure by calling done with the error
      done(error as Error, null);
    }
  }
}
