"use client";

import { useEffect, useState } from "react";
import { SparklesIcon } from "@heroicons/react/24/outline";
import Modal from "./Modal";

const STATUS_MESSAGES = [
  "Analyzing your preferences…",
  "Selecting ingredients…",
  "Crafting your meal plan…",
  "Almost there…",
];

const PROGRESS_INTERVAL_MS = 1500;
const STATUS_INTERVAL_MS = 12_000;
const PROGRESS_CAP = 89;

interface GeneratingModalProps {
  isOpen: boolean;
}

const CLOSE_DELAY_MS = 800;

export default function GeneratingModal({ isOpen }: GeneratingModalProps) {
  const [progress, setProgress] = useState(0);
  const [statusIndex, setStatusIndex] = useState(0);
  const [visible, setVisible] = useState(isOpen);

  // Drive progress simulation while open
  useEffect(() => {
    if (!isOpen) return;

    const progressTimer = setInterval(() => {
      setProgress((prev) => {
        const increment = (PROGRESS_CAP - prev) * 0.04;
        return Math.min(prev + increment, PROGRESS_CAP);
      });
    }, PROGRESS_INTERVAL_MS);

    const statusTimer = setInterval(() => {
      setStatusIndex((prev) => (prev + 1) % STATUS_MESSAGES.length);
    }, STATUS_INTERVAL_MS);

    return () => {
      clearInterval(progressTimer);
      clearInterval(statusTimer);
    };
  }, [isOpen]);

  // Handle open → close transition: animate to 100%, then unmount
  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      setProgress(0);
      setStatusIndex(0);
    } else if (visible) {
      setProgress(100);
      const t = setTimeout(() => setVisible(false), CLOSE_DELAY_MS);
      return () => clearTimeout(t);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayedProgress = Math.round(progress);

  return (
    <Modal isOpen={visible} preventClose size="sm">
      <div className="flex flex-col items-center gap-5 py-4 animate-fade-in">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-brand-100">
          <SparklesIcon className="w-6 h-6 text-brand-600 animate-pulse" />
        </div>

        <div className="text-center space-y-1">
          <h2 className="text-lg font-semibold text-gray-900">
            Generating Your Meal Plan
          </h2>
          <p aria-live="polite" className="text-sm text-gray-500">
            {STATUS_MESSAGES[statusIndex]}
          </p>
        </div>

        <div className="w-full space-y-1.5">
          <div
            role="progressbar"
            aria-valuenow={displayedProgress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Generation progress"
            className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden"
          >
            <div
              className="h-full bg-brand-600 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${displayedProgress}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 text-right">
            {displayedProgress}%
          </p>
        </div>

        <p className="text-xs text-gray-400 text-center">
          This usually takes about a minute — hang tight!
        </p>
      </div>
    </Modal>
  );
}
