import Link from "next/link";
export default function NotFound() {
  return (
    <main>
      <h1>Not found</h1>
      <p className="muted">That page or case doesn&apos;t exist.</p>
      <Link href="/" className="btn btn-ghost">Home</Link>
    </main>
  );
}
