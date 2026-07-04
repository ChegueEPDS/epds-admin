import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';


type ColorCommand = 'foreColor' | 'hiliteColor';

type ActiveToolbarStates = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeThrough: boolean;
  justifyLeft: boolean;
  justifyCenter: boolean;
  justifyRight: boolean;
  insertUnorderedList: boolean;
  insertOrderedList: boolean;
};

type TableBorderStyle = 'solid' | 'dashed' | 'dotted' | 'double' | 'none';

@Component({
  selector: 'app-rich-text-editor',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule
  ],
  templateUrl: './rich-text-editor.component.html',
  styleUrl: './rich-text-editor.component.scss'
})
export class RichTextEditorComponent implements AfterViewInit {
  @Input() label = '';
  @Input() placeholder = 'Write...';
  @Input() ariaLabel = 'Rich text editor';
  @Input() minHeight = '260px';
  @Input() disabled = false;
  @Input() readonly = false;
  @Input() required = false;
  @Input() errorText = '';
  @Input() maxLength: number | null = null;
  @Output() htmlChange = new EventEmitter<string>();
  @ViewChild('editor') private editorRef?: ElementRef<HTMLElement>;

  private currentHtml = '';
  isTextColorMenuOpen = false;
  isHighlightMenuOpen = false;
  isHtmlMode = false;
  selectedFontSize = '3';
  selectedBlockFormat = 'p';
  selectedTextColor = '#111827';
  selectedHighlightColor = 'transparent';
  plainTextLength = 0;
  activeStates: ActiveToolbarStates = {
    bold: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    justifyLeft: false,
    justifyCenter: false,
    justifyRight: false,
    insertUnorderedList: false,
    insertOrderedList: false
  };
  isTableMenuOpen = false;
  tableRows = 2;
  tableColumns = 2;
  tableBorderWidth = 1;
  tableBorderStyle: TableBorderStyle = 'solid';
  tableBorderColor = '#d1d5db';

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

  @Input()
  set html(value: string | null | undefined) {
    const nextHtml = value || '';
    this.currentHtml = nextHtml;
    this.writeExternalHtml(nextHtml);
  }

  get html(): string {
    return this.currentHtml;
  }

  ngAfterViewInit(): void {
    this.writeExternalHtml(this.currentHtml);
    this.updatePlainTextLength();
  }

  syncEditor(event: Event): void {
    if (this.disabled || this.readonly) return;
    this.currentHtml = this.normalizeHtml((event.target as HTMLElement)?.innerHTML || '');
    this.htmlChange.emit(this.currentHtml);
    this.updatePlainTextLength();
    this.updateActiveStates();
  }

  format(command: string): void {
    if (!this.canEdit()) return;
    document.execCommand(command, false);
    this.captureEditorHtml();
    this.updateActiveStates();
  }

  setFontSize(size: string): void {
    if (!size || !this.canEdit()) return;
    this.selectedFontSize = size;
    document.execCommand('fontSize', false, size);
    this.captureEditorHtml();
  }

  setBlockFormat(format: string): void {
    if (!format || !this.canEdit()) return;
    this.selectedBlockFormat = format;
    document.execCommand('formatBlock', false, format);
    this.captureEditorHtml();
  }

  applyColor(command: ColorCommand, value: string): void {
    if (!value || !this.canEdit()) return;
    document.execCommand(command, false, value);
    this.applyListStyle(command, value);
    this.captureEditorHtml();
  }

  applyHighlight(value: string): void {
    if (!value || !this.canEdit()) return;
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

  applyMenuColor(command: ColorCommand, value: string): void {
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

  insertLink(): void {
    if (!this.canEdit()) return;
    const url = window.prompt('URL');
    if (!url) return;
    document.execCommand('createLink', false, this.normalizeUrl(url));
    this.decorateLinks();
    this.captureEditorHtml();
  }

  removeLink(): void {
    if (!this.canEdit()) return;
    document.execCommand('unlink', false);
    this.captureEditorHtml();
  }

  toggleHtmlMode(): void {
    if (this.disabled) return;
    const editor = this.editorRef?.nativeElement;
    if (!editor) return;

    if (this.isHtmlMode) {
      editor.innerHTML = this.normalizeHtml(editor.textContent || '');
      editor.contentEditable = String(!this.readonly && !this.disabled);
    } else {
      editor.textContent = this.currentHtml;
      editor.contentEditable = String(!this.readonly && !this.disabled);
    }

    this.isHtmlMode = !this.isHtmlMode;
    this.captureEditorHtml();
  }

  handlePaste(event: ClipboardEvent): void {
    if (!this.canEdit()) return;
    event.preventDefault();
    const html = event.clipboardData?.getData('text/html');
    const text = event.clipboardData?.getData('text/plain') || '';
    const content = html ? this.normalizeHtml(html) : this.escapeHtml(text).replace(/\n/g, '<br>');
    document.execCommand('insertHTML', false, content);
    this.decorateLinks();
    this.captureEditorHtml();
  }

  handleKeydown(event: KeyboardEvent): void {
    if (this.disabled || this.readonly) return;
    const isModifier = event.ctrlKey || event.metaKey;
    if (!isModifier) return;

    const key = event.key.toLowerCase();
    if (key === 'k') {
      event.preventDefault();
      this.insertLink();
    }
  }

  updateActiveStates(): void {
    this.activeStates = {
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      strikeThrough: document.queryCommandState('strikeThrough'),
      justifyLeft: document.queryCommandState('justifyLeft'),
      justifyCenter: document.queryCommandState('justifyCenter'),
      justifyRight: document.queryCommandState('justifyRight'),
      insertUnorderedList: document.queryCommandState('insertUnorderedList'),
      insertOrderedList: document.queryCommandState('insertOrderedList')
    };
  }

  toggleTableMenu(): void {
    if (this.disabled || this.readonly || this.isHtmlMode) return;
    this.isTableMenuOpen = !this.isTableMenuOpen;
  }

  insertTable(rows = this.tableRows, columns = this.tableColumns): void {
    if (!this.canEdit()) return;
    const safeRows = Math.max(1, Math.min(20, Number(rows) || 1));
    const safeColumns = Math.max(1, Math.min(10, Number(columns) || 1));
    const border = this.getTableBorderCss();
    const cells = Array.from({ length: safeColumns }, () => `<td style="border: ${border}; padding: 8px; min-width: 80px;"><br></td>`).join('');
    const body = Array.from({ length: safeRows }, () => `<tr>${cells}</tr>`).join('');
    const table = `<table style="border-collapse: collapse; width: 100%; margin: 12px 0;"><tbody>${body}</tbody></table><p><br></p>`;
    this.focusEditorForInsert();
    document.execCommand('insertHTML', false, table);
    this.isTableMenuOpen = false;
    this.captureEditorHtml();
  }

  applyTableBorder(): void {
    if (!this.canEdit()) return;
    const table = this.getClosestTableFromSelection();
    if (!table) return;
    const border = this.getTableBorderCss();
    table.style.borderCollapse = 'collapse';
    table.querySelectorAll<HTMLElement>('td,th').forEach((cell) => {
      cell.style.border = border;
      cell.style.padding = cell.style.padding || '8px';
      cell.style.minWidth = cell.style.minWidth || '80px';
    });
    this.captureEditorHtml();
  }

  private captureEditorHtml(): void {
    const editor = this.editorRef?.nativeElement;
    if (!editor) return;
    this.currentHtml = this.isHtmlMode ? (editor.textContent || '') : this.normalizeHtml(editor.innerHTML || this.currentHtml);
    this.htmlChange.emit(this.currentHtml);
    this.updatePlainTextLength();
    this.updateActiveStates();
    editor.focus();
  }

  private writeExternalHtml(value: string): void {
    const editor = this.editorRef?.nativeElement;
    if (!editor || editor.innerHTML === value || document.activeElement === editor) return;
    editor.innerHTML = this.normalizeHtml(value);
    this.decorateLinks();
    this.updatePlainTextLength();
  }

  private applyListStyle(command: ColorCommand, value: string): void {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const editor = this.editorRef?.nativeElement;
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

  private focusEditorForInsert(): void {
    const editor = this.editorRef?.nativeElement;
    if (!editor) return;

    editor.focus();
    const selection = window.getSelection();
    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) return;
    }

    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  private canEdit(): boolean {
    return !this.disabled && !this.readonly && !this.isHtmlMode;
  }

  private updatePlainTextLength(): void {
    const editor = this.editorRef?.nativeElement;
    if (!editor) {
      this.plainTextLength = 0;
      return;
    }
    this.plainTextLength = (editor.textContent || '').trim().length;
  }

  private normalizeHtml(html: string): string {
    const template = document.createElement('template');
    template.innerHTML = html || '';

    template.content.querySelectorAll('script,style,iframe,object,embed,meta,link').forEach((node) => node.remove());
    template.content.querySelectorAll<HTMLElement>('*').forEach((node) => {
      Array.from(node.attributes).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        if (name.startsWith('on')) node.removeAttribute(attribute.name);
        if (name === 'class' && !['table-bordered'].some((allowed) => node.classList.contains(allowed))) node.removeAttribute(attribute.name);
      });

      if (node.tagName.toLowerCase() === 'font') {
        const span = document.createElement('span');
        span.innerHTML = node.innerHTML;
        const color = node.getAttribute('color');
        if (color) span.style.color = color;
        node.replaceWith(span);
      }
    });

    this.removeEmptyInlineNodes(template.content);
    return template.innerHTML.trim();
  }

  private removeEmptyInlineNodes(root: DocumentFragment): void {
    root.querySelectorAll('span,b,strong,i,em,u,s').forEach((node) => {
      if (!node.textContent?.trim() && !node.querySelector('img,br')) node.remove();
    });
  }

  private decorateLinks(): void {
    const editor = this.editorRef?.nativeElement;
    if (!editor) return;
    editor.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    });
  }

  private normalizeUrl(url: string): string {
    const trimmed = url.trim();
    if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  }

  private escapeHtml(value: string): string {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
  }

  private getTableBorderCss(): string {
    if (this.tableBorderStyle === 'none' || this.tableBorderWidth <= 0) return 'none';
    return `${Math.max(0, Number(this.tableBorderWidth) || 0)}px ${this.tableBorderStyle} ${this.tableBorderColor || '#d1d5db'}`;
  }

  private getClosestTableFromSelection(): HTMLTableElement | null {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const editor = this.editorRef?.nativeElement;
    const startNode = selection.getRangeAt(0).startContainer;
    const element = startNode.nodeType === Node.ELEMENT_NODE ? startNode as Element : startNode.parentElement;
    const table = element?.closest('table');
    return table && editor?.contains(table) ? table as HTMLTableElement : null;
  }
}
