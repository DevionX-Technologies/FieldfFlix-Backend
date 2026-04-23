/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Provider } from 'src/constant/enum';
import { IS_PUBLIC_KEY } from 'src/decorators/public.decorator';

/**
 * 
* @description This is a custom guard class that extends the AuthGuard class provided by the NestJS Passport library.*
* It is used for protecting routes that require authentication using JSON Web Tokens (JWT).
* It takes in a Reflector instance as a constructor parameter for accessing metadata.
* The canActivate() method is implemented to check if the route has been marked as public using the IS_PUBLIC_KEY metadata.
* If it has been marked as public, the method returns true without attempting to validate the JWT.
* If it has not been marked as public, the method calls the super class's canActivate() method to validate the JWT.
*  If an error occurs or the user object is null, the method throws an UnauthorizedException. Otherwise, it returns the authenticated user object.
@class JwtAuthGuard
@extends AuthGuard(Provider.Jwt)
*
*/
@Injectable()
export class JwtAuthGuard extends AuthGuard(Provider.Jwt) {
  constructor(private readonly reflector: Reflector) {
    super();
  }
  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest(err, user) {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }

    return user;
  }
}
