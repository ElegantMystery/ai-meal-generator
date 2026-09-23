import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPage from "@/app/settings/page";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/authStore";
const mockPush = jest.fn();
const mockToast = jest.fn();
const mockRouter = { push: mockPush };
jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));
jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));
jest.mock("@/lib/api", () => ({ api: { get: jest.fn(), put: jest.fn() } }));
const get = api.get as jest.Mock;
const put = api.put as jest.Mock;
const saved = {
  dietaryRestrictions: "vegan",
  allergies: "peanuts; milk",
  targetCaloriesPerDay: 2000,
};
beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({
    user: {
      name: "Alex Morgan",
      email: "alex@example.test",
      provider: "google",
    },
    preferencesVersion: 0,
  });
  get.mockResolvedValue({ data: saved });
  put.mockResolvedValue({ data: saved });
});
it("loads existing fields and account details with navigation home", async () => {
  render(<SettingsPage />);
  expect(await screen.findByLabelText("Dietary style")).toHaveValue("vegan");
  expect(screen.getByLabelText("Daily calorie target")).toHaveValue("2000");
  expect(
    screen.getByRole("button", { name: "Remove peanuts" }),
  ).toBeInTheDocument();
  expect(screen.getByText("alex@example.test")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back to Home" })).toHaveAttribute(
    "href",
    "/dashboard",
  );
});
it("announces loading and prevents saves before preferences load", async () => {
  let resolve!: (v: unknown) => void;
  get.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  render(<SettingsPage />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading preferences");
  expect(
    screen.getByRole("button", { name: "Save preferences" }),
  ).toBeDisabled();
  await act(async () => resolve({ data: null }));
  expect(screen.getByLabelText("Dietary style")).toHaveValue("");
  expect(
    screen.getByRole("button", { name: "Save preferences" }),
  ).toBeEnabled();
});
it("shows failed load explicitly, blocks destructive empty saves, and retries", async () => {
  get.mockRejectedValueOnce(new Error("private response"));
  render(<SettingsPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to load preferences",
  );
  expect(screen.queryByLabelText("Dietary style")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Save preferences" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByLabelText("Dietary style")).toHaveValue("vegan");
  expect(put).not.toHaveBeenCalled();
});
it("saves edits and refreshes the Home preference summary only on success", async () => {
  const user = userEvent.setup();
  render(<SettingsPage />);
  await screen.findByLabelText("Dietary style");
  await user.selectOptions(
    screen.getByLabelText("Dietary style"),
    "vegetarian",
  );
  await user.click(screen.getByRole("button", { name: "Remove milk" }));
  await user.type(screen.getByLabelText("Allergies"), "sesame{Enter}");
  fireEvent.change(screen.getByLabelText("Daily calorie target"), {
    target: { value: "2100" },
  });
  await user.click(screen.getByRole("button", { name: "Save preferences" }));
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith("/api/preferences/me", {
      dietaryRestrictions: "vegetarian",
      allergies: "peanuts;sesame",
      targetCaloriesPerDay: 2100,
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Preferences saved",
  );
  expect(useAuthStore.getState().preferencesVersion).toBe(1);
});
it("preserves entered values after save failure and allows retry", async () => {
  put.mockRejectedValueOnce(new Error("private response"));
  render(<SettingsPage />);
  await screen.findByLabelText("Dietary style");
  fireEvent.change(screen.getByLabelText("Daily calorie target"), {
    target: { value: "1800" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to save preferences",
  );
  expect(screen.getByLabelText("Daily calorie target")).toHaveValue("1800");
  expect(useAuthStore.getState().preferencesVersion).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Preferences saved",
  );
});
it("disables editing and duplicate saves while saving", async () => {
  let resolve!: (v: unknown) => void;
  put.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  render(<SettingsPage />);
  await screen.findByLabelText("Dietary style");
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(screen.getByLabelText("Dietary style")).toBeDisabled();
  expect(screen.getByLabelText("Allergies")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
  expect(put).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ data: saved }));
});
it("retains optional null values and rejects a nonnumeric target", async () => {
  get.mockResolvedValue({ data: null });
  render(<SettingsPage />);
  await screen.findByLabelText("Daily calorie target");
  fireEvent.change(screen.getByLabelText("Daily calorie target"), {
    target: { value: "abc" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "must be a number",
  );
  expect(put).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Daily calorie target"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith("/api/preferences/me", {
      dietaryRestrictions: null,
      allergies: null,
      targetCaloriesPerDay: null,
    }),
  );
});
it.each(["load", "save"])(
  "redirects unauthorized %s requests to login",
  async (phase) => {
    if (phase === "load") get.mockRejectedValue({ response: { status: 401 } });
    else put.mockRejectedValue({ response: { status: 401 } });
    render(<SettingsPage />);
    if (phase === "save") {
      await screen.findByLabelText("Dietary style");
      fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    }
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login"));
  },
);
it("loads account details when preferences is opened directly", async () => {
  useAuthStore.setState({ user: null });
  get.mockImplementation((url: string) =>
    Promise.resolve({
      data:
        url === "/api/auth/me"
          ? {
              name: "Direct User",
              email: "direct@example.test",
              provider: "google",
            }
          : saved,
    }),
  );
  render(<SettingsPage />);
  expect(await screen.findByText("direct@example.test")).toBeInTheDocument();
});

it("distinguishes unavailable account details from successfully loaded preferences", async () => {
  useAuthStore.setState({ user: null });
  get.mockImplementation((url: string) =>
    url === "/api/auth/me"
      ? Promise.reject(new Error("private response"))
      : Promise.resolve({ data: saved }),
  );
  render(<SettingsPage />);
  expect(
    await screen.findByText(
      "Account details unavailable. Return Home to reload your account.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Dietary style")).toHaveValue("vegan");
  expect(
    screen.getByRole("button", { name: "Save preferences" }),
  ).toBeEnabled();
});
