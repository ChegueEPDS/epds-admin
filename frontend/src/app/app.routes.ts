import { Routes } from '@angular/router';
import { AuthGuard } from './guards/auth.guard';
import { LoginComponent } from './login/login.component';
import { HomeComponent } from './home/home.component';
import { MailboxComponent } from './mailbox/mailbox.component';
import { DomainHealthComponent } from './domain-health/domain-health.component';
import { LicensesComponent } from './licenses/licenses.component';
import { EffortTrackingComponent } from './effort-tracking/effort-tracking.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'home', component: HomeComponent, canActivate: [AuthGuard] },
  { path: 'mail', component: MailboxComponent, canActivate: [AuthGuard], data: { requiresEpdsEmail: true } },
  { path: 'domain-health', component: DomainHealthComponent, canActivate: [AuthGuard] },
  { path: 'licenses', component: LicensesComponent, canActivate: [AuthGuard], data: { requiresAdminFeatures: true } },
  { path: 'effort-tracking', component: EffortTrackingComponent, canActivate: [AuthGuard], data: { requiresAdminFeatures: true, requiresEpdsEmail: true } },
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: '**', redirectTo: 'home' }
];
