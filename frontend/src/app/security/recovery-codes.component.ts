import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-recovery-codes',
  standalone: true,
  imports: [MatButtonModule],
  template: `
    <h2>Save your recovery codes</h2>
    <p>Store these codes somewhere safe, such as your password manager. Each code can be used once to finish signing in if you lose access to your authenticator app.</p>
    <ul aria-label="Recovery codes">
      @for (code of codes; track code) { <li><code>{{ code }}</code></li> }
    </ul>
    <div class="actions">
      <button mat-button type="button" (click)="copy()">Copy codes</button>
      <button mat-button type="button" (click)="download()">Download codes</button>
      <button mat-flat-button type="button" (click)="done.emit()">I’ve saved my codes</button>
    </div>
    <p role="status">{{ notice }}</p>
  `,
  styles: [`ul { list-style: none; padding: 0; display: grid; gap: 6px; }
    code { user-select: all; } .actions { display: flex; flex-wrap: wrap; gap: 6px; }`]
})
export class RecoveryCodesComponent {
  @Input({ required: true }) codes!: string[];
  @Output() done = new EventEmitter<void>();
  notice = '';

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.codes.join('\n'));
      this.notice = 'Recovery codes copied.';
    } catch {
      this.notice = 'Could not copy the codes. Download them or copy them manually.';
    }
  }

  download(): void {
    const url = URL.createObjectURL(new Blob([this.codes.join('\n') + '\n'], { type: 'text/plain' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'epds-admin-recovery-codes.txt';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
