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
  it("renders the hero logo image above the slogan", () => {
    render(<HomePage />);

    // There are two whole_haul images (navbar + hero). Find the hero one by its larger width.
    const images = screen
      .getAllByRole("img", { name: /whole haul/i })
      .filter((img) => img.getAttribute("width") === "320");

    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute("src", "/whole_haul.png");
  });

  it("places the hero logo before the slogan text", () => {
    const { container } = render(<HomePage />);

    const heroSection = container.querySelector("section");
    const heroLogo = heroSection?.querySelector('img[width="320"]');
    const slogan = heroSection?.querySelector("h1");

    expect(heroLogo).toBeTruthy();
    expect(slogan).toBeTruthy();

    // Logo should appear before slogan in the DOM
    const position =
      heroLogo!.compareDocumentPosition(slogan!) &
      Node.DOCUMENT_POSITION_FOLLOWING;
    expect(position).toBeTruthy();
  });

  it("slogan text is present", () => {
    render(<HomePage />);
    expect(screen.getByText(/meal planning made simple/i)).toBeInTheDocument();
  });
});
