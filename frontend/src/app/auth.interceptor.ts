import { inject, Injector } from '@angular/core';
import { HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { environment } from '../environments/environment';
import { AuthService } from './services/auth.service';

function isBackendUrl(req: HttpRequest<unknown>): boolean {
  try {
    const api = new URL(environment.apiBaseUrl, window.location.origin);
    const url = new URL(req.url, window.location.origin);
    return url.origin === api.origin;
  } catch {
    return req.url.startsWith('/api/') || req.url.startsWith(environment.apiBaseUrl);
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const injector = inject(Injector);

  if (isBackendUrl(req)) {
    const csrf = document.cookie
      .split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith('csrf_token='))
      ?.slice('csrf_token='.length);

    const setHeaders: Record<string, string> = {};
    if (csrf && !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
      setHeaders['X-CSRF-Token'] = decodeURIComponent(csrf);
    }

    req = req.clone({ setHeaders, withCredentials: true });
  }

  return next(req).pipe(
    catchError((error) => {
      if (error?.status !== 401) return throwError(() => error);
      if (req.url.endsWith('/api/renew-token') || req.headers.has('X-No-Redirect-On-401')) {
        return throwError(() => error);
      }
      const auth = injector.get(AuthService);
      return auth.refreshSession().pipe(
        switchMap((ok) => {
          if (ok) return next(req);
          router.navigate(['/login']);
          return throwError(() => error);
        })
      );
    })
  );
};
