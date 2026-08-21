import { render, screen } from "@testing-library/react";
import HomePage from "../app/page";

// Next.js Image needs to be mocked in jsdom
jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("HomePage — hero logo", () => {
  it("renders the brand name above the slogan", () => {
    render(<HomePage />);
    expect(screen.getByText("Whole Haul", { selector: "section span" })).toBeInTheDocument();
  });

  it("places the brand name before the slogan text", () => {
    const { container } = render(<HomePage />);

    const heroSection = container.querySelector("section");
    const heroBrand = heroSection?.querySelector("span");
    const slogan = heroSection?.querySelector("h1");

    expect(heroBrand).toBeTruthy();
    expect(slogan).toBeTruthy();

    // Logo should appear before slogan in the DOM
    const position =
      heroBrand!.compareDocumentPosition(slogan!) &
      Node.DOCUMENT_POSITION_FOLLOWING;
    expect(position).toBeTruthy();
  });

  it("slogan text is present", () => {
    render(<HomePage />);
    expect(screen.getByText(/meal planning made simple/i)).toBeInTheDocument();
  });
});
