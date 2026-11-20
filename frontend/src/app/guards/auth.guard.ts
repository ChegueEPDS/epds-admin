import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Observable, combineLatest, firstValueFrom } from 'rxjs';
import { filter, switchMap, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { AdminService } from '../services/admin.service';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(private auth: AuthService, private router: Router, private admin: AdminService) {}

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean | UrlTree> {
    return combineLatest([this.auth.authReady$, this.auth.isLoggedIn$]).pipe(
      filter(([ready]) => ready),
      take(1),
      switchMap(async ([, loggedIn]) => {
        if (loggedIn) {
          if (route.data?.['openWorkLink']) return this.openWork(route);
          if (route.routeConfig?.path === 'home') {
            const singleFeatureRoute = this.auth.singleFeatureRoute();
            if (singleFeatureRoute) return this.router.createUrlTree([singleFeatureRoute]);
          }
          if (route.data?.['requiresFinanceWorkspace'] && !this.auth.isFinanceWorkspace()) {
            return this.router.createUrlTree(['/home']);
          }
          if (route.data?.['requiresAdminFeatures'] && !this.auth.canAccessAdminFeatures()) {
            return this.router.createUrlTree(['/home']);
          }
          if (route.data?.['requiresUserManager'] && !this.auth.canManageUsers()) {
            return this.router.createUrlTree(['/home']);
          }
          if (route.data?.['requiresSuperAdmin'] && !this.auth.isSuperAdmin()) {
            return this.router.createUrlTree(['/home']);
          }
          if (route.data?.['requiresWorkFieldAdmin'] && !this.auth.canManageWorkFields() &&
              !(this.auth.isSuperAdmin() && !this.auth.getTenantContext() && this.auth.getTenantContextId())) {
            return this.router.createUrlTree(['/home']);
          }
          const featureKey = route.data?.['featureKey'];
          if (featureKey && !this.auth.canAccessFeature(featureKey)) {
            return this.router.createUrlTree(['/home']);
          }
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
  private async openWork(route: ActivatedRouteSnapshot): Promise<UrlTree> {
    const tenantId = route.paramMap.get('tenantId');
    const work = route.queryParamMap.get('work');
    if (!tenantId || !work) return this.router.createUrlTree(['/home']);
    const queryParams = { work };
    if (this.auth.isFinanceWorkspace()) {
      return this.router.createUrlTree(['/project-tracker', 'finance', tenantId], { queryParams });
    }

    const user = this.auth.getCurrentUser();
    const activeTenant = this.auth.getTenantContext()?.id ?? user?.tenantId;
    if (tenantId !== activeTenant || (this.auth.isSuperAdmin() && !this.auth.getTenantContext())) {
      const tenants = this.auth.isSuperAdmin()
        ? await firstValueFrom(this.admin.listTenants()).catch(() => [])
        : user?.tenantOptions ?? [];
      const tenant = tenants.find(({ id }) => id === tenantId);
      if (!tenant?.features.workBoard?.enabled) return this.router.createUrlTree(['/home']);
      this.auth.setTenantContext(tenant);
      if (!this.auth.isSuperAdmin() && !await firstValueFrom(this.auth.checkSession())) {
        return this.router.createUrlTree(['/login']);
      }
    }
    return this.router.createUrlTree(['/project-tracker'], { queryParams });
  }

}
