"use client";

import { useState, KeyboardEvent, ChangeEvent, useRef, useEffect } from "react";

interface AllergyTagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  className?: string;
}

// Common allergies for autocomplete suggestions
const COMMON_ALLERGIES = [
  "gluten",
  "dairy",
  "eggs",
  "soy",
  "peanuts",
  "tree nuts",
  "fish",
  "shellfish",
  "sesame",
  "banana",
  "strawberry",
  "tomato",
  "corn",
  "wheat",
  "milk",
  "lactose",
  "almond",
  "walnut",
  "cashew",
  "pistachio",
  "hazelnut",
  "pecan",
  "shrimp",
  "crab",
  "lobster",
  "salmon",
  "tuna",
  "sulfites",
  "mustard",
  "celery",
];

export default function AllergyTagInput({
  value,
  onChange,
  placeholder = "Type an allergy and press Enter",
  className = "",
}: AllergyTagInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter suggestions based on input
  const suggestions = COMMON_ALLERGIES.filter(
    (allergy) =>
      allergy.toLowerCase().includes(inputValue.toLowerCase().trim()) &&
      !value.includes(allergy.toLowerCase())
  ).slice(0, 8); // Limit to 8 suggestions

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const addTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
      setInputValue("");
      setShowSuggestions(false);
      setSelectedIndex(-1);
      inputRef.current?.focus();
    }
  };

  const removeTag = (tagToRemove: string) => {
    onChange(value.filter((tag) => tag !== tagToRemove));
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        addTag(suggestions[selectedIndex]);
      } else if (inputValue.trim()) {
        addTag(inputValue);
      }
    } else if (e.key === "," || e.key === ";") {
      e.preventDefault();
      if (inputValue.trim()) {
        addTag(inputValue);
      }
    } else if (e.key === "Backspace" && inputValue === "" && value.length > 0) {
      // Remove last tag when backspace is pressed on empty input
      removeTag(value[value.length - 1]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setShowSuggestions(true);
      setSelectedIndex((prev) =>
        prev < suggestions.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setSelectedIndex(-1);
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setShowSuggestions(true);
    setSelectedIndex(-1);
  };

  const handleInputFocus = () => {
    if (inputValue.trim()) {
      setShowSuggestions(true);
    }
  };

  return (
    <div className={`mt-1 relative ${className}`} ref={containerRef}>
      {/* Input container with tags inside */}
      <div className="w-full min-h-[42px] rounded-md border border-gray-300 bg-white focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 flex flex-wrap items-center gap-1.5 px-2 py-1.5">
        {/* Tags displayed inside */}
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="ml-0.5 text-blue-600 hover:text-blue-800 focus:outline-none rounded-sm hover:bg-blue-200 px-0.5"
              aria-label={`Remove ${tag}`}
              tabIndex={-1}
            >
              ×
            </button>
          </span>
        ))}

        {/* Input field */}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleInputFocus}
          placeholder={value.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[120px] border-0 outline-0 text-sm bg-transparent focus:ring-0 p-0"
        />
      </div>

      {/* Autocomplete suggestions dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => addTag(suggestion)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none ${
                index === selectedIndex ? "bg-blue-50" : ""
              }`}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {/* Helper text */}
      <p className="mt-1 text-xs text-gray-500">
        Press Enter or comma to add an allergy
      </p>
    </div>
  );
}
