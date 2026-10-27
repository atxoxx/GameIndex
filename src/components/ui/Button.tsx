import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { playActionSound } from "../../utils/soundEffects";

type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  active?: boolean;
  iconOnly?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "ui-btn--primary",
  secondary: "ui-btn--secondary",
  tertiary: "ui-btn--tertiary",
  ghost: "ui-btn--ghost",
  danger: "ui-btn--danger",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "ui-btn--sm",
  md: "",
  lg: "ui-btn--lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      isLoading,
      active,
      iconOnly,
      leftIcon,
      rightIcon,
      className,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        // Default to a non-submit button so a UI-kit Button dropped inside a
        // <form> never submits it by accident; callers that want a submit
        // can still pass `type="submit"` (the spread below wins).
        type="button"
        className={[
          "ui-btn",
          variantClasses[variant],
          sizeClasses[size],
          iconOnly ? "ui-btn--icon-only" : "",
          active ? "ui-btn--active" : "",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={isLoading || disabled}
        aria-busy={isLoading || undefined}
        {...props}
        onClick={(e) => {
          playActionSound();
          props.onClick?.(e);
        }}
      >
        {isLoading && <span className="ui-btn__spinner" aria-hidden />}
        {!isLoading && leftIcon && (
          <span className="ui-btn__icon ui-btn__icon--left">{leftIcon}</span>
        )}
        <span className="ui-btn__label">{children}</span>
        {!isLoading && rightIcon && (
          <span className="ui-btn__icon ui-btn__icon--right">{rightIcon}</span>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";
