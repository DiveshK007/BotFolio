import { Footer, Nav } from "@/components/site/chrome";

/** Website chrome. App screens (S2, S3, S5, S10, S11) use their own layout but the same tokens. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <Nav />
      <main id="main" tabIndex={-1}>{children}</main>
      <Footer />
    </>
  );
}
