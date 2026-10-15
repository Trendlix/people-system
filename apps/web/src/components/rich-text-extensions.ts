import { Extension, type CommandProps } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { indentFromMargin, MAX_INDENT, wordListItem } from '@/lib/rich-text';

// What the rich text editor (rich-text-editor.tsx) adds to Tiptap's own extensions: indenting, and tidying what is
// pasted from Word and Google Docs so its lists come through as lists.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      /** In a list, makes the item a point under the one above it; elsewhere, indents the paragraphs one level more. */
      increaseIndent: () => ReturnType;
      /** In a list, moves the item one level out (out of the list from the top level); elsewhere, one level less. */
      decreaseIndent: () => ReturnType;
      /** Plain paragraphs again: no bold, italic or underline, no lists, no indents. */
      clearFormatting: () => ReturnType;
    };
  }
}

/** The innermost list the selection is in ('bulletList' or 'orderedList'), or null outside a list. */
export function listAt(state: EditorState): string | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (name === 'bulletList' || name === 'orderedList') return name;
  }
  return null;
}

/** Moves the paragraphs in the selection that are not in a list `step` levels in or out; false when none can move. */
function shiftParagraphs({ tr, dispatch }: CommandProps, step: 1 | -1): boolean {
  const { from, to } = tr.selection;
  let moved = false;
  tr.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.type.name !== 'paragraph') return true;
    if (parent?.type.name === 'doc') {
      const indent = Math.min(MAX_INDENT, Math.max(0, (Number(node.attrs.indent) || 0) + step));
      if (indent !== node.attrs.indent) {
        moved = true;
        if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent });
      }
    }
    return false;
  });
  return moved;
}

/**
 * Indenting, as in an email: an `indent` level from 0 to MAX_INDENT on paragraphs, kept as `data-indent` (none at 0).
 * Increase and decrease indent nest or un-nest a list item inside a list, and change the paragraph's level elsewhere.
 * Keys, as in Gmail: Ctrl/Cmd+] and Ctrl/Cmd+[ to indent, Ctrl/Cmd+\ to clear formatting (Tab and Shift+Tab in a list
 * come with Tiptap's list item).
 */
export const Indent = Extension.create({
  name: 'indent',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => {
              // a paragraph in a list item is indented by its list
              if (element.closest('li')) return 0;
              const level = Number(element.getAttribute('data-indent'));
              if (Number.isInteger(level) && level >= 1 && level <= MAX_INDENT) return level;
              return indentFromMargin(element.style.marginLeft);
            },
            renderHTML: (attributes) => (attributes.indent > 0 ? { 'data-indent': String(attributes.indent) } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      increaseIndent: () => (props) => (listAt(props.state) ? props.commands.sinkListItem('listItem') : shiftParagraphs(props, 1)),
      decreaseIndent: () => (props) => (listAt(props.state) ? props.commands.liftListItem('listItem') : shiftParagraphs(props, -1)),
      clearFormatting:
        () =>
        ({ commands, tr, dispatch }) => {
          commands.unsetAllMarks();
          commands.clearNodes();
          // what is typed next is plain too (after the steps above, which would forget it)
          if (dispatch) tr.setStoredMarks([]);
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-]': () => this.editor.commands.increaseIndent(),
      'Mod-[': () => this.editor.commands.decreaseIndent(),
      'Mod-\\': () => this.editor.commands.clearFormatting(),
    };
  },
});

/**
 * What is pasted, tidied before the editor reads it (it then keeps only what it allows: bold, italic, underline, lists,
 * paragraphs and their indents):
 * - Word copies a list as paragraphs with the bullet or number typed in front: they become a real list, nested by level.
 * - Google Docs puts a nested list straight inside its list instead of inside the point above it: it is moved there.
 */
export function tidyPastedHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  wordListsToLists(doc);
  for (const list of Array.from(doc.querySelectorAll(':is(ul, ol) > :is(ul, ol)'))) {
    const before = list.previousElementSibling;
    if (before?.tagName === 'LI') {
      before.append(list);
    } else {
      // no point above it: it goes in a list item of its own
      const item = doc.createElement('li');
      list.replaceWith(item);
      item.append(list);
    }
  }
  return doc.body.innerHTML;
}

/** Word's list paragraphs (see wordListItem) as lists: one list per run of them, nested by level. */
function wordListsToLists(doc: Document) {
  let open: { level: number; list: HTMLElement }[] = [];
  let listId = '';
  for (const p of Array.from(doc.querySelectorAll('p'))) {
    const markerSpan = Array.from(p.querySelectorAll('span')).find((s) => /mso-list:\s*ignore/i.test(s.getAttribute('style') ?? ''));
    const item = wordListItem(p.getAttribute('style') ?? '', markerSpan?.textContent ?? '');
    if (!item) continue;
    // a new list unless this paragraph comes straight after the last one's list, in the same Word list
    if (open.length && (item.list !== listId || !comesStraightAfter(open[0].list, p))) open = [];
    listId = item.list;
    markerSpan?.remove();

    while (open.length && open[open.length - 1].level > item.level) open.pop();
    let top = open[open.length - 1];
    if (!top || top.level < item.level) {
      const list = doc.createElement(item.ordered ? 'ol' : 'ul');
      if (top) (top.list.lastElementChild ?? top.list.appendChild(doc.createElement('li'))).append(list);
      else p.before(list);
      top = { level: item.level, list };
      open.push(top);
    }
    const li = doc.createElement('li');
    top.list.append(li);
    li.append(p);
  }
}

/** Whether nothing but white space and comments comes between `list` and `node`. */
function comesStraightAfter(list: Element, node: Element): boolean {
  let before = node.previousSibling;
  while (before && (before.nodeType === Node.COMMENT_NODE || (before.nodeType === Node.TEXT_NODE && !before.textContent?.trim()))) {
    before = before.previousSibling;
  }
  return before === list;
}
