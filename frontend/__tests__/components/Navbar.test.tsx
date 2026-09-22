import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Navbar from "@/components/Navbar";

let mockPathname = "/dashboard";
jest.mock("next/navigation", () => ({ usePathname: () => mockPathname }));
jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));
const props = {
  userName: "Alex Morgan",
  onLogout: jest.fn(),
  loggingOut: false,
};
const trigger = () => screen.getByRole("button", { name: "Account menu" });
beforeEach(() => {
  jest.clearAllMocks();
  mockPathname = "/dashboard";
});

it("keeps only a Home-linked recognizable brand and account trigger when closed", () => {
  render(<Navbar {...props} />);
  expect(screen.getByRole("link", { name: "Whole Haul home" })).toHaveAttribute(
    "href",
    "/dashboard",
  );
  expect(trigger()).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByText("Alex")).toBeInTheDocument();
  expect(screen.queryByText("Alex Morgan")).not.toBeInTheDocument();
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(
    screen.queryByRole("button", { name: "Toggle menu" }),
  ).not.toBeInTheDocument();
});
it.each(["FREE", "PRO", undefined] as const)(
  "offers the same destinations for %s without a direct portal action",
  (tier) => {
    render(
      <Navbar {...props} subscriptionTier={tier} subscriptionStatus={null} />,
    );
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(
      trigger().getAttribute("aria-controls")!,
    );
    expect(panel).toBeVisible();
    expect(screen.getByRole("link", { name: "Preferences" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(
      screen.getByRole("link", { name: "Plan & billing" }),
    ).toHaveAttribute("href", "/pricing");
    expect(panel?.querySelectorAll("a,button")).toHaveLength(3);
    expect(
      Array.from(panel!.querySelectorAll("a,button")).map(
        (el) => el.textContent,
      ),
    ).toEqual(["Preferences", "Plan & billing", "Sign out"]);
    expect(screen.queryByText("FREE")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /billing/i }),
    ).not.toBeInTheDocument();
  },
);
it("opens by keyboard, tabs through entries, and closes with Escape returning focus", async () => {
  const user = userEvent.setup();
  render(<Navbar {...props} />);
  trigger().focus();
  await user.keyboard("{Enter}");
  await user.tab();
  expect(screen.getByRole("link", { name: "Preferences" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("link", { name: "Plan & billing" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Sign out" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(trigger()).toHaveFocus();
  expect(trigger()).toHaveAttribute("aria-expanded", "false");
  expect(
    screen.queryByRole("link", { name: "Preferences" }),
  ).not.toBeInTheDocument();
  await user.keyboard(" ");
  expect(trigger()).toHaveAttribute("aria-expanded", "true");
});
it("closes on outside pointer interaction and when Tab moves outside without trapping focus", async () => {
  const user = userEvent.setup();
  render(
    <>
      <Navbar {...props} />
      <button>Page action</button>
    </>,
  );
  await user.click(trigger());
  await user.click(screen.getByRole("button", { name: "Page action" }));
  expect(trigger()).toHaveAttribute("aria-expanded", "false");
  await user.click(trigger());
  await user.tab();
  await user.tab();
  await user.tab();
  await user.tab();
  expect(screen.getByRole("button", { name: "Page action" })).toHaveFocus();
  expect(trigger()).toHaveAttribute("aria-expanded", "false");
});
it("closes after destination selection and route changes", () => {
  const { rerender } = render(<Navbar {...props} />);
  fireEvent.click(trigger());
  fireEvent.click(screen.getByRole("link", { name: "Preferences" }));
  expect(trigger()).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(trigger());
  mockPathname = "/settings";
  rerender(<Navbar {...props} />);
  expect(
    screen.queryByRole("link", { name: "Preferences" }),
  ).not.toBeInTheDocument();
  fireEvent.click(trigger());
  expect(screen.getByRole("link", { name: "Preferences" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
it.each([undefined, "   ", "private@example.test"])(
  "uses a neutral fallback for a missing or email-like name: %s",
  (userName) => {
    render(<Navbar {...props} userName={userName} />);
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.queryByText(/private@/)).not.toBeInTheDocument();
  },
);
it("bounds a long first name and renders initials without a profile image", () => {
  render(<Navbar {...props} userName={"Alexandria".repeat(20) + " Morgan"} />);
  expect(screen.getByText("AM")).toBeInTheDocument();
  expect(screen.getByText("Alexandria".repeat(20))).toHaveClass("truncate");
});
it("disables sign out while the parent logout is pending", () => {
  render(<Navbar {...props} loggingOut />);
  fireEvent.click(trigger());
  const logout = screen.getByRole("button", { name: "Signing out…" });
  expect(logout).toBeDisabled();
  fireEvent.click(logout);
  expect(props.onLogout).not.toHaveBeenCalled();
});
it("prevents duplicate submissions while the logout callback is pending", async () => {
  let resolve!: () => void;
  const onLogout = jest.fn(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  render(<Navbar {...props} onLogout={onLogout} />);
  fireEvent.click(trigger());
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  fireEvent.click(screen.getByRole("button", { name: "Signing out…" }));
  expect(onLogout).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
});
