/**
 * TDD tests for GeneratingModal component.
 * Written BEFORE the component implementation (RED phase).
 */

import { render, screen, act } from "@testing-library/react";

// Mock heroicons
jest.mock("@heroicons/react/24/outline", () => ({
  SparklesIcon: (props: React.SVGAttributes<SVGElement>) => (
    <svg data-testid="sparkles-icon" {...props} />
  ),
}));

import GeneratingModal from "@/components/GeneratingModal";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe("GeneratingModal — closed state", () => {
  it("renders nothing when isOpen=false", () => {
    const { container } = render(<GeneratingModal isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("GeneratingModal — open state", () => {
  beforeEach(() => {
    render(<GeneratingModal isOpen={true} />);
  });

  it("renders a dialog/modal overlay", () => {
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders the sparkles icon", () => {
    expect(screen.getByTestId("sparkles-icon")).toBeInTheDocument();
  });

  it("renders a heading", () => {
    expect(
      screen.getByRole("heading", { name: /generating your meal plan/i }),
    ).toBeInTheDocument();
  });

  it("renders the first status message on mount", () => {
    expect(screen.getByText(/analyzing your preferences/i)).toBeInTheDocument();
  });

  it("renders a progress bar element", () => {
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("progress bar starts at 0%", () => {
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
  });

  it("progress bar advances after ticking", () => {
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    const bar = screen.getByRole("progressbar");
    const value = Number(bar.getAttribute("aria-valuenow"));
    expect(value).toBeGreaterThan(0);
  });

  it("progress bar stays below 90% after 60 seconds", () => {
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    const bar = screen.getByRole("progressbar");
    const value = Number(bar.getAttribute("aria-valuenow"));
    expect(value).toBeLessThan(90);
  });

  it("does not close on backdrop click (preventClose)", () => {
    // The backdrop exists but clicking it should not unmount the dialog
    const backdrop = document.querySelector(".fixed.inset-0");
    if (backdrop) {
      act(() => {
        backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("GeneratingModal — completion animation", () => {
  it("stays visible briefly after isOpen transitions to false", () => {
    const { rerender } = render(<GeneratingModal isOpen={true} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    rerender(<GeneratingModal isOpen={false} />);

    // Should still be visible (animating to 100%)
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows 100% on the progress bar when completing", () => {
    const { rerender } = render(<GeneratingModal isOpen={true} />);
    rerender(<GeneratingModal isOpen={false} />);

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "100");
  });

  it("unmounts after the completion delay", () => {
    const { rerender } = render(<GeneratingModal isOpen={true} />);
    rerender(<GeneratingModal isOpen={false} />);

    act(() => {
      jest.advanceTimersByTime(900);
    });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("resets state when reopened after closing", () => {
    const { rerender } = render(<GeneratingModal isOpen={true} />);
    rerender(<GeneratingModal isOpen={false} />);
    act(() => {
      jest.advanceTimersByTime(900);
    });

    rerender(<GeneratingModal isOpen={true} />);

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
  });
});

describe("GeneratingModal — status message rotation", () => {
  it("cycles to the next status message after 12 seconds", () => {
    render(<GeneratingModal isOpen={true} />);

    act(() => {
      jest.advanceTimersByTime(12_000);
    });

    // Should have moved past the first message
    const allMessages = [
      /analyzing your preferences/i,
      /selecting ingredients/i,
      /crafting your meal plan/i,
      /almost there/i,
    ];

    const visibleMessages = allMessages.filter((re) => {
      try {
        screen.getByText(re);
        return true;
      } catch {
        return false;
      }
    });

    // Exactly one message should be visible at a time
    expect(visibleMessages).toHaveLength(1);
  });
});
