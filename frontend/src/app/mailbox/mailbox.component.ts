import { CommonModule } from '@angular/common';
import { Component, OnInit, TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MailApiService } from '../services/mail-api.service';
import { RichTextEditorComponent } from '../shared/rich-text-editor/rich-text-editor.component';
import { AuthService } from '../services/auth.service';

type MailFolder = 'inbox' | 'sentitems';

type MailAddress = {
  emailAddress?: {
    address?: string;
    name?: string;
  };
};

type MailItem = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  from?: MailAddress | null;
  sender?: MailAddress | null;
  toRecipients?: MailAddress[];
  ccRecipients?: MailAddress[];
  bccRecipients?: MailAddress[];
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  importance?: string;
  hasAttachments?: boolean;
  body?: { contentType?: string; content?: string } | null;
};

const MAILBOX_PAGE_SIZE = 40;

@Component({
  selector: 'app-mailbox',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTabsModule,
    MatTooltipModule,
    RichTextEditorComponent
  ],
  templateUrl: './mailbox.component.html',
  styleUrl: './mailbox.component.scss'
})
export class MailboxComponent implements OnInit {
  mailbox: string | null = null;
  folder: MailFolder = 'inbox';
  items: MailItem[] = [];
  selected: MailItem | null = null;
  searchTerm = '';
  hasMore = false;
  isLoading = false;
  isLoadingMore = false;
  isDetailLoading = false;
  isSending = false;
  forwarding: MailItem | null = null;
  forwardTo = '';
  forwardComment = '';
  private nextOlderDate: string | null = null;
  private listRequest = 0;
  private detailRequest = 0;
  private composeDialog?: MatDialogRef<unknown>;

  compose = {
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    html: ''
  };
  constructor(
    private mailApi: MailApiService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    public auth: AuthService
  ) {}

  ngOnInit(): void {
    void this.reload();
  }

  async reload(folder: MailFolder = this.folder): Promise<void> {
    const request = ++this.listRequest;
    this.detailRequest++;
    this.folder = folder;
    this.isLoading = true;
    this.isLoadingMore = false;
    this.isDetailLoading = false;
    this.selected = null;
    this.hasMore = false;
    this.nextOlderDate = null;
    try {
      const resp = await firstValueFrom(this.mailApi.listMailbox(folder, MAILBOX_PAGE_SIZE + 1));
      if (request !== this.listRequest) return;
      this.mailbox = resp?.mailbox || null;
      const items = resp.items as MailItem[];
      this.items = items.slice(0, MAILBOX_PAGE_SIZE);
      const nextItem = items[MAILBOX_PAGE_SIZE];
      this.nextOlderDate = nextItem ? this.messageDate(nextItem) || null : null;
      this.hasMore = Boolean(this.nextOlderDate) || resp.hasMore;
    } catch (e: any) {
      if (request !== this.listRequest) return;
      this.items = [];
      this.snackBar.open(e?.error?.detail || e?.error?.error || 'Failed to load mailbox.', 'Close', { duration: 4500 });
    } finally {
      if (request === this.listRequest) this.isLoading = false;
    }
  }

  get filteredItems(): MailItem[] {
    const query = this.searchTerm.trim().toLowerCase();
    if (!query) return this.items;
    return this.items.filter((item) => this.messageSearchText(item).includes(query));
  }

  clearSearch(): void {
    this.searchTerm = '';
  }

  async loadMore(days = 1): Promise<void> {
    if (this.isLoading || this.isLoadingMore || !this.hasMore) return;
    const lastItem = this.items.at(-1);
    const anchor = this.nextOlderDate || (lastItem && this.messageDate(lastItem));
    if (!anchor) return;
    const request = this.listRequest;
    const folder = this.folder;
    this.isLoadingMore = true;
    try {
      const existingIds = new Set(this.items.map((item) => item.id));
      let page = await this.loadDays(folder, anchor, days);
      if (request !== this.listRequest) return;
      // The first page may already contain the entire oldest visible day.
      if (!this.nextOlderDate && days === 1 && page.nextOlderDate &&
          (page.items as MailItem[]).every((item) => existingIds.has(item.id))) {
        page = await this.loadDays(folder, page.nextOlderDate, days);
        if (request !== this.listRequest) return;
      }
      const olderItems = (page.items as MailItem[]).filter((item) => {
        if (existingIds.has(item.id)) return false;
        existingIds.add(item.id);
        return true;
      });
      this.items = [...this.items, ...olderItems].sort(
        (a, b) => Date.parse(this.messageDate(b) || '') - Date.parse(this.messageDate(a) || '')
      );
      this.mailbox = page.mailbox || this.mailbox;
      this.nextOlderDate = page.nextOlderDate || null;
      this.hasMore = page.hasMore;
    } catch (e: any) {
      if (request !== this.listRequest) return;
      this.snackBar.open(e?.error?.detail || e?.error?.error || 'Failed to load more messages.', 'Close', { duration: 4500 });
    } finally {
      if (request === this.listRequest) this.isLoadingMore = false;
    }
  }

  private loadDays(folder: MailFolder, anchor: string, days: number) {
    const since = new Date(anchor);
    since.setHours(0, 0, 0, 0);
    const before = new Date(since);
    before.setDate(before.getDate() + 1);
    since.setDate(since.getDate() - (days - 1));
    return firstValueFrom(this.mailApi.listMailboxRange(folder, since.toISOString(), before.toISOString()));
  }

  async openMessage(item: MailItem): Promise<void> {
    if (!item?.id) return;
    const request = ++this.detailRequest;
    this.isDetailLoading = true;
    try {
      const resp = await firstValueFrom(this.mailApi.getMailboxMessage(item.id));
      if (request !== this.detailRequest) return;
      this.selected = (resp?.item as MailItem) || item;
    } catch (e: any) {
      if (request !== this.detailRequest) return;
      this.snackBar.open(e?.error?.detail || e?.error?.error || 'Failed to load message.', 'Close', { duration: 4500 });
    } finally {
      if (request === this.detailRequest) this.isDetailLoading = false;
    }
  }

  openComposer(template: TemplateRef<unknown>, message: MailItem | null = null): void {
    if (this.composeDialog || !this.auth.canEditFeature('mail')) return;
    this.forwarding = message;
    this.forwardTo = '';
    this.forwardComment = '';
    this.composeDialog = this.dialog.open(template, {
      width: '95vw',
      height: '95dvh',
      maxWidth: '95vw',
      maxHeight: '95dvh',
      autoFocus: 'input[name="to"]'
    });
    this.composeDialog.afterClosed().subscribe(() => { this.composeDialog = undefined; });
  }

  async send(): Promise<void> {
    const dialog = this.composeDialog;
    if (this.isSending || !dialog) return;
    const original = this.forwarding;
    const to = this.parseAddresses(original ? this.forwardTo : this.compose.to);
    const subject = this.compose.subject.trim();
    const html = this.compose.html.trim();
    if (!to.length || (!original && (!subject || !html))) {
      const error = original ? 'A recipient is required.' : 'To, subject and body are required.';
      this.snackBar.open(error, 'Close', { duration: 3500 });
      return;
    }

    this.isSending = true;
    dialog.disableClose = true;
    try {
      if (original) {
        await firstValueFrom(this.mailApi.forwardMessage(original.id, { to, comment: this.forwardComment.trim() }));
      } else {
        const cc = this.parseAddresses(this.compose.cc);
        const bcc = this.parseAddresses(this.compose.bcc);
        await firstValueFrom(this.mailApi.sendMail({ to, subject, html, cc, bcc }));
        this.compose = { to: '', cc: '', bcc: '', subject: '', html: '' };
      }
      dialog.close();
      this.snackBar.open(original ? 'Mail forwarded.' : 'Mail sent.', 'Close', { duration: 3000 });
      if (this.folder === 'sentitems') void this.reload('sentitems');
    } catch (e: any) {
      this.snackBar.open(e?.error?.detail || e?.error?.error || (original ? 'Forward failed.' : 'Send failed.'), 'Close', { duration: 4500 });
    } finally {
      this.isSending = false;
      dialog.disableClose = false;
    }
  }

  messageDate(item: MailItem): string | undefined {
    return this.folder === 'sentitems'
      ? item.sentDateTime || item.receivedDateTime
      : item.receivedDateTime || item.sentDateTime;
  }

  displayAddress(addr?: MailAddress | null): string {
    const email = String(addr?.emailAddress?.address || '').trim();
    const name = String(addr?.emailAddress?.name || '').trim();
    if (name && email) return `${name} <${email}>`;
    return email || name || 'Unknown';
  }

  displayAddresses(arr?: MailAddress[] | null): string {
    const parts = (arr || []).map((x) => this.displayAddress(x)).filter(Boolean);
    return parts.length ? parts.join(', ') : '-';
  }

  formatDate(value?: string): string {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  }

  private parseAddresses(input: string): string[] {
    return String(input || '')
      .split(/[;,]/)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  private messageSearchText(item: MailItem): string {
    return [
      item.subject,
      item.bodyPreview,
      this.displayAddress(item.from || item.sender),
      this.displayAddresses(item.toRecipients),
      this.displayAddresses(item.ccRecipients),
      this.displayAddresses(item.bccRecipients),
      this.formatDate(this.messageDate(item))
    ].join(' ').toLowerCase();
  }
}
