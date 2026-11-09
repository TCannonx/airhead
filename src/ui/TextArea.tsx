import type { TextareaHTMLAttributes } from 'react';
import { Field } from './Field';
import { CONTROL, describedBy, useFieldIds, type FieldChrome } from './fieldParts';

export type TextAreaProps = FieldChrome & TextareaHTMLAttributes<HTMLTextAreaElement>;

/** A labelled multi-line input. */
export function TextArea({ label, hideLabel, hint, error, id, className, ...rest }: TextAreaProps) {
  const ids = useFieldIds(id);
  const chrome = { label, hideLabel, hint, error };
  return (
    <Field ids={ids} chrome={chrome} className={className}>
      <textarea
        id={ids.id}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, chrome)}
        className={`${CONTROL} resize-y`}
        {...rest}
      />
    </Field>
  );
}
