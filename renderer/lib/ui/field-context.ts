/**
 * The id a labelled <Field> gives its control. Input and SelectTrigger use it
 * when they have no id of their own, so the Field's <label htmlFor> names
 * them for VoiceOver (otherwise they'd be announced by placeholder only).
 */
import * as React from "react";

export const FieldControlIdContext = React.createContext<string | undefined>(undefined);

export function useFieldControlId(own: string | undefined): string | undefined {
  const fromField = React.useContext(FieldControlIdContext);
  return own ?? fromField;
}
