import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "@/components/ui/Toast";

// Helper: A test component that exposes the toast function
function ToastTrigger({
  message,
  variant,
}: {
  message: string;
  variant?: "success" | "error" | "info";
}) {
  const { toast } = useToast();
  return <button onClick={() => toast(message, variant)}>Show Toast</button>;
}

function renderWithProvider(
  message: string,
  variant?: "success" | "error" | "info",
) {
  return render(
    <ToastProvider>
      <ToastTrigger message={message} variant={variant} />
    </ToastProvider>,
  );
}

describe("ToastProvider / useToast()", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it("shows a toast message when toast() is called", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderWithProvider("Hello world", "success");
    await user.click(screen.getByRole("button", { name: "Show Toast" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("auto-dismisses the toast after 4 seconds", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderWithProvider("Auto-dismiss", "info");
    await user.click(screen.getByRole("button", { name: "Show Toast" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(4100);
    });
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("dismisses the toast when clicking the dismiss button", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderWithProvider("Dismiss me", "error");
    await user.click(screen.getByRole("button", { name: "Show Toast" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("useToast() throws when used outside ToastProvider", () => {
    // Suppress React error output for this test
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    function BadComponent() {
      useToast();
      return null;
    }
    expect(() => render(<BadComponent />)).toThrow(
      "useToast must be used inside ToastProvider",
    );
    consoleSpy.mockRestore();
  });

  it("renders multiple toasts at once", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderWithProvider("First", "success");
    const btn = screen.getByRole("button", { name: "Show Toast" });
    await user.click(btn);
    await user.click(btn);
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(2);
  });
});
