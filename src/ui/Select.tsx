import type { SelectHTMLAttributes } from 'react';
import { Field } from './Field';
import { CONTROL, describedBy, useFieldIds, type FieldChrome } from './fieldParts';

export interface SelectOption {
  value: string;
  label: string;
}

export type SelectProps = FieldChrome &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
    options: readonly SelectOption[];
  };

/** A labelled native select (the native picker is the best one on iPhone). */
export function Select({
  label,
  hideLabel,
  hint,
  error,
  id,
  className,
  options,
  ...rest
}: SelectProps) {
  const ids = useFieldIds(id);
  const chrome = { label, hideLabel, hint, error };
  return (
    <Field ids={ids} chrome={chrome} className={className}>
      <select
        id={ids.id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, chrome)}
        className={`${CONTROL} min-h-11`}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
