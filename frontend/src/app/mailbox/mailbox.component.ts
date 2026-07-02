import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MailApiService } from '../services/mail-api.service';

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
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTabsModule,
    MatTooltipModule
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
  isTextColorMenuOpen = false;
  isHighlightMenuOpen = false;
  selectedFontSize = '3';
  selectedTextColor = '#111827';
  selectedHighlightColor = 'transparent';

  compose = {
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    html: ''
  };
  textColors = [
    { label: 'black', value: '#111827' },
    { label: 'gray', value: '#6b7280' },
    { label: 'red', value: '#b91c1c' },
    { label: 'orange', value: '#b45309' },
    { label: 'yellow', value: '#ca8a04' },
    { label: 'green', value: '#047857' },
    { label: 'blue', value: '#1d4ed8' }
  ];
  highlightColors = [
    { label: 'yellow', value: '#fef3c7' },
    { label: 'orange', value: '#ffedd5' },
    { label: 'green', value: '#dcfce7' },
    { label: 'blue', value: '#dbeafe' },
    { label: 'gray', value: '#f3f4f6' }
  ];

  constructor(private mailApi: MailApiService, private snackBar: MatSnackBar) {}

  ngOnInit(): void {
    void this.reload();
  }

  async reload(folder: MailFolder = this.folder): Promise<void> {
    this.folder = folder;
    this.isLoading = true;
    this.selected = null;
    this.hasMore = false;
    try {
      const resp = await firstValueFrom(this.mailApi.listMailbox(folder, MAILBOX_PAGE_SIZE, 0));
      this.mailbox = resp?.mailbox || null;
      this.items = Array.isArray(resp?.items) ? resp.items as MailItem[] : [];
      this.hasMore = this.items.length === MAILBOX_PAGE_SIZE;
    } catch (e: any) {
      this.items = [];
      this.hasMore = false;
      this.snackBar.open(e?.error?.detail || e?.error?.error || 'Failed to load mailbox.', 'Close', { duration: 4500 });
    } finally {
      this.isLoading = false;
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

  async loadMore(): Promise<void> {
    if (this.isLoading || this.isLoadingMore || !this.hasMore) return;
    this.isLoadingMore = true;
    try {
      const resp = await firstValueFrom(this.mailApi.listMailbox(this.folder, MAILBOX_PAGE_SIZE, this.items.length));
      const nextItems = Array.isArray(resp?.items) ? resp.items as MailItem[] : [];
      const existingIds = new Set(this.items.map((item) => item.id));
      this.items = [...this.items, ...nextItems.filter((item) => item?.id && !existingIds.has(item.id))];
      this.mailbox = resp?.mailbox || this.mailbox;
      this.hasMore = nextItems.length === MAILBOX_PAGE_SIZE;
    } catch (e: any) {
      this.snackBar.open(e?.error?.detail || e?.error?.error || 'Failed to load more messages.', 'Close', { duration: 4500 });
    } finally {
      this.isLoadingMore = false;
    }
  }

  async openMessage(item: MailItem): Promise<void> {
    if (!item?.id) return;
    this.isDetailLoading = true;
    try {
      const resp = await firstValueFrom(this.mailApi.getMailboxMessage(item.id));
      this.selected = (resp?.item as MailItem) || item;
    } catch (e: any) {
      this.snackBar.open(e?.error?.detail || e?.error?.error || 'Failed to load message.', 'Close', { duration: 4500 });
    } finally {
      this.isDetailLoading = false;
    }
  }

  async send(): Promise<void> {
    if (this.isSending) return;
    const to = this.parseAddresses(this.compose.to);
    const cc = this.parseAddresses(this.compose.cc);
    const bcc = this.parseAddresses(this.compose.bcc);
    const subject = this.compose.subject.trim();
    const html = this.compose.html.trim();
    if (!to.length || !subject || !html) {
      this.snackBar.open('To, subject and body are required.', 'Close', { duration: 3500 });
      return;
    }

    this.isSending = true;
    try {
      await firstValueFrom(this.mailApi.sendMail({ to, subject, html, cc, bcc }));
      this.snackBar.open('Mail sent.', 'Close', { duration: 3000 });
      this.compose = { to: '', cc: '', bcc: '', subject: '', html: '' };
      this.selectedFontSize = '3';
      this.selectedTextColor = '#111827';
      this.selectedHighlightColor = 'transparent';
      this.clearEditor();
      if (this.folder === 'sentitems') await this.reload('sentitems');
    } catch (e: any) {
      this.snackBar.open(e?.error?.detail || e?.error?.error || 'Send failed.', 'Close', { duration: 4500 });
    } finally {
      this.isSending = false;
    }
  }

  syncEditor(event: Event): void {
    this.compose.html = (event.target as HTMLElement)?.innerHTML || '';
  }

  formatMessage(command: string): void {
    document.execCommand(command, false);
    this.captureEditorHtml();
  }

  setFontSize(size: string): void {
    if (!size) return;
    this.selectedFontSize = size;
    document.execCommand('fontSize', false, size);
    this.captureEditorHtml();
  }

  applyColor(command: 'foreColor' | 'hiliteColor', value: string): void {
    if (!value) return;
    document.execCommand(command, false, value);
    this.applyListStyle(command, value);
    this.captureEditorHtml();
  }

  applyHighlight(value: string): void {
    if (!value) return;
    document.execCommand('hiliteColor', false, value === 'transparent' ? 'transparent' : value);
    this.applyListStyle('hiliteColor', value);
    this.captureEditorHtml();
  }

  toggleTextColorMenu(): void {
    this.isTextColorMenuOpen = !this.isTextColorMenuOpen;
    this.isHighlightMenuOpen = false;
  }

  toggleHighlightMenu(): void {
    this.isHighlightMenuOpen = !this.isHighlightMenuOpen;
    this.isTextColorMenuOpen = false;
  }

  applyMenuColor(command: 'foreColor' | 'hiliteColor', value: string): void {
    if (command === 'foreColor') this.selectedTextColor = value;
    this.applyColor(command, value);
    this.isTextColorMenuOpen = false;
  }

  applyMenuHighlight(value: string): void {
    this.selectedHighlightColor = value;
    this.applyHighlight(value);
    this.isHighlightMenuOpen = false;
  }

  colorLabel(value: string, colors: Array<{ label: string; value: string }>): string {
    return colors.find((color) => color.value === value)?.label || 'Color';
  }

  private applyListStyle(command: 'foreColor' | 'hiliteColor', value: string): void {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const editor = document.querySelector<HTMLElement>('.wysiwyg-editor');
    if (!editor) return;

    const listItems = Array.from(editor.querySelectorAll<HTMLElement>('li'))
      .filter((node) => range.intersectsNode(node));
    const listContainers = Array.from(editor.querySelectorAll<HTMLElement>('ul,ol'))
      .filter((node) => range.intersectsNode(node));

    for (const node of [...listItems, ...listContainers]) {
      if (command === 'foreColor') {
        node.style.color = value;
      } else if (value === 'transparent') {
        node.style.backgroundColor = '';
      } else {
        node.style.backgroundColor = value;
      }
    }
  }

  insertLink(): void {
    const url = window.prompt('URL');
    if (!url) return;
    document.execCommand('createLink', false, url);
    this.captureEditorHtml();
  }

  private captureEditorHtml(): void {
    const editor = document.querySelector<HTMLElement>('.wysiwyg-editor');
    this.compose.html = editor?.innerHTML || this.compose.html;
    editor?.focus();
  }

  private clearEditor(): void {
    const editor = document.querySelector<HTMLElement>('.wysiwyg-editor');
    if (editor) editor.innerHTML = '';
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
      this.formatDate(item.receivedDateTime || item.sentDateTime)
    ].join(' ').toLowerCase();
  }
}
