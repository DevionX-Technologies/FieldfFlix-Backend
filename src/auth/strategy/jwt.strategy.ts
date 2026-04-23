import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { Provider } from '../../constant/enum';
import { STATUS_MSG } from '../../constant/status-message.constants';
import { UserService } from '../../user/user.service';
export interface ILocalLoginPayload {
  email?: string;
  user_id?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, Provider.Jwt) {
  constructor(private readonly userService: UserService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  /**
   *
   * @param {ILocalLoginPayload} payload - The authentication token payload to be validated.
   * @returns {Promise<ILocalLoginPayload>} - Returns a promise that resolves to the validated payload object.
   * @throws {UnauthorizedException} - Throws an UnauthorizedException if no user is found with the provided userId.
   *
   */
  async validate(payload: ILocalLoginPayload): Promise<ILocalLoginPayload> {
    // This if statement checks if the userID property is missing or falsy in the payload object.
    if (!payload.user_id) {
      throw new UnauthorizedException(STATUS_MSG.ERROR.INVALID_USER);
    }
    const user = await this.userService.findOne(payload.user_id);
    if (!user) {
      throw new UnauthorizedException(STATUS_MSG.ERROR.INVALID_USER);
    }

    return payload;
  }
}
