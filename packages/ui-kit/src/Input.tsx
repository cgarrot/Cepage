import {
  forwardRef,
  type CSSProperties,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

const baseInputStyle: CSSProperties = {
  background: 'var(--z-input-bg)',
  border: '1px solid var(--z-border-input)',
  borderRadius: 10,
  color: 'var(--z-fg)',
  padding: '8px 12px',
  fontSize: 13,
  lineHeight: 1.4,
  width: '100%',
  outline: 'none',
};

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { style, ...rest },
  ref,
) {
  return <input ref={ref} {...rest} style={{ ...baseInputStyle, ...style }} />;
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  autoGrow?: boolean;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { style, autoGrow, ...rest },
  ref,
) {
  const merged: CSSProperties = {
    ...baseInputStyle,
    fontFamily: 'inherit',
    resize: autoGrow ? 'none' : 'vertical',
    minHeight: 72,
    ...style,
  };
  return <textarea ref={ref} {...rest} style={merged} />;
});
