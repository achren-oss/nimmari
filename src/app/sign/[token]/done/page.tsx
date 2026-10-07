export default async function SignDonePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="signed-state">
      <h1>Sealed</h1>
      <p>The sender has been notified. A copy is on its way to your inbox.</p>
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
