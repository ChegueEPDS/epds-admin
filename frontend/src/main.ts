import { registerLocaleData } from '@angular/common';
import localeEnGb from '@angular/common/locales/en-GB';
import localeHu from '@angular/common/locales/hu';
import { inject, provideAppInitializer } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideNativeDateAdapter } from '@angular/material/core';
import { UiLanguageService } from './app/i18n/ui-language.service';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { authInterceptor } from './app/auth.interceptor';
import { provideMSAL } from './app/services/msal.config';

registerLocaleData(localeEnGb);
registerLocaleData(localeHu);

bootstrapApplication(AppComponent, {
  providers: [
    provideAppInitializer(() => inject(UiLanguageService).initialize()),
    provideAnimations(),
    provideNativeDateAdapter(),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideRouter(routes),
    ...provideMSAL()
  ]
}).catch((err) => console.error(err));
