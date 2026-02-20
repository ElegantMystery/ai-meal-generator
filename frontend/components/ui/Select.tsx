import { cn } from "@/lib/cn";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { forwardRef, SelectHTMLAttributes } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, className, id, children, ...rest }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={id}
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={id}
            className={cn(
              "block w-full appearance-none rounded-md border px-3 py-2 pr-9 text-sm text-gray-900",
              "bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500",
              "disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed",
              "transition",
              error
                ? "border-red-400 focus:ring-red-500"
                : "border-gray-300",
              className
            )}
            {...rest}
          >
            {children}
          </select>
          <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    );
  }
);

Select.displayName = "Select";

export { Select };
