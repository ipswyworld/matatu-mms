export const metadata = { robots: { index: false, follow: false } };

export default function ImpersonateErrorPage({
  searchParams,
}: {
  searchParams: { message?: string };
}) {
  const message = searchParams.message || "Something went wrong starting this session.";
  return (
    <div className="min-h-screen flex items-center justify-center bg-county-cream px-4">
      <div className="max-w-sm text-center space-y-2">
        <h1 className="font-extrabold text-county-red">Could not start impersonation</h1>
        <p className="text-sm text-black/60">{message}</p>
      </div>
    </div>
  );
}
