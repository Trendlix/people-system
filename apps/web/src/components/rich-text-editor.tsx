'use client';

import { EditorContent, useEditor, useEditorState, type ChainedCommands } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Fragment, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { richTextValue, sanitizeRichText } from '@/lib/rich-text';
import { Indent, listAt, tidyPastedHtml } from './rich-text-extensions';

// Simple rich text, like an email composer's (owner, 15 October 2026: "allow me to format the text (bold, indent,
// etc.), not full format, keep the mail system format", and "don't auto number"): bold, italic, underline, bulleted
// and numbered lists, indents and line breaks (Shift+Enter), and nothing else: no headings, fonts, colours, links or
// code. Nothing is formatted as it is typed (no "1. " turning into a numbered list, no **bold**): lists and formatting
// come from the toolbar, the keys or a paste.

const extensions = [
  StarterKit.configure({
    heading: false,
    code: false,
    codeBlock: false,
    blockquote: false,
    strike: false,
    horizontalRule: false,
    link: false,
    // no empty paragraph added after a list at the end
    trailingNode: false,
  }),
  Indent,
];

const noSubscription = () => () => {};

/** Whether the keys to show are a Mac's (⌘B) or a PC's (Ctrl+B); a PC's on the server, until the page is running. */
function useMacKeys(): boolean {
  return useSyncExternalStore(noSubscription, () => /Mac|iPhone|iPad/.test(navigator.userAgent), () => false);
}

interface Tool {
  label: string;
  /** Its keys as `aria-keyshortcuts` writes them, the PC's first, e.g. "Control+B Meta+B". */
  keys?: string;
  icon: React.ReactNode;
  /** Whether it is on, for the formatting a button turns on and off. */
  pressed?: boolean;
  enabled: boolean;
  /** What it does, added to the editor's chain of commands. */
  run: (chain: ChainedCommands) => ChainedCommands;
}

/** "Control+B Meta+B" as the key is shown in the button's tooltip: "Ctrl+B" on a PC, "⌘B" on a Mac. */
function keysShown(keys: string, mac: boolean): string {
  const [pc, macKeys = pc] = keys.split(' ');
  return mac ? macKeys.replace('Meta+', '⌘').replace('Shift+', '⇧') : pc.replace('Control+', 'Ctrl+');
}

const Separator = () => <span role="separator" aria-orientation="vertical" className="rte-separator" />;

/**
 * A rich text field in a form. It sends its HTML in a hidden input named `name`, so the form's action reads it like a
 * text field ("" when it is empty, which clears it). `defaultValue`: the HTML it starts from, e.g. the saved field, or
 * what was typed when a save was refused (see `valueOf`). It sends `defaultValue` as it was until something is changed
 * (and again if the change is undone), so saving the form without touching the field leaves it as it was: the editor
 * writes the same text its own way, e.g. a list item's text in a paragraph. `rows`: how tall it is when empty, in
 * lines; it grows with its text.
 */
export function RichTextEditor({
  name,
  label,
  hint,
  defaultValue,
  rows = 4,
}: {
  name: string;
  label: string;
  hint?: React.ReactNode;
  defaultValue: string;
  rows?: number;
}) {
  const id = useId();
  const labelId = `${id}label`;
  const hintId = `${id}hint`;
  const [initial] = useState(defaultValue);
  // what the hidden input sends
  const [value, setValue] = useState(defaultValue);
  // the HTML the editor first wrote for `initial`: getting back to it sends `initial` as it was
  const firstHtml = useRef<string | null>(null);
  const mac = useMacKeys();
  const hasHint = !!hint;
  const editorProps = useMemo(
    () => ({
      // (all of them: Tiptap's own role="textbox" is lost when the editor's options are updated)
      attributes: {
        class: 'rich-text rte-content',
        role: 'textbox',
        'aria-labelledby': labelId,
        ...(hasHint && { 'aria-describedby': hintId }),
        'aria-multiline': 'true',
      },
      transformPastedHTML: tidyPastedHtml,
    }),
    [labelId, hintId, hasHint],
  );

  const editor = useEditor({
    extensions,
    // What it starts from. The latest, not `initial`: an editor started again (e.g. when Next.js shows a page kept from
    // before, on Back) has what was typed, as the hidden input does.
    content: value,
    // Next.js renders on the server first: the editor starts once the page is running in the browser
    immediatelyRender: false,
    // nothing is formatted as it is typed or pasted as text ("don't auto number")
    enableInputRules: false,
    enablePasteRules: false,
    editorProps,
    onMount: ({ editor }) => {
      firstHtml.current ??= editor.getHTML();
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      setValue(html === firstHtml.current ? initial : richTextValue(html));
    },
  });

  // What the toolbar shows, again after every change. Read from this render's editor: the one the hook passes stays
  // null until the first change (e.g. a click in the text), which would leave the toolbar looking disabled until then.
  const state = useEditorState({
    editor,
    selector: () =>
      editor && {
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        underline: editor.isActive('underline'),
        list: listAt(editor.state),
        canIndent: editor.can().increaseIndent(),
        canOutdent: editor.can().decreaseIndent(),
      },
  });

  const groups: Tool[][] = [
    [
      {
        label: 'Bold',
        keys: 'Control+B Meta+B',
        icon: <span className="text-[15px] font-bold">B</span>,
        pressed: !!state?.bold,
        enabled: !!state,
        run: (c) => c.toggleBold(),
      },
      {
        label: 'Italic',
        keys: 'Control+I Meta+I',
        icon: <span className="font-serif text-[16px] italic">I</span>,
        pressed: !!state?.italic,
        enabled: !!state,
        run: (c) => c.toggleItalic(),
      },
      {
        label: 'Underline',
        keys: 'Control+U Meta+U',
        icon: <span className="text-[15px] underline underline-offset-2">U</span>,
        pressed: !!state?.underline,
        enabled: !!state,
        run: (c) => c.toggleUnderline(),
      },
    ],
    [
      {
        label: 'Bulleted list',
        keys: 'Control+Shift+8 Meta+Shift+8',
        icon: (
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="size-5">
            <path d="M8 5h9M8 10h9M8 15h9" />
            <circle cx="4" cy="5" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="4" cy="10" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="4" cy="15" r="1.1" fill="currentColor" stroke="none" />
          </svg>
        ),
        pressed: state?.list === 'bulletList',
        enabled: !!state,
        run: (c) => c.toggleBulletList(),
      },
      {
        label: 'Numbered list',
        keys: 'Control+Shift+7 Meta+Shift+7',
        icon: (
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="size-5">
            <path d="M8.5 5h8.5M8.5 10h8.5M8.5 15h8.5" />
            <g fill="currentColor" stroke="none" fontSize="5.5" fontWeight="600" fontFamily="inherit" textAnchor="middle">
              <text x="4" y="7">1</text>
              <text x="4" y="12">2</text>
              <text x="4" y="17">3</text>
            </g>
          </svg>
        ),
        pressed: state?.list === 'orderedList',
        enabled: !!state,
        run: (c) => c.toggleOrderedList(),
      },
    ],
    [
      {
        label: 'Decrease indent',
        keys: 'Control+[ Meta+[',
        icon: (
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="size-5">
            <path d="M3 4h14M10 8h7M10 12h7M3 16h14" />
            <path d="M7 7.25L3.75 10 7 12.75z" fill="currentColor" strokeLinejoin="round" />
          </svg>
        ),
        enabled: !!state?.canOutdent,
        run: (c) => c.decreaseIndent(),
      },
      {
        label: 'Increase indent',
        keys: 'Control+] Meta+]',
        icon: (
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="size-5">
            <path d="M3 4h14M10 8h7M10 12h7M3 16h14" />
            <path d="M3.75 7.25L7 10l-3.25 2.75z" fill="currentColor" strokeLinejoin="round" />
          </svg>
        ),
        enabled: !!state?.canIndent,
        run: (c) => c.increaseIndent(),
      },
    ],
    [
      {
        label: 'Clear formatting',
        keys: 'Control+\\ Meta+\\',
        icon: (
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="size-5">
            <path d="M4 4.5h9M9.5 4.5L7 15.5" />
            <path d="M12.5 12l4.5 4.5M17 12l-4.5 4.5" />
          </svg>
        ),
        enabled: !!state,
        run: (c) => c.clearFormatting(),
      },
    ],
  ];

  // The toolbar is one stop for Tab; the arrow keys, Home and End move along its buttons.
  const [current, setCurrent] = useState(0);
  const count = groups.flat().length;
  const firstOf = groups.map((_, g) => groups.slice(0, g).flat().length);
  function onToolbarKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const buttons = Array.from(e.currentTarget.querySelectorAll('button'));
    const at = buttons.indexOf(e.target as HTMLButtonElement);
    const moves: Record<string, number> = { ArrowRight: at + 1, ArrowLeft: at - 1 + count, Home: 0, End: count - 1 };
    if (at < 0 || !(e.key in moves)) return;
    e.preventDefault();
    const next = moves[e.key] % count;
    setCurrent(next);
    buttons[next]?.focus();
  }

  return (
    <div>
      {/* not a <label for>: the text box is not an input, so it is named by aria-labelledby and focused on a click */}
      <div id={labelId} className="label" onClick={() => editor?.commands.focus()}>
        {label}
      </div>
      <div className="rte" style={{ '--rte-rows': rows } as React.CSSProperties}>
        <div role="toolbar" aria-label={`Formatting for ${label}`} aria-orientation="horizontal" onKeyDown={onToolbarKeyDown} className="rte-toolbar">
          {groups.map((group, g) => (
            <Fragment key={g}>
              {g > 0 && <Separator />}
              {group.map((tool, t) => {
                const at = firstOf[g] + t;
                return (
                  <button
                    key={tool.label}
                    type="button"
                    aria-label={tool.label}
                    aria-keyshortcuts={tool.keys}
                    title={tool.keys ? `${tool.label} (${keysShown(tool.keys, mac)})` : tool.label}
                    aria-pressed={tool.pressed}
                    aria-disabled={!tool.enabled || undefined}
                    tabIndex={at === current ? 0 : -1}
                    // a click leaves the cursor in the text, and its selection as it was
                    onMouseDown={(e) => e.preventDefault()}
                    onFocus={() => setCurrent(at)}
                    onClick={(e) => {
                      setCurrent(at);
                      if (!editor || !tool.enabled) return;
                      // clicked: on with typing; Enter or Space on the button (no click count): stay in the toolbar
                      const chain = e.detail > 0 ? editor.chain().focus() : editor.chain();
                      tool.run(chain).run();
                    }}
                    className="rte-button"
                  >
                    {tool.icon}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
        {/* until the editor has started (it starts in the browser), the text as it will look */}
        {!editor && <div className="rich-text rte-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(value) }} />}
        <EditorContent editor={editor} />
      </div>
      {hint && (
        <p id={hintId} className="hint">
          {hint}
        </p>
      )}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
