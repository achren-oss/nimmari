import { signDoneMessage } from "@/lib/sign-done";

export default async function SignDonePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const notices = await searchParams;
  return (
    <main className="signed-state">
      <h1>Sealed</h1>
      <p>{signDoneMessage(notices)}</p>
      <p style={{ marginTop: 24 }}>
        <a
          href={`/api/sign/${token}/pdf`}
          target="_blank"
          rel="noopener"
          className="btn-block"
        >
          View signed PDF →
        </a>
      </p>
    </main>
  );
}
