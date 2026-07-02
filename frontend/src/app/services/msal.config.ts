import { BrowserCacheLocation, Configuration, PublicClientApplication } from '@azure/msal-browser';
import { MSAL_INSTANCE, MsalService } from '@azure/msal-angular';
import { environment } from '../../environments/environment';

export const loginRequest = {
  scopes: ['openid', 'profile', 'email', 'User.Read']
};

export function MSALInstanceFactory(): PublicClientApplication {
  const config: Configuration = {
    auth: {
      clientId: environment.microsoftClientId,
      authority: `https://login.microsoftonline.com/${environment.microsoftTenantId}`,
      redirectUri: `${window.location.origin}/home`,
      postLogoutRedirectUri: window.location.origin
    },
    cache: {
      cacheLocation: BrowserCacheLocation.LocalStorage,
      storeAuthStateInCookie: true
    }
  };

  const instance = new PublicClientApplication(config);
  instance.initialize().catch((error) => console.error('MSAL initialization failed:', error));
  return instance;
}

export const provideMSAL = () => [
  { provide: MSAL_INSTANCE, useFactory: MSALInstanceFactory },
  MsalService
];
