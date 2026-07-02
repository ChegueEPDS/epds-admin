import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Observable, combineLatest } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(private auth: AuthService, private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean | UrlTree> {
    return combineLatest([this.auth.authReady$, this.auth.isLoggedIn$]).pipe(
      filter(([ready]) => ready),
      take(1),
      map(([, loggedIn]) => {
        if (loggedIn) {
          if (route.data?.['requiresEpdsEmail'] && !this.auth.hasEpdsEmail()) {
            return this.router.createUrlTree(['/home']);
          }
          return true;
        }
        this.auth.setRedirectUrl(state.url);
        return this.router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
      })
    );
  }
}
