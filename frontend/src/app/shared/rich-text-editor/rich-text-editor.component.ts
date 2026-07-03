import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

type ColorCommand = 'foreColor' | 'hiliteColor';

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
  @Output() htmlChange = new EventEmitter<string>();
  @ViewChild('editor') private editorRef?: ElementRef<HTMLElement>;

  private currentHtml = '';
  isTextColorMenuOpen = false;
  isHighlightMenuOpen = false;
  selectedFontSize = '3';
  selectedTextColor = '#111827';
  selectedHighlightColor = 'transparent';

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
  }

  syncEditor(event: Event): void {
    this.currentHtml = (event.target as HTMLElement)?.innerHTML || '';
    this.htmlChange.emit(this.currentHtml);
  }

  format(command: string): void {
    document.execCommand(command, false);
    this.captureEditorHtml();
  }

  setFontSize(size: string): void {
    if (!size) return;
    this.selectedFontSize = size;
    document.execCommand('fontSize', false, size);
    this.captureEditorHtml();
  }

  applyColor(command: ColorCommand, value: string): void {
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
    const url = window.prompt('URL');
    if (!url) return;
    document.execCommand('createLink', false, url);
    this.captureEditorHtml();
  }

  private captureEditorHtml(): void {
    const editor = this.editorRef?.nativeElement;
    if (!editor) return;
    this.currentHtml = editor.innerHTML || this.currentHtml;
    this.htmlChange.emit(this.currentHtml);
    editor.focus();
  }

  private writeExternalHtml(value: string): void {
    const editor = this.editorRef?.nativeElement;
    if (!editor || editor.innerHTML === value || document.activeElement === editor) return;
    editor.innerHTML = value;
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
}
