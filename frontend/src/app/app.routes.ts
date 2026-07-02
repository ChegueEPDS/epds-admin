import { Routes } from '@angular/router';
import { AuthGuard } from './guards/auth.guard';
import { LoginComponent } from './login/login.component';
import { HomeComponent } from './home/home.component';
import { MailboxComponent } from './mailbox/mailbox.component';
import { DomainHealthComponent } from './domain-health/domain-health.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'home', component: HomeComponent, canActivate: [AuthGuard] },
  { path: 'mail', component: MailboxComponent, canActivate: [AuthGuard], data: { requiresEpdsEmail: true } },
  { path: 'domain-health', component: DomainHealthComponent, canActivate: [AuthGuard] },
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: '**', redirectTo: 'home' }
];
