import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, distinctUntilChanged, finalize, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { MsalService } from '@azure/msal-angular';
import { loginRequest } from './msal.config';

export type TenantFeatureKey = 'mail' | 'domainHealth' | 'licenses' | 'effortTracking';

export type TenantFeatureAccess = {
  enabled: boolean;
  edit: boolean;
  delete: boolean;
};

export type TenantFeatures = Record<TenantFeatureKey, TenantFeatureAccess>;

export type AuthUser = {
  id?: string;
  userId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  tenantId?: string | null;
  tenantName?: string | null;
  tenantDisplayName?: string | null;
  tenantType?: string | null;
  tenantFeatures?: Partial<TenantFeatures>;
};

type SessionMeta = {
  sessionId?: string | null;
  accessExpiresAt?: string | null;
  refreshExpiresAt?: string | null;
  absoluteExpiresAt?: string | null;
  serverNow?: string | null;
};

type AuthResponse = {
  user: AuthUser | null;
  session?: SessionMeta | null;
};

const FEATURE_ROUTES: Record<TenantFeatureKey, string> = {
  mail: '/mail',
  domainHealth: '/domain-health',
  licenses: '/licenses',
  effortTracking: '/effort-tracking'
};

const FEATURE_ORDER: TenantFeatureKey[] = ['mail', 'domainHealth', 'licenses', 'effortTracking'];

@Injectable({ providedIn: 'root' })
export class AuthService {
  private baseUrl = `${environment.apiUrl}/api`;
  private currentUser: AuthUser | null = null;
  private refreshInFlight$: Observable<boolean> | null = null;
  private readonly redirectKey = 'epds-admin:returnUrl';

  private userSubject = new BehaviorSubject<AuthUser | null>(null);
  user$ = this.userSubject.asObservable().pipe(distinctUntilChanged());

  private isLoggedInSubject = new BehaviorSubject<boolean>(false);
  isLoggedIn$ = this.isLoggedInSubject.asObservable().pipe(distinctUntilChanged());

  private authReadySubject = new BehaviorSubject<boolean>(false);
  authReady$ = this.authReadySubject.asObservable().pipe(distinctUntilChanged());

  constructor(
    private http: HttpClient,
    private router: Router,
    private msalService: MsalService
  ) {
    this.checkSession().subscribe();
  }

  private applyUser(user: AuthUser | null): void {
    this.currentUser = user || null;
    this.userSubject.next(this.currentUser);
    this.isLoggedInSubject.next(Boolean(this.currentUser));
    this.authReadySubject.next(true);
  }

  checkSession(): Observable<boolean> {
    return this.http.get<AuthResponse>(`${this.baseUrl}/auth/me`, {
      withCredentials: true,
      headers: { 'X-No-Redirect-On-401': '1' }
    }).pipe(
      tap((res) => this.applyUser(res?.user || null)),
      map((res) => Boolean(res?.user)),
      catchError(() => this.refreshSession())
    );
  }

  refreshSession(): Observable<boolean> {
    if (this.refreshInFlight$) return this.refreshInFlight$;
    this.refreshInFlight$ = this.http.post<AuthResponse>(`${this.baseUrl}/renew-token`, {}, {
      withCredentials: true,
      headers: { 'X-No-Redirect-On-401': '1' }
    }).pipe(
      tap((res) => this.applyUser(res?.user || null)),
      map((res) => Boolean(res?.user)),
      catchError(() => {
        this.applyUser(null);
        return of(false);
      }),
      finalize(() => {
        this.refreshInFlight$ = null;
      }),
      shareReplay(1)
    );
    return this.refreshInFlight$;
  }

  async loginWithMicrosoft(): Promise<void> {
    const response = await this.msalService.loginPopup(loginRequest).toPromise();
    const microsoftToken = response?.idToken || response?.accessToken;
    if (!microsoftToken) throw new Error('Microsoft token was not returned');

    const authResponse = await this.http.post<AuthResponse>(
      `${this.baseUrl}/microsoft-login`,
      { accessToken: microsoftToken },
      { withCredentials: true }
    ).toPromise();

    this.applyUser(authResponse?.user || null);
    if (!authResponse?.user) throw new Error('Microsoft login did not return a user');
    this.navigatePostLogin();
  }

  loginWithPassword(email: string, password: string): Observable<AuthUser | null> {
    return this.http.post<AuthResponse>(
      `${this.baseUrl}/login`,
      { email, password },
      { withCredentials: true }
    ).pipe(
      tap((res) => this.applyUser(res?.user || null)),
      map((res) => {
        if (!res?.user) throw new Error('Login did not return a user');
        this.navigatePostLogin();
        return res.user;
      })
    );
  }

  logout(): void {
    this.http.post(`${this.baseUrl}/logout`, {}, { withCredentials: true }).subscribe({
      next: () => this.finishLogout(),
      error: () => this.finishLogout()
    });
  }

  private finishLogout(): void {
    this.applyUser(null);
    if (!this.msalService.instance.getAllAccounts().length) {
      this.router.navigate(['/login']);
      return;
    }
    this.msalService.logoutPopup().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => this.router.navigate(['/login'])
    });
  }

  setRedirectUrl(url: string): void {
    try { sessionStorage.setItem(this.redirectKey, url); } catch {}
  }

  private getRedirectUrl(): string | null {
    try { return sessionStorage.getItem(this.redirectKey); } catch { return null; }
  }

  private clearRedirectUrl(): void {
    try { sessionStorage.removeItem(this.redirectKey); } catch {}
  }

  navigatePostLogin(): void {
    const requestedTarget = this.getRedirectUrl() || '/home';
    const target = requestedTarget === '/home'
      ? this.defaultRouteAfterLogin()
      : requestedTarget;
    this.clearRedirectUrl();
    this.router.navigateByUrl(target);
  }

  getCurrentUser(): AuthUser | null {
    return this.currentUser;
  }

  isAuthenticated(): boolean {
    return Boolean(this.currentUser);
  }

  canAccessAdminFeatures(): boolean {
    return this.isSuperAdmin() || Boolean(this.currentUser?.tenantId || this.currentUser?.tenantName);
  }

  canAccessFeature(featureKey: TenantFeatureKey): boolean {
    if (this.isSuperAdmin()) return true;
    return Boolean(this.currentUser?.tenantFeatures?.[featureKey]?.enabled);
  }

  enabledFeatureKeys(): TenantFeatureKey[] {
    return FEATURE_ORDER.filter((featureKey) => this.canAccessFeature(featureKey));
  }

  hasSingleFeatureAccess(): boolean {
    return !this.isSuperAdmin() && this.enabledFeatureKeys().length === 1;
  }

  singleFeatureRoute(): string | null {
    if (!this.hasSingleFeatureAccess()) return null;
    return FEATURE_ROUTES[this.enabledFeatureKeys()[0]];
  }

  defaultRouteAfterLogin(): string {
    return this.singleFeatureRoute() || '/home';
  }

  canEditFeature(featureKey: TenantFeatureKey): boolean {
    if (this.isSuperAdmin()) return true;
    const feature = this.currentUser?.tenantFeatures?.[featureKey];
    return Boolean(feature?.enabled && feature?.edit);
  }

  canDeleteFeature(featureKey: TenantFeatureKey): boolean {
    if (this.isSuperAdmin()) return true;
    const feature = this.currentUser?.tenantFeatures?.[featureKey];
    return Boolean(feature?.enabled && feature?.delete);
  }

  isSuperAdmin(): boolean {
    return this.currentUser?.role === 'SuperAdmin';
  }

  hasEpdsEmail(): boolean {
    const email = String(this.currentUser?.email || '').trim().toLowerCase();
    return email.endsWith('@epds.hu');
  }

  getFullName(): string {
    const user = this.currentUser;
    return `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.email || '';
  }

  getLastName(): string {
    return this.currentUser?.lastName || '';
  }
}
