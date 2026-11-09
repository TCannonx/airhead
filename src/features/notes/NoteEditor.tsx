import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';
import { ToolButton } from '../../ui/ToolButton';

/** How long typing must pause before the document is saved (then synced). */
export const SAVE_DEBOUNCE_MS = 600;

function Toolbar({ editor }: { editor: Editor }) {
  const items: [string, string, () => void, boolean][] = [
    [
      'H1',
      'Heading 1',
      () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      editor.isActive('heading', { level: 1 }),
    ],
    [
      'H2',
      'Heading 2',
      () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      editor.isActive('heading', { level: 2 }),
    ],
    [
      '•',
      'Bullet list',
      () => editor.chain().focus().toggleBulletList().run(),
      editor.isActive('bulletList'),
    ],
    [
      '1.',
      'Numbered list',
      () => editor.chain().focus().toggleOrderedList().run(),
      editor.isActive('orderedList'),
    ],
    [
      '☐',
      'Checklist',
      () => editor.chain().focus().toggleTaskList().run(),
      editor.isActive('taskList'),
    ],
    ['B', 'Bold', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold')],
    ['I', 'Italic', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic')],
  ];
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="mb-2 flex flex-wrap gap-1 border-b border-border/60 pb-2"
    >
      {items.map(([label, name, run, on]) => (
        <ToolButton pressed={on} key={name} aria-label={name} onClick={run}>
          {label}
        </ToolButton>
      ))}
    </div>
  );
}

/**
 * The typed note editor (Task 6.3): keyboard-first, with Markdown-style
 * shortcuts ("# ", "- ", "1. ", "[ ] ", **bold**). Saves on the device after
 * a short pause; sync sends the whole document a moment later.
 */
export default function NoteEditor({
  html,
  onSave,
}: {
  html: string;
  onSave: (html: string) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<string | null>(null);
  const save = useRef(onSave);
  useEffect(() => {
    save.current = onSave;
  }, [onSave]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Start typing… (# heading, - list, [ ] checkbox)' }),
    ],
    content: html,
    // Re-render on each change so the toolbar shows what's active (notes are small).
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { 'aria-label': 'Note', class: 'ah-note min-h-[50vh] outline-none' },
    },
    onUpdate: ({ editor: e }) => {
      latest.current = e.getHTML();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (latest.current !== null) save.current(latest.current);
        latest.current = null;
      }, SAVE_DEBOUNCE_MS);
    },
  });

  // Leaving the page saves anything still waiting.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (latest.current !== null) save.current(latest.current);
    },
    [],
  );

  if (!editor) return null;
  return (
    <div>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
