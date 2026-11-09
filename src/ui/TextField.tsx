import type { InputHTMLAttributes } from 'react';
import { Field } from './Field';
import { CONTROL, describedBy, useFieldIds, type FieldChrome } from './fieldParts';

export type TextFieldProps = FieldChrome & InputHTMLAttributes<HTMLInputElement>;

/** A labelled single-line input (text, email, number, date, time…). */
export function TextField({
  label,
  hideLabel,
  hint,
  error,
  id,
  className,
  ...rest
}: TextFieldProps) {
  const ids = useFieldIds(id);
  const chrome = { label, hideLabel, hint, error };
  return (
    <Field ids={ids} chrome={chrome} className={className}>
      <input
        id={ids.id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, chrome)}
        className={CONTROL}
        {...rest}
      />
    </Field>
  );
}
