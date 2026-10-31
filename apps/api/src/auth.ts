import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { HttpError } from './db.js';
export interface AuthConfig {issuer:string; audience:string; jwksUrl:string}
export function verifier(config:AuthConfig, keys?:JWTVerifyGetKey) {
  const resolver=keys??createRemoteJWKSet(new URL(config.jwksUrl));
  return async (header:string|undefined) => {
    if(!header?.startsWith('Bearer ')) throw new HttpError(401,'TOKEN_REQUIRED');
    let payload;
    try { ({payload}=await jwtVerify(header.slice(7),resolver,{issuer:config.issuer,audience:config.audience,algorithms:['RS256'],requiredClaims:['sub','exp','iat']})); }
    catch { throw new HttpError(401,'INVALID_TOKEN'); }
    const roles=(payload.realm_access as {roles?:unknown})?.roles;
    if(!Array.isArray(roles)||!roles.includes('tp-approval-user')) throw new HttpError(403,'ACCESS_ROLE_REQUIRED');
    return {issuer:payload.iss!,subject:payload.sub!};
  };
}
