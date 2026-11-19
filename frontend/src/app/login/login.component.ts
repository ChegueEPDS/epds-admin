import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, NgZone, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MfaApi, MfaChallenge, MfaSetup, mfaError } from '../security/mfa-api.service';
import { MfaSetupComponent } from '../security/mfa-setup.component';
import { RecoveryCodesComponent } from '../security/recovery-codes.component';
import { AuthResponse, AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSnackBarModule,
    MfaSetupComponent,
    RecoveryCodesComponent
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  readonly pandaButton = viewChild.required<ElementRef<HTMLButtonElement>>('panda');
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private pandaGreeting: Animation[] = [];
  private pandaGreetingStartsAt = -Infinity;

  animatePanda(delay = 0): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const button = this.pandaButton().nativeElement;
    const bounce = button.querySelector('.panda-bounce')!;
    const badge = button.querySelector('.panda-badge')!;
    this.pandaGreeting.forEach(animation => animation.cancel());
    this.pandaGreetingStartsAt = performance.now() + delay;
    this.pandaGreeting = [
      bounce.animate([
        { transform: 'scale(1) translateY(0)' },
        { transform: 'scale(0.95, 1.04) translateY(6px)', offset: 0.25 },
        { transform: 'scale(1.04, 0.97) translateY(-10px)', offset: 0.55 },
        { transform: 'scale(0.99, 1.01) translateY(2px)', offset: 0.8 },
        { transform: 'scale(1) translateY(0)' }
      ], { duration: 650, delay, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }),
      badge.animate([
        { filter: 'drop-shadow(0 0 0 transparent)' },
        { filter: 'drop-shadow(0 0 18px rgba(252, 176, 64, 0.85))', offset: 0.4 },
        { filter: 'drop-shadow(0 0 0 transparent)' }
      ], { duration: 700, delay, easing: 'ease-out' })
    ];
  }

  private startPandaMotion(): void {
    const rig = this.pandaButton().nativeElement.querySelector<HTMLElement>('.panda-art')!;
    const layers = Array.from(rig.querySelectorAll<HTMLElement>('.panda-layer'), element => ({
      element,
      depth: Number(element.dataset['depth']),
      parallax: Number(element.dataset['parallax'])
    }));
    const pupils = Array.from(rig.querySelectorAll('#pupilLeft, #pupilRight'));
    const eyelids = Array.from(rig.querySelectorAll('.eyelid'), element => ({
      element, x: element.getAttribute('cx'), y: element.getAttribute('cy')
    }));
    const ears = [rig.querySelector('#earLeft')!, rig.querySelector('#earRight')!];
    const earPoses = [
      { time: 0, angle: 0, scale: 1 },
      { time: 0.25, angle: 16, scale: 1.03 },
      { time: 0.55, angle: -7, scale: 1 },
      { time: 0.8, angle: 6, scale: 1 },
      { time: 1, angle: 0, scale: 1 }
    ];
    const shadow = rig.querySelector('#shadowGroup')!;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let previous = 0;
    let time = 0;
    let nextBlink = 2800 + Math.random() * 3400;
    let blinkAt = -Infinity;
    let doubleBlink = false;
    let nextWiggle = 4600 + Math.random() * 1900;
    let wiggleAt = -Infinity;
    let wiggleChoice = 0;
    let glanceDuration = 0;
    let glanceDirection = -1;
    let glance = 0;
    let eyeX = 0;
    let eyeY = 0;
    let rotationX = 0;
    let rotationY = 0;
    let floatY = 0;

    // Use elapsed time so the reference motion keeps the same pace on high-refresh displays.
    const animate = (now: number) => {
      const elapsed = previous ? Math.min(now - previous, 50) : 0;
      previous = now;
      time += elapsed;
      const phase = time * 0.0009;
      const smooth = 1 - Math.pow(0.95, elapsed / (1000 / 60));
      const eyeSmooth = 1 - Math.pow(0.93, elapsed / (1000 / 60));
      if (time >= nextBlink) {
        blinkAt = time;
        doubleBlink = Math.random() < 0.22;
        nextBlink += 2800 + Math.random() * 3400;
      }
      if (time >= nextWiggle) {
        wiggleAt = time;
        wiggleChoice = Math.random();
        glanceDirection *= -1;
        const interval = 4600 + Math.random() * 1900;
        glanceDuration = Math.min(2200, interval - 2600);
        nextWiggle += interval;
      }

      const sinceBlink = time - blinkAt;
      const blinkPhase = doubleBlink && sinceBlink >= 285 ? sinceBlink - 285 : sinceBlink;
      const lid = Math.max(0, Math.min(1, blinkPhase / 80, (205 - blinkPhase) / 80));
      for (const { element, x, y } of eyelids) {
        element.setAttribute('transform', `translate(${x} ${y}) scale(1 ${lid}) translate(-${x} -${y})`);
      }

      const sinceWiggle = time - wiggleAt;
      const sinceGreeting = now - this.pandaGreetingStartsAt;
      const greeting = sinceGreeting >= 0 && sinceGreeting < 650;
      const progress = greeting ? sinceGreeting / 650 : Math.min(1, sinceWiggle / 550);
      const poseIndex = earPoses.findIndex(pose => pose.time >= progress && pose.time > 0);
      const nextPose = earPoses[poseIndex];
      const previousPose = earPoses[poseIndex - 1];
      const fraction = (progress - previousPose.time) / (nextPose.time - previousPose.time);
      const eased = (1 - Math.cos(fraction * Math.PI)) / 2;
      const angle = previousPose.angle + (nextPose.angle - previousPose.angle) * eased;
      const scale = previousPose.scale + (nextPose.scale - previousPose.scale) * eased;
      ears.forEach((ear, index) => {
        const moves = greeting || (index === 0 ? wiggleChoice < 0.42 || wiggleChoice >= 0.84 : wiggleChoice >= 0.42);
        const x = index === 0 ? 124 : 276;
        const rotation = moves ? (index === 0 ? -angle : angle) : 0;
        ear.setAttribute('transform', `translate(${x} 104) rotate(${rotation}) scale(${moves ? scale : 1}) translate(-${x} -104)`);
      });

      const looking = sinceWiggle >= 1200 && sinceWiggle < 1200 + glanceDuration;
      glance += (Number(looking) - glance) * smooth;
      eyeX += ((looking ? 1.1 * glanceDirection : 0) - eyeX) * eyeSmooth;
      eyeY += ((looking ? 2.4 : 0) - eyeY) * eyeSmooth;
      rotationX += (Math.cos(phase * 0.5) * 2.6 - glance * 2.2 - rotationX) * smooth;
      rotationY += (Math.sin(phase * 0.7) * 5.4 + glance * 1.6 * glanceDirection - rotationY) * smooth;
      const targetFloatY = Math.sin(phase * 0.95) * 2.5;
      floatY += (targetFloatY - floatY) * smooth;

      pupils.forEach(pupil => pupil.setAttribute('transform', `translate(${eyeX} ${eyeY})`));
      shadow.setAttribute('transform', `translate(200 364) scale(${1 - targetFloatY / 35} 1) translate(-200 -364)`);
      rig.style.transform = `translateY(${floatY}px) rotateX(${rotationX}deg) rotateY(${rotationY}deg)`;
      for (const { element, depth, parallax } of layers) {
        element.style.transform = `translate3d(${rotationY * 0.72 * parallax}px, ${-rotationX * 0.72 * parallax}px, ${depth}px)`;
      }
      frame = requestAnimationFrame(animate);
    };

    const updateMotion = () => {
      cancelAnimationFrame(frame);
      previous = 0;
      if (reducedMotion.matches) {
        this.pandaGreeting.forEach(animation => animation.cancel());
        rig.style.removeProperty('transform');
        layers.forEach(({ element }) => element.style.removeProperty('transform'));
        [...pupils, ...ears, shadow, ...eyelids.map(({ element }) => element)]
          .forEach(element => element.removeAttribute('transform'));
        return;
      }
      frame = requestAnimationFrame(animate);
    };
    this.zone.runOutsideAngular(() => {
      reducedMotion.addEventListener('change', updateMotion);
      updateMotion();
      this.animatePanda(650);
    });
    this.destroyRef.onDestroy(() => {
      cancelAnimationFrame(frame);
      reducedMotion.removeEventListener('change', updateMotion);
      this.pandaGreeting.forEach(animation => animation.cancel());
    });
  }

  isLoading = signal(false);
  isShaking = signal(false);
  readonly passwordFormOpen = signal(false);
  verification?: MfaChallenge;
  verificationSetup?: MfaSetup;
  verificationMethod: 'passkey' | 'totp' | 'recovery' = 'totp';
  otherMethods = false;
  verificationCode = '';
  verificationError = '';
  completedEnrollment?: AuthResponse;
  email = '';
  password = '';
  newPassword = '';
  confirmPassword = '';
  resetFormOpen = false;
  notice = '';
  linkError = '';
  linkMethod: 'microsoft' | 'password' | null = null;
  linkPurpose: 'invite' | 'reset' | 'recovery' | null = null;
  private linkToken = '';
  private linkAccount = '';
  minimumPasswordLength = 8;
  private invitationEmail = '';
  private readonly api = environment.apiBaseUrl;

  constructor(
    private auth: AuthService,
    private mfa: MfaApi,
    private route: ActivatedRoute,
    private snackBar: MatSnackBar,
    private http: HttpClient,
    private router: Router
  ) {
    afterNextRender(() => this.startPandaMotion());
    this.route.fragment.subscribe((fragment) => {
      this.notice = '';
      this.linkError = '';
      this.linkMethod = null;
      this.minimumPasswordLength = 8;
      this.newPassword = '';
      this.confirmPassword = '';
      const link = new URLSearchParams(fragment || '');
      this.linkPurpose = link.has('invite') ? 'invite' : link.has('reset') ? 'reset' : link.has('recovery') ? 'recovery' : null;
      this.linkAccount = link.get('account') || '';
      this.linkToken = this.linkPurpose ? link.get(this.linkPurpose) || '' : '';
      if (this.linkPurpose === 'invite') this.loadInvitation();
      if (this.linkPurpose === 'reset' || this.linkPurpose === 'recovery') this.linkMethod = 'password';
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      if (!this.linkPurpose && returnUrl) this.auth.setRedirectUrl(returnUrl);
    });
  }

  async loginWithMicrosoft(): Promise<void> {
    if (this.isLoading()) return;
    this.isLoading.set(true);
    try {
      const invitation = this.linkPurpose === 'invite'
        ? { account: this.linkAccount, invite: this.linkToken, email: this.invitationEmail }
        : undefined;
      await this.auth.loginWithMicrosoft(invitation);
    } catch (error: any) {
      this.isShaking.set(true);
      setTimeout(() => this.isShaking.set(false), 700);
      this.snackBar.open(error?.error?.error || error?.message || 'Microsoft login failed.', 'Close', { duration: 4500 });
    } finally {
      this.isLoading.set(false);
    }
  }

  private loadInvitation(): void {
    const token = this.linkToken;
    this.http.post<{ loginMethod: 'microsoft' | 'password'; email: string; minimumPasswordLength?: number }>(
      `${this.api}/auth/invitation`, { account: this.linkAccount, token }
    ).subscribe({
      next: (result) => {
        if (token !== this.linkToken) return;
        this.linkMethod = result.loginMethod;
        this.invitationEmail = result.email;
        this.minimumPasswordLength = result.minimumPasswordLength ?? 8;
      },
      error: (error) => {
        if (token === this.linkToken) this.linkError = error?.error?.error || 'Unable to open the invitation.';
      }
    });
  }

  setPassword(): void {
    if (this.isLoading() || !this.linkPurpose) return;
    if (this.newPassword !== this.confirmPassword) {
      this.linkError = 'The passwords do not match.';
      return;
    }
    this.isLoading.set(true);
    this.linkError = '';
    this.http.post(`${this.api}/auth/set-password`, {
      account: this.linkAccount, token: this.linkToken, purpose: this.linkPurpose, password: this.newPassword
    }).subscribe({
      next: async () => {
        await this.router.navigate(['/login'], { replaceUrl: true });
        this.isLoading.set(false);
        this.passwordFormOpen.set(true);
        this.notice = 'Your password has been saved. You can now sign in.';
      },
      error: (error) => {
        this.isLoading.set(false);
        this.linkError = error?.error?.error || 'Unable to save the password.';
      }
    });
  }

  requestReset(): void {
    if (this.isLoading() || !this.email.trim()) return;
    this.isLoading.set(true);
    this.http.post(`${this.api}/auth/password-reset`, { email: this.email }).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.resetFormOpen = false;
        this.notice = 'If the account supports password sign-in, a reset link will be sent to its email address.';
      },
      error: () => {
        this.isLoading.set(false);
        this.snackBar.open('Unable to request a reset link. Please try again later.', 'Close', { duration: 4500 });
      }
    });
  }

  loginWithPassword(): void {
    if (this.isLoading() || !this.passwordFormOpen()) return;
    this.isLoading.set(true);
    this.auth.loginWithPassword(this.email, this.password).subscribe({
      next: (response) => {
        this.isLoading.set(false);
        this.password = '';
        if (!response.verification) {
          this.auth.completePasswordLogin(response);
          return;
        }
        this.verification = response.verification;
        this.verificationMethod = this.canUsePasskey ? 'passkey' : 'totp';
        if (response.verification.setup) void this.startEnrollment();
      },
      error: (error) => {
        this.isLoading.set(false);
        this.isShaking.set(true);
        setTimeout(() => this.isShaking.set(false), 700);
        this.snackBar.open(error?.error?.error || 'Login failed.', 'Close', { duration: 4500 });
      }
    });
  }

  get canUsePasskey(): boolean {
    return Boolean(this.verification?.passkey && window.isSecureContext && window.PublicKeyCredential);
  }

  private async runVerification(action: () => Promise<void>): Promise<void> {
    if (this.isLoading()) return;
    this.isLoading.set(true);
    this.verificationError = '';
    try {
      await action();
    } catch (error) {
      this.verificationError = mfaError(error, 'We could not complete verification. Please try again.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async startEnrollment(): Promise<void> {
    const flow = this.verification;
    if (!flow) return;
    await this.runVerification(async () => {
      this.verificationSetup = await this.mfa.post<MfaSetup>('login/setup', flow);
    });
  }

  async verify(): Promise<void> {
    const flow = this.verification;
    if (!flow) return;
    await this.runVerification(async () => {
      const method = this.verificationMethod;
      const response = method === 'passkey' && !flow.setup ? await this.mfa.authenticate(flow) : undefined;
      const result = await this.mfa.post<AuthResponse>(flow.setup ? 'login/confirm' : 'login/verify',
        { ...flow, method, response, code: this.verificationCode });
      this.verificationCode = '';
      this.verificationSetup = undefined;
      if (result.recoveryCodes?.length) this.completedEnrollment = result;
      else this.auth.completePasswordLogin(result);
    });
  }

  chooseMethod(method: 'passkey' | 'totp' | 'recovery'): void {
    this.verificationMethod = method;
    this.verificationCode = '';
    this.verificationError = '';
    this.otherMethods = false;
  }

  cancelVerification(): void {
    this.verification = undefined;
    this.verificationSetup = undefined;
    this.otherMethods = false;
    this.verificationCode = '';
    this.verificationError = '';
  }

  finishEnrollment(): void {
    if (this.completedEnrollment) this.auth.completePasswordLogin(this.completedEnrollment);
    this.completedEnrollment = undefined;
  }

}
